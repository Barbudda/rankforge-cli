import type {
  Effort,
  Framework,
  Repository,
  Risk,
  SeoCategory,
  Severity,
} from "@/types";
import type { CrawledPage } from "./types";
import { buildLinkGraph, normalizePath } from "./link-graph";
import { analyzeContent, type ContentAnalysis } from "./content";
import { analyzeContentIntel } from "./content-intel";
import type { ResourceReport } from "./resource-probe";

/** Presence of the well-known SEO files, probed by the crawler. */
export interface SiteFilesInput {
  hasSitemap: boolean;
  hasRobots: boolean;
  robotsDeclaresSitemap: boolean;
}

/**
 * Deterministic technical-SEO audit engine — the autonomous core of RankForge.
 *
 * It runs with ZERO external APIs and ZERO LLM calls: every finding here is
 * derived by parsing the crawled HTML and computing over the link graph and
 * content. An optional LLM pass can enrich these results, but the engine
 * stands entirely on its own, which is what makes RankForge self-reliant.
 *
 * Findings are aggregated the way real audit tools present them: one issue per
 * rule, carrying every affected URL (e.g. "duplicate <title> ×128"), so the
 * deterministic issue id stays stable across re-audits.
 */

export interface EngineIssue {
  ruleId: string;
  category: SeoCategory;
  title: string;
  description: string;
  impact: Severity;
  effort: Effort;
  risk: Risk;
  confidence: number;
  evidence: string;
  affectedUrls: { url: string; note?: string }[];
  files: { path: string; reason: string; confidence: number }[];
  canAutoFix: boolean;
}

export interface EngineResult {
  issues: EngineIssue[];
  categoryScores: Record<SeoCategory, number>;
  siteSignals: {
    pagesScanned: number;
    maxDepth: number;
    orphanPages: string[];
    brokenInternalLinks: { from: string; href: string; status: number }[];
    duplicateClusters: ContentAnalysis["duplicateClusters"];
    linkSuggestions: ContentAnalysis["linkSuggestions"];
    /** Pages ranked by internal PageRank (path → score), strongest first. */
    authorityRanking: { path: string; pageRank: number }[];
  };
}

// ── Framework file hints ────────────────────────────────────────────
// Best-guess source locations per framework, so findings point somewhere
// actionable even before the fix swarm inspects the repo.
function fileHint(framework: Framework, kind: "layout" | "page" | "config" | "sitemap" | "robots"): string {
  const map: Record<Framework, Record<string, string>> = {
    nextjs: { layout: "app/layout.tsx", page: "app/**/page.tsx", config: "next.config.mjs", sitemap: "app/sitemap.ts", robots: "app/robots.ts" },
    nuxt: { layout: "app.vue", page: "pages/**/*.vue", config: "nuxt.config.ts", sitemap: "server/routes/sitemap.xml.ts", robots: "public/robots.txt" },
    astro: { layout: "src/layouts/Layout.astro", page: "src/pages/**/*.astro", config: "astro.config.mjs", sitemap: "astro.config.mjs (sitemap integration)", robots: "public/robots.txt" },
    sveltekit: { layout: "src/routes/+layout.svelte", page: "src/routes/**/+page.svelte", config: "svelte.config.js", sitemap: "src/routes/sitemap.xml/+server.ts", robots: "static/robots.txt" },
    remix: { layout: "app/root.tsx", page: "app/routes/**/*.tsx", config: "remix.config.js", sitemap: "app/routes/sitemap[.]xml.tsx", robots: "public/robots.txt" },
    "vite-react": { layout: "index.html", page: "src/**/*.tsx", config: "vite.config.ts", sitemap: "public/sitemap.xml", robots: "public/robots.txt" },
    mdx: { layout: "src/layouts/*", page: "content/**/*.mdx", config: "config.*", sitemap: "public/sitemap.xml", robots: "public/robots.txt" },
    static: { layout: "template.html", page: "**/*.html", config: "-", sitemap: "sitemap.xml", robots: "robots.txt" },
  };
  return map[framework]?.[kind] ?? "-";
}

/** Health penalty knobs per severity — used to turn issue counts into scores. */
const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 26,
  high: 15,
  medium: 8,
  low: 3,
};

const ALL_CATEGORIES: SeoCategory[] = [
  "metadata",
  "indexing",
  "structure",
  "images",
  "schema",
  "internal-linking",
  "performance",
  "framework",
];

/** Required properties per common schema.org type (Google rich-results). */
const SCHEMA_REQUIRED: Record<string, string[]> = {
  Article: ["headline"],
  BlogPosting: ["headline"],
  NewsArticle: ["headline"],
  Product: ["name"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  Organization: ["name"],
  Event: ["name", "startDate"],
  Recipe: ["name"],
  Question: ["name", "acceptedAnswer"],
  JobPosting: ["title", "datePosted"],
};

/** Validate JSON-LD nodes on a page against required properties. */
function validateJsonLd(page: CrawledPage): string[] {
  const problems: string[] = [];
  const visit = (node: unknown) => {
    // A JSON-LD script can be a top-level array of nodes ([{…},{…}]).
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const o = node as Record<string, unknown> | null;
    if (!o || typeof o !== "object") return;
    const graph = o["@graph"];
    if (Array.isArray(graph)) {
      graph.forEach(visit);
      return;
    }
    const t = o["@type"];
    const types = typeof t === "string" ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
    for (const type of types) {
      const required = SCHEMA_REQUIRED[type];
      if (!required) continue;
      const missing = required.filter((prop) => o[prop] === undefined || o[prop] === null || o[prop] === "");
      if (missing.length) problems.push(`${type} missing ${missing.join(", ")}`);
    }
  };
  page.jsonLd.forEach(visit);
  return problems;
}

/** JSON-LD @type set present on a page (handles @graph). */
function jsonLdTypes(page: CrawledPage): Set<string> {
  const types = new Set<string>();
  const add = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(add);
      return;
    }
    const o = node as Record<string, unknown> | null;
    if (!o || typeof o !== "object") return;
    const t = o["@type"];
    if (typeof t === "string") types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
    const graph = o["@graph"];
    if (Array.isArray(graph)) graph.forEach(add);
  };
  page.jsonLd.forEach(add);
  return types;
}

/**
 * Run the full deterministic audit over a crawled site.
 */
export function runDeterministicAudit(
  repo: Repository,
  pages: CrawledPage[],
  siteFiles?: SiteFilesInput,
  resources?: ResourceReport,
): EngineResult {
  const fw = repo.framework;
  const startUrl = repo.productionUrl;
  const issues: EngineIssue[] = [];

  // HTML 200 pages only feed most content checks; fetch errors are their own.
  const ok = pages.filter((p) => p.statusCode >= 200 && p.statusCode < 300);
  const errored = pages.filter((p) => p.statusCode >= 400);

  const push = (i: EngineIssue) => {
    if (i.affectedUrls.length > 0) issues.push(i);
  };
  const norm = (u: string) => normalizePath(u, startUrl) ?? u;

  // ══ METADATA ══════════════════════════════════════════════════════
  const noTitle = ok.filter((p) => !p.title || p.title.trim().length === 0);
  push({
    ruleId: "meta-title-missing",
    category: "metadata",
    title: "Pages missing a <title>",
    description:
      "Every indexable page needs a unique, descriptive <title> — it's the strongest on-page metadata signal and the clickable headline in search results.",
    impact: "high",
    effort: "low",
    risk: "low",
    confidence: 100,
    evidence: `${noTitle.length} of ${ok.length} crawled pages have no <title>.`,
    affectedUrls: noTitle.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "layout"), reason: "Where the document <title> is set (or generateMetadata).", confidence: 60 }],
    canAutoFix: true,
  });

  const shortTitle = ok.filter((p) => p.title && p.title.trim().length > 0 && p.title.trim().length < 15);
  const longTitle = ok.filter((p) => p.title && p.title.trim().length > 65);
  push({
    ruleId: "meta-title-length",
    category: "metadata",
    title: "Titles outside the ideal length",
    description:
      "Titles under ~15 or over ~65 characters get truncated or look thin in results. Aim for a concise, keyword-leading title per page.",
    impact: "low",
    effort: "low",
    risk: "low",
    confidence: 90,
    evidence: `${shortTitle.length} too short, ${longTitle.length} over 65 chars.`,
    affectedUrls: [...shortTitle, ...longTitle].map((p) => ({
      url: norm(p.url),
      note: `${p.title!.length} chars`,
    })),
    files: [{ path: fileHint(fw, "page"), reason: "Per-page title source.", confidence: 45 }],
    canAutoFix: false,
  });

  // Duplicate titles across pages. Guard trimmed-non-empty so whitespace-only
  // titles aren't reported as BOTH "missing" and "duplicate".
  const titleGroups = groupBy(
    ok.filter((p) => p.title && p.title.trim().length > 0),
    (p) => p.title!.trim().toLowerCase(),
  );
  const dupTitlePages = Object.values(titleGroups).filter((g) => g.length > 1).flat();
  push({
    ruleId: "meta-title-duplicate",
    category: "metadata",
    title: "Duplicate titles across pages",
    description:
      "Multiple pages share the same <title>, so search engines can't tell them apart. Each page should have a title unique to its content.",
    impact: "medium",
    effort: "medium",
    risk: "low",
    confidence: 100,
    evidence: `${dupTitlePages.length} pages share a title with at least one other page.`,
    affectedUrls: dupTitlePages.map((p) => ({ url: norm(p.url), note: p.title! })),
    files: [{ path: fileHint(fw, "page"), reason: "Templated title needs page-specific values.", confidence: 50 }],
    canAutoFix: false,
  });

  const noDesc = ok.filter((p) => !p.metaDescription || p.metaDescription.trim().length === 0);
  push({
    ruleId: "meta-description-missing",
    category: "metadata",
    title: "Pages missing a meta description",
    description:
      "A meta description is the snippet under your result. Missing ones let search engines auto-generate a worse one; each page should have a concise, compelling description.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 100,
    evidence: `${noDesc.length} of ${ok.length} pages have no meta description.`,
    affectedUrls: noDesc.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "layout"), reason: "Default + per-page description source.", confidence: 55 }],
    canAutoFix: true,
  });

  const dupDescGroups = groupBy(
    ok.filter((p) => p.metaDescription && p.metaDescription.trim().length > 0),
    (p) => p.metaDescription!.trim().toLowerCase(),
  );
  const dupDescPages = Object.values(dupDescGroups).filter((g) => g.length > 1).flat();
  push({
    ruleId: "meta-description-duplicate",
    category: "metadata",
    title: "Duplicate meta descriptions",
    description:
      "Several pages reuse the same meta description. Unique descriptions per page improve click-through and help disambiguate similar pages.",
    impact: "low",
    effort: "medium",
    risk: "low",
    confidence: 100,
    evidence: `${dupDescPages.length} pages share a description with another page.`,
    affectedUrls: dupDescPages.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "page"), reason: "Description is templated, not per-page.", confidence: 50 }],
    canAutoFix: false,
  });

  // Social cards (OG + Twitter).
  const noOgImage = ok.filter((p) => !p.og["og:image"]);
  push({
    ruleId: "meta-og-image-missing",
    category: "metadata",
    title: "Pages without an OpenGraph image",
    description:
      "og:image controls the preview when your pages are shared on social and chat. Missing it means a blank or wrong card, hurting referral traffic.",
    impact: "low",
    effort: "low",
    risk: "low",
    confidence: 95,
    evidence: `${noOgImage.length} pages have no og:image.`,
    affectedUrls: noOgImage.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "layout"), reason: "OpenGraph metadata is usually set in the layout/head.", confidence: 55 }],
    canAutoFix: true,
  });

  // ══ INDEXING ══════════════════════════════════════════════════════
  const accidentalNoindex = ok.filter((p) => p.metaRobots?.includes("noindex"));
  push({
    ruleId: "indexing-noindex",
    category: "indexing",
    title: "Pages set to noindex",
    description:
      "These pages tell search engines not to index them. If that's unintended, they're invisible in search. Confirm each noindex is deliberate.",
    impact: "critical",
    effort: "low",
    risk: "medium",
    confidence: 100,
    evidence: `${accidentalNoindex.length} pages carry a robots noindex directive.`,
    affectedUrls: accidentalNoindex.map((p) => ({ url: norm(p.url), note: p.metaRobots ?? "" })),
    files: [{ path: fileHint(fw, "page"), reason: "Where the robots meta / metadata.robots is emitted.", confidence: 50 }],
    canAutoFix: false,
  });

  const noCanonical = ok.filter((p) => !p.canonical);
  push({
    ruleId: "indexing-canonical-missing",
    category: "indexing",
    title: "Pages missing a canonical URL",
    description:
      "A canonical link tells search engines the preferred URL for a page, consolidating ranking signals and preventing duplicate-content dilution.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 95,
    evidence: `${noCanonical.length} of ${ok.length} pages declare no canonical.`,
    affectedUrls: noCanonical.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "layout"), reason: "alternates.canonical / <link rel=canonical> source.", confidence: 55 }],
    canAutoFix: true,
  });

  // Canonical pointing off-site or to a different path than the page itself.
  const canonicalMismatch = ok.filter((p) => {
    if (!p.canonical) return false;
    const c = normalizePath(p.canonical, startUrl);
    const self = normalizePath(p.url, startUrl);
    // Only flag when canonical is same-origin but a different path (likely a
    // templating bug), not deliberate cross-page canonicalization we can't judge.
    let sameOrigin = false;
    try {
      sameOrigin = new URL(p.canonical, startUrl).origin === new URL(startUrl).origin;
    } catch {
      return false;
    }
    return sameOrigin && c !== null && self !== null && c !== self;
  });
  push({
    ruleId: "indexing-canonical-mismatch",
    category: "indexing",
    title: "Canonical points to a different page",
    description:
      "The canonical URL differs from the page's own URL, which can de-index the page in favor of another. Verify these are intentional, not a templating bug.",
    impact: "high",
    effort: "medium",
    risk: "medium",
    confidence: 80,
    evidence: `${canonicalMismatch.length} pages canonicalize to a different same-site path.`,
    affectedUrls: canonicalMismatch.map((p) => ({ url: norm(p.url), note: `→ ${p.canonical}` })),
    files: [{ path: fileHint(fw, "page"), reason: "Canonical is computed wrong for these routes.", confidence: 45 }],
    canAutoFix: false,
  });

  const noLang = ok.filter((p) => !p.lang);
  push({
    ruleId: "indexing-html-lang-missing",
    category: "indexing",
    title: "Missing <html lang> attribute",
    description:
      "The lang attribute declares the page language for search engines and assistive tech. Add it to the <html> element site-wide.",
    impact: "low",
    effort: "low",
    risk: "low",
    confidence: 100,
    evidence: `${noLang.length} pages have no <html lang> attribute.`,
    affectedUrls: noLang.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "layout"), reason: "The root <html> element lives in the layout.", confidence: 70 }],
    canAutoFix: true,
  });

  // Broken pages surfaced by the crawl itself.
  push({
    ruleId: "indexing-broken-page",
    category: "indexing",
    title: "Pages returning an error status",
    description:
      "These URLs were linked internally but returned a 4xx/5xx. Broken pages waste crawl budget and frustrate users. Fix or redirect them.",
    impact: "high",
    effort: "medium",
    risk: "low",
    confidence: 100,
    evidence: `${errored.length} crawled URLs returned HTTP ≥400.`,
    affectedUrls: errored.map((p) => ({ url: norm(p.url), note: `HTTP ${p.statusCode}` })),
    files: [{ path: fileHint(fw, "page"), reason: "Route missing or throwing.", confidence: 30 }],
    canAutoFix: false,
  });

  // ══ STRUCTURE ═════════════════════════════════════════════════════
  const noH1 = ok.filter((p) => p.h1s.length === 0);
  const multiH1 = ok.filter((p) => p.h1s.length > 1);
  push({
    ruleId: "structure-h1-missing",
    category: "structure",
    title: "Pages with no <h1>",
    description:
      "The H1 is the primary on-page heading that frames the page topic. Each page should have exactly one clear H1.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 100,
    evidence: `${noH1.length} pages have no H1.`,
    affectedUrls: noH1.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "page"), reason: "Page template renders the main heading.", confidence: 45 }],
    canAutoFix: false,
  });
  push({
    ruleId: "structure-h1-multiple",
    category: "structure",
    title: "Pages with multiple <h1> elements",
    description:
      "More than one H1 dilutes the page's topical focus and signals a heading-hierarchy problem. Demote extras to H2/H3.",
    impact: "low",
    effort: "low",
    risk: "low",
    confidence: 100,
    evidence: `${multiH1.length} pages have more than one H1.`,
    affectedUrls: multiH1.map((p) => ({ url: norm(p.url), note: `${p.h1s.length} H1s` })),
    files: [{ path: fileHint(fw, "page"), reason: "Template emits multiple H1s.", confidence: 40 }],
    canAutoFix: false,
  });

  // Heading hierarchy skips (e.g. h1 → h3 with no h2).
  const skips = ok.filter((p) => {
    let prev = 0;
    for (const h of p.headings) {
      if (prev && h.level > prev + 1) return true;
      prev = h.level;
    }
    return false;
  });
  push({
    ruleId: "structure-heading-skip",
    category: "structure",
    title: "Heading levels skip a rank",
    description:
      "Heading levels jump (e.g. H1 straight to H3), which breaks the document outline for search engines and screen readers. Keep levels sequential.",
    impact: "low",
    effort: "low",
    risk: "low",
    confidence: 85,
    evidence: `${skips.length} pages skip a heading level.`,
    affectedUrls: skips.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "page"), reason: "Heading markup in the page/components.", confidence: 35 }],
    canAutoFix: false,
  });

  // ── Content intelligence (TF-IDF topic, alignment, readability, stuffing) ──
  const intel = analyzeContentIntel(pages, startUrl);
  const misaligned: { url: string; note?: string }[] = [];
  const hardToRead: { url: string; note?: string }[] = [];
  const stuffed: { url: string; note?: string }[] = [];
  // Light stemmer so "routing" in the body matches "routes" in the title.
  const stem = (w: string) => w.replace(/(ing|ed|es|s)$/i, "");
  for (const [, pi] of intel.perPage) {
    if (pi.wordCount >= 200 && pi.topTerms.length >= 3) {
      // Word-boundary + stemmed match (not substring): does the title/H1
      // reflect ANY of the page's top-5 topic terms? Widened to top-5 and
      // stemmed to avoid false "misalignment" on morphological variants.
      const titleStems = new Set(
        pi.titleAndH1.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map(stem),
      );
      const top5 = pi.topTerms.slice(0, 5).map((t) => t.term);
      const anyPresent = top5.some((t) => titleStems.has(stem(t)));
      if (!anyPresent) {
        misaligned.push({ url: pi.path, note: `topic: ${top5.slice(0, 3).join(", ")}` });
      }
    }
    if (pi.wordCount >= 200 && pi.readability < 20) {
      hardToRead.push({ url: pi.path, note: `Flesch ${pi.readability}` });
    }
    if (pi.stuffed.length) {
      stuffed.push({ url: pi.path, note: pi.stuffed.map((s) => `${s.term} ${s.density}%`).join(", ") });
    }
  }
  push({
    ruleId: "content-keyword-alignment",
    category: "metadata",
    title: "Title/H1 don't reflect the page's content",
    description:
      "The page's main topic terms (computed from its text) don't appear in its title or H1. Aligning the title and heading with the actual content strengthens topical relevance.",
    impact: "low",
    effort: "low",
    risk: "low",
    confidence: 55,
    evidence: `${misaligned.length} pages whose top topic terms are absent from the title and H1.`,
    affectedUrls: misaligned.slice(0, 40),
    files: [{ path: fileHint(fw, "page"), reason: "Update the title/H1 to include the page's real subject.", confidence: 40 }],
    canAutoFix: false,
  });
  push({
    ruleId: "content-readability",
    category: "structure",
    title: "Hard-to-read content",
    description:
      "These pages score extremely low on readability (Flesch < 20 = very dense). Simpler sentences and words widen your audience and improve engagement signals.",
    impact: "low",
    effort: "medium",
    risk: "low",
    confidence: 55,
    evidence: `${hardToRead.length} content pages are very hard to read (Flesch < 20).`,
    affectedUrls: hardToRead.slice(0, 40),
    files: [],
    canAutoFix: false,
  });
  push({
    ruleId: "content-keyword-stuffing",
    category: "structure",
    title: "Possible keyword stuffing",
    description:
      "Some terms appear at unusually high density (>6% of the text), which reads as keyword stuffing and can trigger quality penalties. Vary wording naturally.",
    impact: "medium",
    effort: "medium",
    risk: "low",
    confidence: 70,
    evidence: `${stuffed.length} pages have an over-dense term.`,
    affectedUrls: stuffed.slice(0, 40),
    files: [],
    canAutoFix: false,
  });

  // Thin content.
  const thin = ok.filter((p) => p.wordCount < 120);
  push({
    ruleId: "structure-thin-content",
    category: "structure",
    title: "Thin-content pages",
    description:
      "These pages have very little text (under ~120 words). Thin pages rank poorly and can trigger quality flags. Expand them or consolidate.",
    impact: "medium",
    effort: "high",
    risk: "low",
    confidence: 80,
    evidence: `${thin.length} pages have under 120 words of visible text.`,
    affectedUrls: thin.map((p) => ({ url: norm(p.url), note: `${p.wordCount} words` })),
    files: [],
    canAutoFix: false,
  });

  // ══ IMAGES ════════════════════════════════════════════════════════
  const imgNoAltPages = ok
    .map((p) => ({ p, missing: p.images.filter((im) => !im.alt || !im.alt.trim()).length }))
    .filter((x) => x.missing > 0);
  push({
    ruleId: "img-alt-missing",
    category: "images",
    title: "Images missing alt text",
    description:
      "Alt text describes images to search engines and assistive tech, and is a ranking signal for image search. Add descriptive alt to meaningful images.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 100,
    evidence: `${imgNoAltPages.reduce((s, x) => s + x.missing, 0)} images without alt across ${imgNoAltPages.length} pages.`,
    affectedUrls: imgNoAltPages.map((x) => ({ url: norm(x.p.url), note: `${x.missing} images` })),
    files: [{ path: fileHint(fw, "page"), reason: "Image components/markup need alt props.", confidence: 40 }],
    canAutoFix: true,
  });

  const imgNoDimsPages = ok.filter((p) => p.imagesMissingDims > 0);
  push({
    ruleId: "img-dimensions-missing",
    category: "images",
    title: "Images without width/height",
    description:
      "Images lacking explicit dimensions cause layout shift (CLS), a Core Web Vitals metric. Set width and height (or aspect-ratio) on images.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 90,
    evidence: `${imgNoDimsPages.reduce((s, p) => s + p.imagesMissingDims, 0)} images without dimensions.`,
    affectedUrls: imgNoDimsPages.map((p) => ({ url: norm(p.url), note: `${p.imagesMissingDims} images` })),
    files: [{ path: fileHint(fw, "page"), reason: "Image tags/components need width & height.", confidence: 40 }],
    canAutoFix: true,
  });

  // Below-the-fold images not lazy-loaded (heuristic: pages with many images,
  // few of them lazy).
  const eagerHeavy = ok.filter((p) => {
    if (p.images.length < 5) return false;
    const lazy = p.images.filter((im) => im.loading === "lazy").length;
    return lazy / p.images.length < 0.3;
  });
  push({
    ruleId: "img-lazy-missing",
    category: "images",
    title: "Image-heavy pages without lazy loading",
    description:
      "Pages with many images but little loading=\"lazy\" force the browser to fetch off-screen images upfront, slowing load. Lazy-load below-the-fold images.",
    impact: "low",
    effort: "low",
    risk: "low",
    confidence: 70,
    evidence: `${eagerHeavy.length} image-heavy pages lazy-load under 30% of images.`,
    affectedUrls: eagerHeavy.map((p) => ({ url: norm(p.url), note: `${p.images.length} images` })),
    files: [{ path: fileHint(fw, "page"), reason: "Add loading=lazy to below-the-fold images.", confidence: 40 }],
    canAutoFix: true,
  });

  // ══ SCHEMA ════════════════════════════════════════════════════════
  const noSchema = ok.filter((p) => p.jsonLd.length === 0);
  push({
    ruleId: "schema-missing",
    category: "schema",
    title: "Pages without structured data",
    description:
      "No JSON-LD structured data was found. Schema.org markup unlocks rich results (breadcrumbs, articles, products, FAQs) and clarifies page meaning.",
    impact: "medium",
    effort: "medium",
    risk: "low",
    confidence: 90,
    evidence: `${noSchema.length} of ${ok.length} pages emit no JSON-LD.`,
    affectedUrls: noSchema.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "layout"), reason: "Add a JSON-LD script (WebSite/Organization at least).", confidence: 45 }],
    canAutoFix: true,
  });

  // Invalid structured data — parsed JSON-LD missing required properties.
  const invalidSchema: { url: string; note?: string }[] = [];
  for (const p of ok) {
    const probs = validateJsonLd(p);
    if (probs.length) invalidSchema.push({ url: norm(p.url), note: probs.slice(0, 3).join("; ") });
  }
  push({
    ruleId: "schema-invalid",
    category: "schema",
    title: "Structured data missing required properties",
    description:
      "These pages have JSON-LD that's missing properties Google requires for rich results (e.g. an Article without a headline). Add the required fields so the markup is eligible.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 90,
    evidence: `${invalidSchema.length} pages have JSON-LD missing required properties.`,
    affectedUrls: invalidSchema.slice(0, 40),
    files: [{ path: fileHint(fw, "layout"), reason: "Fill in the required schema.org properties.", confidence: 45 }],
    canAutoFix: false,
  });

  // Homepage should carry Organization/WebSite; flag if missing.
  const home = ok.find((p) => normalizePath(p.url, startUrl) === (normalizePath(startUrl, startUrl) ?? "/"));
  if (home) {
    const types = jsonLdTypes(home);
    if (!types.has("Organization") && !types.has("WebSite")) {
      push({
        ruleId: "schema-website-missing",
        category: "schema",
        title: "Homepage lacks Organization/WebSite schema",
        description:
          "The homepage has no Organization or WebSite structured data. These establish site identity and enable the search box and knowledge-panel features.",
        impact: "low",
        effort: "low",
        risk: "low",
        confidence: 85,
        evidence: `Homepage JSON-LD types: ${[...types].join(", ") || "(none)"}.`,
        affectedUrls: [{ url: norm(home.url) }],
        files: [{ path: fileHint(fw, "layout"), reason: "Emit siteGraph JSON-LD in the root layout.", confidence: 55 }],
        canAutoFix: true,
      });
    }
  }

  // ══ INTERNAL LINKING (graph) ══════════════════════════════════════
  const graph = buildLinkGraph(pages, startUrl);
  push({
    ruleId: "link-orphan-pages",
    category: "internal-linking",
    title: "Orphan pages (no internal links in)",
    description:
      "These crawled pages receive no internal links from other pages, so they're hard for crawlers and users to discover. Link to them from relevant pages.",
    impact: "high",
    effort: "medium",
    risk: "low",
    confidence: 90,
    evidence: `${graph.orphans.length} pages have zero internal inbound links.`,
    affectedUrls: graph.orphans.map((path) => ({ url: path })),
    files: [{ path: fileHint(fw, "page"), reason: "Add contextual links pointing to these pages.", confidence: 30 }],
    canAutoFix: false,
  });

  const deepPages = graph.paths
    .map((path, i) => ({ path, depth: graph.depth[i] ?? 0 }))
    .filter((x) => x.depth >= 4);
  push({
    ruleId: "link-deep-pages",
    category: "internal-linking",
    title: "Pages buried deep in the click path",
    description:
      "These pages sit 4+ clicks from the homepage. Deep pages get less crawl attention and pass less link equity. Flatten the path with closer internal links.",
    impact: "medium",
    effort: "medium",
    risk: "low",
    confidence: 80,
    evidence: `${deepPages.length} pages are ≥4 clicks deep (max depth ${graph.maxDepth}).`,
    affectedUrls: deepPages.map((x) => ({ url: x.path, note: `depth ${x.depth}` })),
    files: [],
    canAutoFix: false,
  });

  push({
    ruleId: "link-broken-internal",
    category: "internal-linking",
    title: "Internal links to broken pages",
    description:
      "Internal links point to URLs that return an error. Broken internal links waste crawl budget and hurt UX. Update or remove them.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 100,
    evidence: `${graph.brokenInternal.length} internal links resolve to a 4xx/5xx page.`,
    affectedUrls: dedupeUrls(graph.brokenInternal.map((b) => ({ url: b.from, note: `→ ${b.href} (${b.status})` }))),
    files: [],
    canAutoFix: false,
  });

  // Anchor quality: generic anchors ("click here", "read more", "here").
  const genericAnchors = new Set(["click here", "here", "read more", "learn more", "this", "link", "more"]);
  const genericAnchorPages = ok
    .map((p) => ({
      p,
      count: p.links.filter((l) => l.internal && genericAnchors.has(l.anchor.trim().toLowerCase())).length,
    }))
    .filter((x) => x.count > 0);
  push({
    ruleId: "link-generic-anchors",
    category: "internal-linking",
    title: "Non-descriptive internal anchor text",
    description:
      "Anchors like \"click here\" or \"read more\" tell search engines nothing about the destination. Use descriptive, keyword-relevant anchor text.",
    impact: "low",
    effort: "low",
    risk: "low",
    confidence: 85,
    evidence: `${genericAnchorPages.reduce((s, x) => s + x.count, 0)} generic internal anchors found.`,
    affectedUrls: genericAnchorPages.map((x) => ({ url: norm(x.p.url), note: `${x.count} anchors` })),
    files: [],
    canAutoFix: false,
  });

  // Content analysis (dedup + semantic link opportunities).
  const existingEdges = new Set<string>();
  for (let i = 0; i < graph.paths.length; i++) {
    for (const j of graph.outbound[i]!) {
      existingEdges.add(`${graph.paths[i]} ${graph.paths[j]}`);
    }
  }
  const content = analyzeContent(ok, startUrl, existingEdges);

  push({
    ruleId: "link-missing-internal-opportunities",
    category: "internal-linking",
    title: "Missing internal links between related pages",
    description:
      "RankForge found topically-related pages that don't yet link to each other. Adding contextual internal links spreads link equity and helps users and crawlers discover related content.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 75,
    evidence: `${content.linkSuggestions.length} high-similarity internal-link opportunities (computed from on-site content, no external data).`,
    affectedUrls: content.linkSuggestions.slice(0, 30).map((s) => ({
      url: s.from,
      note: `→ ${s.to} ("${s.anchorHint}", ${Math.round(s.similarity * 100)}% related)`,
    })),
    files: [],
    canAutoFix: false,
  });

  // ══ CONTENT DUPLICATION (indexing) ════════════════════════════════
  push({
    ruleId: "indexing-duplicate-content",
    category: "indexing",
    title: "Near-duplicate page content",
    description:
      "These pages have highly similar body content, which splits ranking signals and can trigger duplicate-content filtering. Differentiate, consolidate, or canonicalize them.",
    impact: "high",
    effort: "high",
    risk: "medium",
    confidence: 80,
    evidence: `${content.duplicateClusters.length} clusters of near-duplicate pages (≥72% shingle overlap).`,
    affectedUrls: content.duplicateClusters.flatMap((c) =>
      c.paths.map((path) => ({ url: path, note: `${Math.round(c.similarity * 100)}% similar cluster` })),
    ),
    files: [],
    canAutoFix: false,
  });

  // ══ PERFORMANCE (lab proxies) ═════════════════════════════════════
  const slowTtfb = ok.filter((p) => p.responseTimeMs > 800);
  push({
    ruleId: "perf-slow-ttfb",
    category: "performance",
    title: "Slow server response (TTFB)",
    description:
      "These pages took over 800ms to start responding. High time-to-first-byte delays every downstream metric. Cache, prerender, or move rendering closer to users.",
    impact: "medium",
    effort: "medium",
    risk: "low",
    confidence: 85,
    evidence: `${slowTtfb.length} pages responded in >800ms (measured during crawl).`,
    affectedUrls: slowTtfb.map((p) => ({ url: norm(p.url), note: `${p.responseTimeMs}ms` })),
    files: [{ path: fileHint(fw, "config"), reason: "Caching / rendering strategy.", confidence: 30 }],
    canAutoFix: false,
  });

  const blockingPages = ok.filter((p) => p.renderBlocking.scripts + p.renderBlocking.stylesheets >= 3);
  push({
    ruleId: "perf-render-blocking",
    category: "performance",
    title: "Render-blocking resources in <head>",
    description:
      "Synchronous scripts and stylesheets in the <head> block the first paint. Defer non-critical scripts and inline or preload critical CSS.",
    impact: "medium",
    effort: "medium",
    risk: "medium",
    confidence: 75,
    evidence: `${blockingPages.length} pages load ≥3 render-blocking resources in <head>.`,
    affectedUrls: blockingPages.map((p) => ({
      url: norm(p.url),
      note: `${p.renderBlocking.scripts} scripts, ${p.renderBlocking.stylesheets} styles`,
    })),
    files: [{ path: fileHint(fw, "layout"), reason: "Head resource loading.", confidence: 35 }],
    canAutoFix: false,
  });

  const heavyPages = ok.filter((p) => p.htmlBytes > 250_000);
  push({
    ruleId: "perf-heavy-html",
    category: "performance",
    title: "Very large HTML documents",
    description:
      "These pages ship over 250KB of HTML. Large documents slow parsing and inflate LCP, especially on mobile. Trim markup, paginate, or stream.",
    impact: "low",
    effort: "medium",
    risk: "low",
    confidence: 80,
    evidence: `${heavyPages.length} pages exceed 250KB of HTML.`,
    affectedUrls: heavyPages.map((p) => ({ url: norm(p.url), note: `${Math.round(p.htmlBytes / 1024)}KB` })),
    files: [],
    canAutoFix: false,
  });

  // Real measured resource issues (only when probing ran).
  if (resources) {
    // Legacy-format images first (JPEG/PNG/JPG that would shrink as WebP/AVIF).
    // Oversized = a genuinely large image; modern formats get a much higher
    // bar (a 300KB hero WebP is fine), and legacy-flagged images are excluded
    // so one big JPEG isn't reported twice.
    const heavyImgs: { url: string; note?: string }[] = [];
    const legacyImgs: { url: string; note?: string }[] = [];
    for (const [url, pr] of resources.images) {
      if (pr.status < 200 || pr.status >= 300 || !pr.bytes) continue;
      const isLegacy = /(jpe?g|png)/.test(pr.contentType);
      const isModern = /(webp|avif)/.test(pr.contentType);
      if (isLegacy && pr.bytes > 100_000) {
        legacyImgs.push({ url, note: `${pr.contentType.split("/").pop()}, ${Math.round(pr.bytes / 1024)}KB` });
        continue; // don't also count as oversized — legacy conversion is the fix
      }
      // Oversized: modern formats tolerated up to 500KB, anything else > 300KB.
      const cap = isModern ? 500_000 : 300_000;
      if (pr.bytes > cap) {
        heavyImgs.push({ url, note: `${Math.round(pr.bytes / 1024)}KB` });
      }
    }
    push({
      ruleId: "perf-oversized-images",
      category: "performance",
      title: "Oversized images",
      description:
        "These images are large enough to be a likely LCP bottleneck. Compress them and serve responsive sizes (srcset).",
      impact: "medium",
      effort: "low",
      risk: "low",
      confidence: 85,
      evidence: `${heavyImgs.length} images are oversized (measured via HTTP).`,
      affectedUrls: heavyImgs.slice(0, 60),
      files: [],
      canAutoFix: false,
    });
    push({
      ruleId: "img-legacy-format",
      category: "images",
      title: "Large images in legacy formats",
      description:
        "These JPEG/PNG images are large enough to benefit from a modern format (WebP/AVIF), which typically cuts weight 30–70% at equal quality.",
      impact: "medium",
      effort: "medium",
      risk: "low",
      confidence: 90,
      evidence: `${legacyImgs.length} large JPEG/PNG images could be WebP/AVIF.`,
      affectedUrls: legacyImgs.slice(0, 60),
      files: [],
      canAutoFix: false,
    });

    // Broken links (measured) — only DEFINITIVE statuses. 404/410/500 are
    // real; 502/503/504 are transient (a momentary blip shouldn't flag a
    // healthy link) and 403/401/429/0 are unverifiable (bot-blocking).
    const brokenExternal: { url: string; note?: string }[] = [];
    const redirectChains: { url: string; note?: string }[] = [];
    for (const [url, pr] of resources.links) {
      if (pr.status === 404 || pr.status === 410 || pr.status === 500) {
        brokenExternal.push({ url, note: `HTTP ${pr.status}` });
      }
      if (pr.redirects >= 2) {
        redirectChains.push({ url, note: `${pr.redirects} hops → ${pr.finalUrl}` });
      }
    }
    push({
      ruleId: "link-broken-external",
      category: "internal-linking",
      title: "Links to broken destinations",
      description:
        "These linked URLs return a definitive error (404/410/5xx, measured). Broken links waste crawl budget and frustrate users. Fix or remove them.",
      impact: "medium",
      effort: "low",
      risk: "low",
      confidence: 95,
      evidence: `${brokenExternal.length} links resolve to a hard error (measured via HTTP).`,
      affectedUrls: brokenExternal.slice(0, 60),
      files: [],
      canAutoFix: false,
    });
    push({
      ruleId: "indexing-redirect-chain",
      category: "indexing",
      title: "Links through redirect chains",
      description:
        "These links pass through 2+ redirects before landing. Redirect chains slow navigation, dilute link equity and waste crawl budget. Link directly to the final URL.",
      impact: "low",
      effort: "low",
      risk: "low",
      confidence: 90,
      evidence: `${redirectChains.length} links go through 2+ redirect hops (measured).`,
      affectedUrls: redirectChains.slice(0, 40),
      files: [],
      canAutoFix: false,
    });

    // Mixed content — ONLY sub-resources (images) count. A navigational
    // <a href="http://…"> is a normal link browsers never block or warn on, so
    // links are intentionally excluded here (they'd be false positives).
    const mixed = new Set<string>();
    for (const [, pr] of resources.images) if (pr.insecure) mixed.add(pr.url);
    push({
      ruleId: "perf-mixed-content",
      category: "performance",
      title: "Insecure (http) resources on a secure page",
      description:
        "HTTPS pages load http:// sub-resources (images). Browsers block or warn on mixed content, breaking the padlock and sometimes the resource. Serve every asset over HTTPS.",
      impact: "high",
      effort: "low",
      risk: "medium",
      confidence: 95,
      evidence: `${mixed.size} http:// sub-resources referenced from https pages (measured).`,
      affectedUrls: [...mixed].slice(0, 40).map((url) => ({ url })),
      files: [],
      canAutoFix: false,
    });
  }

  const noViewport = ok.filter((p) => !p.viewport);
  push({
    ruleId: "perf-viewport-missing",
    category: "performance",
    title: "Missing mobile viewport meta",
    description:
      "Without a viewport meta tag, pages don't adapt to mobile, which Google penalizes under mobile-first indexing. Add a responsive viewport meta.",
    impact: "high",
    effort: "low",
    risk: "low",
    confidence: 100,
    evidence: `${noViewport.length} pages have no viewport meta tag.`,
    affectedUrls: noViewport.map((p) => ({ url: norm(p.url) })),
    files: [{ path: fileHint(fw, "layout"), reason: "Viewport meta belongs in the root layout head.", confidence: 65 }],
    canAutoFix: true,
  });

  // ══ FRAMEWORK-SPECIFIC ════════════════════════════════════════════
  // Sitemap & robots are probed directly (real fetches) by the runner, not
  // inferred from HTML — accurate, deterministic.
  if (siteFiles && !siteFiles.hasSitemap) {
    push({
      ruleId: "framework-sitemap-missing",
      category: "framework",
      title: "No sitemap.xml",
      description:
        "No sitemap.xml was found at the site root. A sitemap helps search engines discover and prioritize your URLs. Generate one for your framework.",
      impact: "medium",
      effort: "low",
      risk: "low",
      confidence: 95,
      evidence: `GET ${new URL("/sitemap.xml", startUrl).toString()} did not return a sitemap.`,
      affectedUrls: [{ url: norm(startUrl) }],
      files: [{ path: fileHint(fw, "sitemap"), reason: "Add a sitemap route/file for this framework.", confidence: 65 }],
      canAutoFix: true,
    });
  }
  if (siteFiles && !siteFiles.hasRobots) {
    push({
      ruleId: "framework-robots-missing",
      category: "framework",
      title: "No robots.txt",
      description:
        "No robots.txt was found at the site root. robots.txt controls crawler access and points to your sitemap. Add one for your framework.",
      impact: "low",
      effort: "low",
      risk: "low",
      confidence: 95,
      evidence: `GET ${new URL("/robots.txt", startUrl).toString()} did not return a robots file.`,
      affectedUrls: [{ url: norm(startUrl) }],
      files: [{ path: fileHint(fw, "robots"), reason: "Add a robots route/file for this framework.", confidence: 65 }],
      canAutoFix: true,
    });
  }
  if (siteFiles && siteFiles.hasSitemap && siteFiles.hasRobots && !siteFiles.robotsDeclaresSitemap) {
    push({
      ruleId: "framework-robots-no-sitemap",
      category: "framework",
      title: "robots.txt doesn't reference the sitemap",
      description:
        "You have a sitemap and a robots.txt, but robots.txt has no Sitemap: directive. Adding it helps crawlers find your sitemap immediately.",
      impact: "low",
      effort: "low",
      risk: "low",
      confidence: 90,
      evidence: "robots.txt is missing a Sitemap: line.",
      affectedUrls: [{ url: norm(startUrl) }],
      files: [{ path: fileHint(fw, "robots"), reason: "Add a Sitemap: line to robots.", confidence: 70 }],
      canAutoFix: true,
    });
  }

  // ── Scoring: per-category health from weighted issue penalties ─────
  const categoryScores = scoreCategories(issues, ok.length);

  // Authority ranking (top pages by internal PageRank).
  const authorityRanking = graph.paths
    .map((path, i) => ({ path, pageRank: Math.round((graph.pageRank[i] ?? 0) * 1000) / 1000 }))
    .sort((a, b) => b.pageRank - a.pageRank);

  return {
    issues,
    categoryScores,
    siteSignals: {
      pagesScanned: pages.length,
      maxDepth: graph.maxDepth,
      orphanPages: graph.orphans,
      brokenInternalLinks: graph.brokenInternal,
      duplicateClusters: content.duplicateClusters,
      linkSuggestions: content.linkSuggestions,
      authorityRanking,
    },
  };
}

// ── helpers ─────────────────────────────────────────────────────────
function groupBy<T>(arr: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of arr) (out[key(x)] ??= []).push(x);
  return out;
}

function dedupeUrls(urls: { url: string; note?: string }[]): { url: string; note?: string }[] {
  const seen = new Set<string>();
  const out: { url: string; note?: string }[] = [];
  for (const u of urls) {
    const k = `${u.url}|${u.note ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

/**
 * Turn detected issues into a 0–100 health score per category. Each affected
 * URL contributes a fraction of the rule's severity penalty (so a rule hitting
 * 1 page hurts less than one hitting 50), capped per rule.
 */
function scoreCategories(issues: EngineIssue[], pageCount: number): Record<SeoCategory, number> {
  const scores = {} as Record<SeoCategory, number>;
  for (const cat of ALL_CATEGORIES) scores[cat] = 100;
  const denom = Math.max(1, pageCount);
  for (const issue of issues) {
    const base = SEVERITY_PENALTY[issue.impact];
    // Fraction of pages affected (broken links etc. clamp at 1 page = small).
    const frac = Math.min(1, issue.affectedUrls.length / denom);
    // A rule can remove at most `base` points; scaled by prevalence (min 25%
    // so even a single-page critical still stings).
    const penalty = base * (0.25 + 0.75 * frac);
    scores[issue.category] = Math.max(0, scores[issue.category] - penalty);
  }
  for (const cat of ALL_CATEGORIES) scores[cat] = Math.round(scores[cat]);
  return scores;
}
