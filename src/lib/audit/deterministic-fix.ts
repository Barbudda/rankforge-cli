import type { FixSuggestion, Framework, Repository, SeoIssue } from "@/types";

/**
 * Deterministic fix generator — produces a real, framework-idiomatic patch for
 * mechanical SEO issues with ZERO LLM. For these classes (viewport, lang,
 * canonical, robots, sitemap, JSON-LD, social tags…) a template patch is more
 * reliable than a model guess, and it works with no API key at all.
 *
 * Returns null when the issue is not mechanically fixable (e.g. thin content,
 * duplicate content, internal-link strategy) — those fall through to the LLM
 * fix pipeline when a driver is available.
 *
 * The issue id encodes the rule (`iss_{repo}:{ruleId}`), so we key off the
 * ruleId suffix rather than re-parsing titles.
 */

function ruleIdOf(issue: SeoIssue): string {
  const m = issue.id.match(/:([a-z0-9-]+)$/i);
  return m ? m[1]! : "";
}

function siteName(repo: Repository): string {
  const seg = repo.fullName.split("/").pop() ?? "site";
  return seg.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function originOf(repo: Repository): string {
  try {
    return new URL(repo.productionUrl).origin;
  } catch {
    return repo.productionUrl.replace(/\/+$/, "");
  }
}

/** Conventional layout/head file per framework. */
function layoutFile(fw: Framework): string {
  const map: Record<Framework, string> = {
    nextjs: "app/layout.tsx",
    nuxt: "nuxt.config.ts",
    astro: "src/layouts/Layout.astro",
    sveltekit: "src/app.html",
    remix: "app/root.tsx",
    "vite-react": "index.html",
    mdx: "src/layouts/Base.astro",
    static: "index.html",
  };
  return map[fw];
}

type Builder = (issue: SeoIssue, repo: Repository) => FixSuggestion | null;

const fence = "```";

/** Assemble a FixSuggestion with sensible shared defaults. */
function make(
  issue: SeoIssue,
  slug: string,
  partial: Pick<FixSuggestion, "summary" | "filesChanged" | "diff" | "prDescription"> &
    Partial<FixSuggestion>,
): FixSuggestion {
  return {
    summary: partial.summary,
    filesChanged: partial.filesChanged,
    diff: partial.diff,
    branchName: partial.branchName ?? `rankforge/seo-${slug}`,
    prTitle: partial.prTitle ?? `Fix: ${issue.title}`,
    prDescription: partial.prDescription,
    validationSteps:
      partial.validationSteps ?? [
        "Run the build and confirm it compiles.",
        "Load an affected URL and view source to verify the change is present.",
        "Re-run the RankForge audit to confirm the issue clears.",
      ],
    rollbackNotes:
      partial.rollbackNotes ??
      "Revert this PR — the change is isolated to the files listed and touches no application logic.",
    confidence: partial.confidence ?? 92,
  };
}

// ── robots.txt / robots route ───────────────────────────────────────
const buildRobots: Builder = (issue, repo) => {
  const fw = repo.framework;
  const origin = originOf(repo);
  if (fw === "nextjs") {
    const path = "app/robots.ts";
    const code = [
      `import type { MetadataRoute } from "next";`,
      ``,
      `export default function robots(): MetadataRoute.Robots {`,
      `  return {`,
      `    rules: { userAgent: "*", allow: "/" },`,
      `    sitemap: "${origin}/sitemap.xml",`,
      `  };`,
      `}`,
    ];
    return make(issue, "robots", {
      summary: `Add a robots route (${path}) that allows crawling and points to the sitemap.`,
      filesChanged: [path],
      diff: newFileDiff(path, code),
      prDescription: `Adds \`${path}\` so crawlers get an explicit allow rule and a Sitemap directive.\n\n${fence}ts\n${code.join("\n")}\n${fence}`,
    });
  }
  // Universal static robots.txt for every other framework.
  const path = fw === "sveltekit" ? "static/robots.txt" : "public/robots.txt";
  const content = [`User-agent: *`, `Allow: /`, ``, `Sitemap: ${origin}/sitemap.xml`];
  return make(issue, "robots", {
    summary: `Add ${path} allowing crawling and referencing the sitemap.`,
    filesChanged: [path],
    diff: newFileDiff(path, content),
    prDescription: `Adds a static \`${path}\`:\n\n${fence}\n${content.join("\n")}\n${fence}`,
  });
};

// ── sitemap ─────────────────────────────────────────────────────────
const buildSitemap: Builder = (issue, repo) => {
  const fw = repo.framework;
  const origin = originOf(repo);
  if (fw === "nextjs") {
    const path = "app/sitemap.ts";
    const code = [
      `import type { MetadataRoute } from "next";`,
      ``,
      `// Add every public route here (or generate from your content source).`,
      `const routes = ["/"];`,
      ``,
      `export default function sitemap(): MetadataRoute.Sitemap {`,
      `  return routes.map((route) => ({`,
      `    url: \`${origin}\${route}\`,`,
      `    lastModified: new Date(),`,
      `    changeFrequency: "weekly",`,
      `    priority: route === "/" ? 1 : 0.7,`,
      `  }));`,
      `}`,
    ];
    return make(issue, "sitemap", {
      summary: `Add a sitemap route (${path}) enumerating your public URLs.`,
      filesChanged: [path],
      diff: newFileDiff(path, code),
      prDescription: `Adds \`${path}\`. Extend \`routes\` (or derive it from your content) so every indexable URL is listed.\n\n${fence}ts\n${code.join("\n")}\n${fence}`,
      confidence: 80,
    });
  }
  const path = fw === "sveltekit" ? "static/sitemap.xml" : "public/sitemap.xml";
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    `  <url><loc>${origin}/</loc></url>`,
    `</urlset>`,
  ];
  return make(issue, "sitemap", {
    summary: `Add ${path} listing your public URLs.`,
    filesChanged: [path],
    diff: newFileDiff(path, xml),
    prDescription: `Adds a starter \`${path}\` — add a \`<url>\` entry per indexable page (or generate it at build time).`,
    confidence: 70,
  });
};

// ── viewport (Next.js: viewport export) ─────────────────────────────
const buildViewport: Builder = (issue, repo) => {
  const fw = repo.framework;
  if (fw === "nextjs") {
    const path = "app/layout.tsx";
    const diff = editDiff(path, [
      `-import type { Metadata } from "next";`,
      `+import type { Metadata, Viewport } from "next";`,
      ` `,
      ` export const metadata: Metadata = {`,
      `   /* ...existing metadata... */`,
      ` };`,
      `+`,
      `+export const viewport: Viewport = {`,
      `+  width: "device-width",`,
      `+  initialScale: 1,`,
      `+};`,
    ]);
    return make(issue, "viewport", {
      summary: "Export a responsive viewport from the root layout.",
      filesChanged: [path],
      diff,
      prDescription:
        "Adds a `viewport` export so pages render responsively (required for mobile-first indexing).",
    });
  }
  const path = layoutFile(fw);
  const diff = editDiff(path, [
    `   <head>`,
    `+    <meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `   </head>`,
  ]);
  return make(issue, "viewport", {
    summary: "Add the responsive viewport meta tag to the document head.",
    filesChanged: [path],
    diff,
    prDescription:
      "Adds `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">` to the head.",
  });
};

// ── html lang ───────────────────────────────────────────────────────
const buildLang: Builder = (issue, repo) => {
  const fw = repo.framework;
  const path = layoutFile(fw);
  const diff =
    fw === "nextjs"
      ? editDiff(path, [`-  <html>`, `+  <html lang="en">`])
      : editDiff(path, [`-<html>`, `+<html lang="en">`]);
  return make(issue, "html-lang", {
    summary: 'Set the document language with lang="en" on <html>.',
    filesChanged: [path],
    diff,
    prDescription:
      'Adds `lang="en"` to the root `<html>` element (change to your primary language if not English).',
    confidence: 85,
  });
};

// ── canonical ───────────────────────────────────────────────────────
const buildCanonical: Builder = (issue, repo) => {
  const fw = repo.framework;
  const origin = originOf(repo);
  if (fw === "nextjs") {
    const path = "app/layout.tsx";
    const diff = editDiff(path, [
      ` export const metadata: Metadata = {`,
      `+  metadataBase: new URL("${origin}"),`,
      `+  alternates: { canonical: "/" },`,
      `   /* ...existing metadata... */`,
      ` };`,
    ]);
    return make(issue, "canonical", {
      summary: "Add metadataBase + per-page canonical via the Metadata API.",
      filesChanged: [path],
      diff,
      prDescription: `Sets \`metadataBase\` and a canonical. In each \`page.tsx\`, set \`alternates.canonical\` to that route's path so every page self-canonicalizes.`,
      confidence: 80,
    });
  }
  const path = layoutFile(fw);
  const diff = editDiff(path, [
    `   <head>`,
    `+    <link rel="canonical" href="${origin}/" />`,
    `   </head>`,
  ]);
  return make(issue, "canonical", {
    summary: "Add a canonical link to the document head.",
    filesChanged: [path],
    diff,
    prDescription:
      "Adds a `<link rel=\"canonical\">`. Set it per page to that page's own URL.",
    confidence: 70,
  });
};

// ── JSON-LD Organization/WebSite ────────────────────────────────────
const buildSchema: Builder = (issue, repo) => {
  const fw = repo.framework;
  const origin = originOf(repo);
  const name = siteName(repo);
  const json = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name,
    url: `${origin}/`,
  };
  const jsonStr = JSON.stringify(json, null, 2);
  if (fw === "nextjs") {
    const path = "app/layout.tsx";
    const snippet = [
      `<script`,
      `  type="application/ld+json"`,
      `  dangerouslySetInnerHTML={{ __html: JSON.stringify(${JSON.stringify(json)}) }}`,
      `/>`,
    ].join("\n");
    const diff = editDiff(path, [
      `   <body>`,
      `+        <script`,
      `+          type="application/ld+json"`,
      `+          dangerouslySetInnerHTML={{`,
      `+            __html: JSON.stringify(${JSON.stringify(json)}),`,
      `+          }}`,
      `+        />`,
      `         {children}`,
      `   </body>`,
    ]);
    return make(issue, "schema", {
      summary: "Emit WebSite JSON-LD structured data from the root layout.",
      filesChanged: [path],
      diff,
      prDescription: `Adds a JSON-LD \`WebSite\` block so search engines understand site identity:\n\n${fence}html\n${snippet}\n${fence}`,
      confidence: 82,
    });
  }
  const path = layoutFile(fw);
  const diff = editDiff(path, [
    `   </head>`,
    `+  <script type="application/ld+json">`,
    ...jsonStr.split("\n").map((l) => `+  ${l}`),
    `+  </script>`,
  ]);
  return make(issue, "schema", {
    summary: "Add WebSite JSON-LD structured data to the head.",
    filesChanged: [path],
    diff,
    prDescription: `Adds a JSON-LD \`WebSite\` block to the document head.`,
    confidence: 78,
  });
};

// ── OpenGraph image ─────────────────────────────────────────────────
const buildOgImage: Builder = (issue, repo) => {
  const fw = repo.framework;
  if (fw === "nextjs") {
    const path = "app/opengraph-image.tsx";
    const code = [
      `import { ImageResponse } from "next/og";`,
      ``,
      `export const size = { width: 1200, height: 630 };`,
      `export const contentType = "image/png";`,
      `export const alt = "${siteName(repo)}";`,
      ``,
      `export default function OpengraphImage() {`,
      `  return new ImageResponse(`,
      `    (`,
      `      <div style={{`,
      `        display: "flex", alignItems: "center", justifyContent: "center",`,
      `        width: "100%", height: "100%", fontSize: 72, background: "#0b0d14", color: "#fff",`,
      `      }}>`,
      `        ${siteName(repo)}`,
      `      </div>`,
      `    ),`,
      `    size,`,
      `  );`,
      `}`,
    ];
    return make(issue, "og-image", {
      summary: "Add a file-based OpenGraph image so shares render a card.",
      filesChanged: [path],
      diff: newFileDiff(path, code),
      prDescription: `Adds \`${path}\`. Next.js auto-wires it as \`og:image\` for the route (and nested routes can override).`,
      confidence: 80,
    });
  }
  const path = layoutFile(fw);
  const origin = originOf(repo);
  const diff = editDiff(path, [
    `   <head>`,
    `+    <meta property="og:image" content="${origin}/og-cover.png" />`,
    `   </head>`,
  ]);
  return make(issue, "og-image", {
    summary: "Reference an OpenGraph image in the head.",
    filesChanged: [path],
    diff,
    prDescription:
      "Adds an `og:image` meta. Provide a 1200×630 image at the referenced path.",
    confidence: 65,
  });
};

// ── Rule → builder registry ─────────────────────────────────────────
const BUILDERS: Record<string, Builder> = {
  "framework-robots-missing": buildRobots,
  "framework-robots-no-sitemap": buildRobots,
  "framework-sitemap-missing": buildSitemap,
  "perf-viewport-missing": buildViewport,
  "indexing-html-lang-missing": buildLang,
  "indexing-canonical-missing": buildCanonical,
  "schema-missing": buildSchema,
  "schema-website-missing": buildSchema,
  "meta-og-image-missing": buildOgImage,
};

/** Rule ids that have a deterministic (no-LLM) patch template. */
export const FIXABLE_RULE_IDS: readonly string[] = Object.keys(BUILDERS);

/**
 * Try to generate a deterministic fix for an issue. Returns null when the
 * issue class needs judgment (content, links) — the caller then falls back to
 * the LLM fix pipeline if a driver is configured.
 */
export function generateDeterministicFix(
  issue: SeoIssue,
  repo: Repository,
): FixSuggestion | null {
  const rule = ruleIdOf(issue);
  const builder = BUILDERS[rule];
  if (!builder) return null;
  return builder(issue, repo);
}

/** True if this issue has a deterministic (no-LLM) fix available. */
export function hasDeterministicFix(issue: SeoIssue): boolean {
  return ruleIdOf(issue) in BUILDERS;
}

// ── diff helpers ────────────────────────────────────────────────────
/** A unified diff that creates a new file with `lines`. */
function newFileDiff(path: string, lines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `new file mode 100644`,
    `--- /dev/null`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join("\n");
}

/** A unified diff editing an existing file (illustrative hunk). */
function editDiff(path: string, hunk: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ context @@`,
    ...hunk,
  ].join("\n");
}
