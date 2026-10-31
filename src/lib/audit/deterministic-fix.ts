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
    nuxt: "app.vue",
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
    branchName: partial.branchName ?? `septune/seo-${slug}`,
    prTitle: partial.prTitle ?? `Fix: ${issue.title}`,
    prDescription: partial.prDescription,
    validationSteps:
      partial.validationSteps ?? [
        "Run the build and confirm it compiles.",
        "Load an affected URL and view source to verify the change is present.",
        "Re-run the Septune audit to confirm the issue clears.",
      ],
    rollbackNotes:
      partial.rollbackNotes ??
      "Revert this PR — the change is isolated to the files listed and touches no application logic.",
    confidence: partial.confidence ?? 92,
  };
}

/**
 * Nuxt renders head tags from `app.head` in nuxt.config.ts, not from an HTML
 * layout, so its patches add an entry there.
 */
function nuxtHeadDiff(entry: string[]): string {
  return editDiff("nuxt.config.ts", [
    ` export default defineNuxtConfig({`,
    `+  app: {`,
    `+    head: {`,
    ...entry.map((l) => `+      ${l}`),
    `+    },`,
    `+  },`,
    `   /* ...existing config... */`,
    ` });`,
  ]);
}

const NUXT_MERGE_NOTE = "If `app.head` already exists, merge the entry into it.";

/**
 * The sitemap a robots.txt should name: the one the crawl read (the engine puts
 * it in the note), else the framework's usual file. @astrojs/sitemap writes
 * sitemap-index.xml and no sitemap.xml.
 */
function sitemapUrlFor(issue: SeoIssue, repo: Repository): string {
  const origin = originOf(repo);
  const read = issue.affectedUrls?.map((u) => u.note ?? "").find((n) => n.startsWith(`${origin}/`));
  return read ?? `${origin}/${repo.framework === "astro" ? "sitemap-index.xml" : "sitemap.xml"}`;
}

// ── robots.txt / robots route ───────────────────────────────────────
const buildRobots: Builder = (issue, repo) => {
  const fw = repo.framework;
  const sitemap = sitemapUrlFor(issue, repo);
  if (fw === "nextjs") {
    const path = "app/robots.ts";
    const code = [
      `import type { MetadataRoute } from "next";`,
      ``,
      `export default function robots(): MetadataRoute.Robots {`,
      `  return {`,
      `    rules: { userAgent: "*", allow: "/" },`,
      `    sitemap: "${sitemap}",`,
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
  const content = [`User-agent: *`, `Allow: /`, ``, `Sitemap: ${sitemap}`];
  return make(issue, "robots", {
    summary: `Add ${path} allowing crawling and referencing the sitemap.`,
    filesChanged: [path],
    diff: newFileDiff(path, content),
    prDescription: `Adds a static \`${path}\`:\n\n${fence}\n${content.join("\n")}\n${fence}`,
  });
};

// The robots.txt exists but names no sitemap: add the one line and keep every
// rule already there (rewriting the file would drop its Disallow lines).
const buildRobotsSitemapLine: Builder = (issue, repo) => {
  const fw = repo.framework;
  const sitemap = sitemapUrlFor(issue, repo);
  const keepNote = "If the site has several sitemaps, add one line per file, or name the index. The URL must be absolute.";
  if (fw === "nextjs") {
    const path = "app/robots.ts";
    return make(issue, "robots-sitemap", {
      summary: `Add a sitemap entry to the robots route (${path}).`,
      filesChanged: [path],
      diff: editDiff(path, [
        `   return {`,
        `     rules: { /* ...existing rules... */ },`,
        `+    sitemap: "${sitemap}",`,
        `   };`,
      ]),
      prDescription: `Adds \`sitemap\` to the object returned by \`${path}\`, so robots.txt ends with a Sitemap line. The existing rules are untouched. If the site serves a static public/robots.txt instead, add \`Sitemap: ${sitemap}\` at its end. ${keepNote}`,
    });
  }
  const path = fw === "sveltekit" ? "static/robots.txt" : "public/robots.txt";
  return make(issue, "robots-sitemap", {
    summary: `Add a Sitemap line to ${path}.`,
    filesChanged: [path],
    diff: editDiff(path, [` User-agent: *`, ` # ...existing rules...`, `+`, `+Sitemap: ${sitemap}`]),
    prDescription: `Appends \`Sitemap: ${sitemap}\` to \`${path}\`. The existing rules are untouched; the line can sit anywhere in the file, outside any group. ${keepNote}`,
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
  if (fw === "astro") {
    const path = "astro.config.mjs";
    return make(issue, "sitemap", {
      summary: "Turn on the @astrojs/sitemap integration and set `site`.",
      filesChanged: [path, "package.json"],
      diff: editDiff(path, [
        ` import { defineConfig } from "astro/config";`,
        `+import sitemap from "@astrojs/sitemap";`,
        ` `,
        ` export default defineConfig({`,
        `+  site: "${origin}",`,
        `+  integrations: [sitemap()],`,
        `   /* ...existing config... */`,
        ` });`,
      ]),
      prDescription: `Install the integration with \`npx astro add sitemap\`, which also edits \`${path}\`. It needs \`site\` to write absolute URLs, and the build then emits \`sitemap-index.xml\` and \`sitemap-0.xml\` (there is no sitemap.xml). If \`integrations\` already exists, add \`sitemap()\` to it.`,
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
  if (fw === "nuxt") {
    return make(issue, "viewport", {
      summary: "Set the responsive viewport in nuxt.config.ts.",
      filesChanged: ["nuxt.config.ts"],
      diff: nuxtHeadDiff([`viewport: "width=device-width, initial-scale=1",`]),
      prDescription: `Sets \`app.head.viewport\` so pages render responsively (required for mobile-first indexing). ${NUXT_MERGE_NOTE}`,
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
  if (fw === "nuxt") {
    return make(issue, "html-lang", {
      summary: 'Set the document language with lang="en" in nuxt.config.ts.',
      filesChanged: ["nuxt.config.ts"],
      diff: nuxtHeadDiff([`htmlAttrs: { lang: "en" },`]),
      prDescription: `Sets \`app.head.htmlAttrs.lang\` (change "en" to your primary language if it isn't English). ${NUXT_MERGE_NOTE}`,
      confidence: 85,
    });
  }
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
// A canonical added once to a shared layout has to resolve to EACH page's own
// URL. A fixed href there (the homepage, say) tells search engines that every
// page is a copy of that one, and they drop the others from the index.
const SELF_CANONICAL_NOTE =
  "A page that should point elsewhere (a duplicate, a filtered view) sets its own canonical instead.";

const buildCanonical: Builder = (issue, repo) => {
  const fw = repo.framework;
  const origin = originOf(repo);
  if (fw === "nextjs") {
    const path = "app/layout.tsx";
    const diff = editDiff(path, [
      ` export const metadata: Metadata = {`,
      `+  metadataBase: new URL("${origin}"),`,
      `+  // "./" resolves against each route's own path: every page points at itself.`,
      `+  alternates: { canonical: "./" },`,
      `   /* ...existing metadata... */`,
      ` };`,
    ]);
    return make(issue, "canonical", {
      summary: "Give every page a self-referencing canonical from the root layout (Metadata API).",
      filesChanged: [path],
      diff,
      prDescription: `Sets \`metadataBase\` and \`alternates.canonical: "./"\` in the root layout. Next.js resolves \`./\` against each route's path, so every page gets its own URL as canonical, without query strings. Don't use \`"/"\` here: every page inherits the layout's metadata and would point at the homepage. ${SELF_CANONICAL_NOTE}`,
      confidence: 88,
    });
  }
  if (fw === "astro" || fw === "mdx") {
    const path = layoutFile(fw);
    const diff = editDiff(path, [
      `   <head>`,
      `+    <link rel="canonical" href={new URL(Astro.url.pathname, Astro.site ?? "${origin}").href} />`,
      `   </head>`,
    ]);
    return make(issue, "canonical", {
      summary: "Add a self-referencing canonical to the shared layout, built from each page's path.",
      filesChanged: [path],
      diff,
      prDescription: `Adds a \`<link rel="canonical">\` built from \`Astro.url.pathname\`, so every page using this layout points at its own URL. Set \`site\` in \`astro.config.mjs\` to your production domain. ${SELF_CANONICAL_NOTE}`,
      confidence: 85,
    });
  }
  if (fw === "sveltekit") {
    const path = "src/routes/+layout.svelte";
    const diff = editDiff(path, [
      `+<script>`,
      `+  import { page } from "$app/state";`,
      `+</script>`,
      `+`,
      `+<svelte:head>`,
      `+  <link rel="canonical" href={new URL(page.url.pathname, "${origin}").href} />`,
      `+</svelte:head>`,
    ]);
    return make(issue, "canonical", {
      summary: "Add a self-referencing canonical to the root layout, built from each page's path.",
      filesChanged: [path],
      diff,
      prDescription: `Adds a canonical built from \`page.url.pathname\` to the root \`+layout.svelte\`, so every page points at its own URL. If the layout already has a \`<script>\` block, put the import there. Before SvelteKit 2.12, import \`page\` from \`$app/stores\` and read \`$page.url.pathname\`. ${SELF_CANONICAL_NOTE}`,
      confidence: 82,
    });
  }
  if (fw === "remix") {
    const path = "app/root.tsx";
    const diff = editDiff(path, [
      `+import { useLocation } from "@remix-run/react";`,
      ` `,
      ` export function Layout({ children }: { children: React.ReactNode }) {`,
      `+  const { pathname } = useLocation();`,
      `   return (`,
      `     <html lang="en">`,
      `       <head>`,
      `+        <link rel="canonical" href={new URL(pathname, "${origin}").href} />`,
    ]);
    return make(issue, "canonical", {
      summary: "Add a self-referencing canonical to the root layout, built from the current path.",
      filesChanged: [path],
      diff,
      prDescription: `Adds a canonical built from the current location in \`app/root.tsx\`, so every route points at its own URL. On React Router 7, import \`useLocation\` from \`react-router\`. ${SELF_CANONICAL_NOTE}`,
      confidence: 82,
    });
  }
  if (fw === "nuxt") {
    const path = "app.vue";
    const diff = editDiff(path, [
      ` <script setup lang="ts">`,
      `+const route = useRoute();`,
      `+useHead({`,
      `+  link: [{ rel: "canonical", href: computed(() => new URL(route.path, "${origin}").href) }],`,
      `+});`,
      ` </script>`,
    ]);
    return make(issue, "canonical", {
      summary: "Add a self-referencing canonical in app.vue, built from the current route.",
      filesChanged: [path],
      diff,
      prDescription: `Adds a canonical built from \`route.path\` in \`app.vue\`, so every page points at its own URL. If \`app.vue\` has no \`<script setup>\` block yet, add one. ${SELF_CANONICAL_NOTE}`,
      confidence: 80,
    });
  }
  if (fw === "vite-react") {
    const path = "src/Canonical.tsx";
    const code = [
      `import { useLocation } from "react-router-dom";`,
      ``,
      `/** Self-referencing canonical for the current route. React 19 moves <link> into <head>. */`,
      `export function Canonical() {`,
      `  const { pathname } = useLocation();`,
      `  return <link rel="canonical" href={new URL(pathname, "${origin}").href} />;`,
      `}`,
    ];
    return make(issue, "canonical", {
      summary: "Add a Canonical component that gives each route its own URL (React 19 + React Router).",
      filesChanged: [path],
      diff: newFileDiff(path, code),
      prDescription: `Adds \`${path}\`. Render \`<Canonical />\` once inside your router, in the layout every route shares. Don't put a fixed canonical in \`index.html\`: a single-page app serves that file for every route, so they would all point at one URL. Crawlers that don't run JavaScript (most AI crawlers) won't see a canonical set at runtime; prerendering the routes fixes that. ${SELF_CANONICAL_NOTE}`,
      confidence: 60,
    });
  }
  // static: one HTML file per page, and index.html is the homepage.
  const path = "index.html";
  const diff = editDiff(path, [
    `   <head>`,
    `+    <link rel="canonical" href="${origin}/" />`,
    `   </head>`,
  ]);
  return make(issue, "canonical", {
    summary: "Add the homepage's canonical; every other page gets the same tag with its own URL.",
    filesChanged: [path],
    diff,
    prDescription: `Adds a canonical to \`index.html\`, the homepage. Each other HTML file needs the same tag with its own URL (\`${origin}/about/\` in \`about/index.html\`, and so on). Copying this one unchanged would tell search engines that every page is a copy of the homepage.`,
    confidence: 75,
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
  if (fw === "nuxt") {
    return make(issue, "schema", {
      summary: "Emit WebSite JSON-LD structured data from nuxt.config.ts.",
      filesChanged: ["nuxt.config.ts"],
      diff: nuxtHeadDiff([`script: [{ type: "application/ld+json", innerHTML: ${JSON.stringify(JSON.stringify(json))} }],`]),
      prDescription: `Adds a JSON-LD \`WebSite\` block through \`app.head.script\` so search engines understand site identity. ${NUXT_MERGE_NOTE}`,
      confidence: 78,
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
  const origin = originOf(repo);
  if (fw === "nuxt") {
    return make(issue, "og-image", {
      summary: "Reference an OpenGraph image in nuxt.config.ts.",
      filesChanged: ["nuxt.config.ts"],
      diff: nuxtHeadDiff([`meta: [{ property: "og:image", content: "${origin}/og-cover.png" }],`]),
      prDescription: `Adds an \`og:image\` meta through \`app.head.meta\`. Provide a 1200×630 image at \`public/og-cover.png\`. ${NUXT_MERGE_NOTE}`,
      confidence: 65,
    });
  }
  const path = layoutFile(fw);
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

// og:image is set but relative or on localhost. In Next.js that is a missing
// metadataBase: relative image and canonical URLs resolve against it.
const buildOgImageUrl: Builder = (issue, repo) => {
  const fw = repo.framework;
  const origin = originOf(repo);
  if (fw === "nextjs") {
    const path = "app/layout.tsx";
    return make(issue, "og-image-url", {
      summary: `Set metadataBase in ${path} so og:image resolves to ${origin}.`,
      filesChanged: [path],
      diff: editDiff(path, [
        ` export const metadata: Metadata = {`,
        `+  metadataBase: new URL("${origin}"),`,
        `   /* ...existing metadata... */`,
        ` };`,
      ]),
      prDescription: `Adds \`metadataBase\` to the root layout's metadata, which every route inherits. Next.js resolves relative \`openGraph.images\`, \`twitter.images\` and \`alternates.canonical\` against it. Without it, images fall back to the deployment URL on Vercel and to http://localhost:3000 everywhere else, and a relative canonical is printed as is. Read the origin from an environment variable if you prefer, but it must be defined when \`next build\` runs.`,
      confidence: 85,
    });
  }
  if (fw === "nuxt") {
    return make(issue, "og-image-url", {
      summary: "Write og:image as an absolute URL in nuxt.config.ts.",
      filesChanged: ["nuxt.config.ts"],
      diff: nuxtHeadDiff([`meta: [{ property: "og:image", content: "${origin}/og-cover.png" }],`]),
      prDescription: `Gives \`og:image\` the full URL of the image. Pages that set their own image with useSeoMeta need the same absolute form. ${NUXT_MERGE_NOTE}`,
      confidence: 65,
    });
  }
  if (fw === "astro") {
    const path = layoutFile(fw);
    return make(issue, "og-image-url", {
      summary: `Build og:image from Astro.site in ${path}.`,
      filesChanged: [path],
      diff: editDiff(path, [
        `   <head>`,
        `-    <meta property="og:image" content="/og-cover.png" />`,
        `+    <meta property="og:image" content={new URL("/og-cover.png", Astro.site)} />`,
        `   </head>`,
      ]),
      prDescription: "Resolves the image against `site` from astro.config.mjs, so every page gets an absolute URL. `site` must be set.",
      confidence: 70,
    });
  }
  const path = layoutFile(fw);
  return make(issue, "og-image-url", {
    summary: `Write og:image as an absolute URL in ${path}.`,
    filesChanged: [path],
    diff: editDiff(path, [
      `   <head>`,
      `-    <meta property="og:image" content="/og-cover.png" />`,
      `+    <meta property="og:image" content="${origin}/og-cover.png" />`,
      `   </head>`,
    ]),
    prDescription: "Replaces the relative path with the image's full URL on the production domain.",
    confidence: 65,
  });
};

// ── Rule → builder registry ─────────────────────────────────────────
const BUILDERS: Record<string, Builder> = {
  "framework-robots-missing": buildRobots,
  "framework-robots-no-sitemap": buildRobotsSitemapLine,
  "framework-sitemap-missing": buildSitemap,
  "perf-viewport-missing": buildViewport,
  "indexing-html-lang-missing": buildLang,
  "indexing-canonical-missing": buildCanonical,
  "schema-missing": buildSchema,
  "schema-website-missing": buildSchema,
  "meta-og-image-missing": buildOgImage,
  "meta-og-image-url": buildOgImageUrl,
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
