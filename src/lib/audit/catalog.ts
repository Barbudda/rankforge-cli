import type { SeoCategory, Severity } from "@/types";

/**
 * Every issue the engine can report, under the ruleId audits return it with.
 * `rankforge rules` and the MCP list_rules tool read this list, and a test
 * checks that every ruleId in engine.ts and indexing-checks.ts appears here,
 * so the catalog can't drift from what audits actually report.
 *
 * `impact` is the default: two rules raise it with the evidence (an expired
 * or untrusted certificate is critical, poor Core Web Vitals are high).
 * `doc` is the slug of the rule's page under /docs/issues, when one exists.
 */
export interface CatalogRule {
  id: string;
  category: SeoCategory;
  impact: Severity;
  title: string;
  doc?: string;
}

export const RULE_CATALOG: CatalogRule[] = [
  // metadata
  { id: "meta-title-missing", category: "metadata", impact: "high", title: "Pages missing a <title>", doc: "meta-title-missing" },
  { id: "meta-title-duplicate", category: "metadata", impact: "medium", title: "Duplicate titles across pages", doc: "meta-title-missing" },
  { id: "meta-title-length", category: "metadata", impact: "low", title: "Titles outside the ideal length" },
  { id: "meta-description-missing", category: "metadata", impact: "medium", title: "Pages missing a meta description", doc: "meta-description-missing" },
  { id: "meta-description-duplicate", category: "metadata", impact: "low", title: "Duplicate meta descriptions" },
  { id: "meta-og-image-missing", category: "metadata", impact: "low", title: "Pages without an OpenGraph image", doc: "meta-og-image-missing" },
  { id: "content-keyword-alignment", category: "metadata", impact: "low", title: "Title and H1 don't reflect the page's content" },

  // indexing
  { id: "indexing-noindex", category: "indexing", impact: "critical", title: "Pages set to noindex (meta tag or X-Robots-Tag header)" },
  { id: "indexing-noindex-utility", category: "indexing", impact: "low", title: "Utility pages (sign-in, account, cart) kept out of search with noindex" },
  { id: "indexing-robots-unavailable", category: "indexing", impact: "critical", title: "robots.txt is failing (server error), so Google pauses crawling" },
  { id: "indexing-robots-blocks-google", category: "indexing", impact: "critical", title: "robots.txt blocks Googlebot from the whole site" },
  { id: "indexing-robots-blocks-pages", category: "indexing", impact: "high", title: "Pages Googlebot isn't allowed to crawl" },
  { id: "indexing-robots-html", category: "indexing", impact: "medium", title: "robots.txt is an HTML page" },
  { id: "indexing-broken-page", category: "indexing", impact: "high", title: "Pages returning an error status" },
  { id: "indexing-soft-404-site", category: "indexing", impact: "high", title: "Missing pages return 200 instead of 404" },
  { id: "indexing-soft-404", category: "indexing", impact: "medium", title: "Error pages served with HTTP 200 (soft 404)" },
  { id: "indexing-canonical-missing", category: "indexing", impact: "medium", title: "Pages missing a canonical URL", doc: "indexing-canonical-missing" },
  { id: "indexing-canonical-mismatch", category: "indexing", impact: "high", title: "Canonical points to a different page", doc: "indexing-canonical-missing" },
  { id: "indexing-canonical-target-invalid", category: "indexing", impact: "high", title: "Canonical points to a page that can't be indexed" },
  { id: "indexing-hreflang-invalid", category: "indexing", impact: "high", title: "hreflang annotations Google will ignore" },
  { id: "indexing-duplicate-content", category: "indexing", impact: "high", title: "Near-duplicate page content" },
  { id: "indexing-redirect-chain", category: "indexing", impact: "low", title: "Links through redirect chains" },
  { id: "indexing-html-lang-missing", category: "indexing", impact: "low", title: "Missing <html lang> attribute" },
  { id: "indexing-sitemap-hygiene", category: "indexing", impact: "medium", title: "Sitemap lists URLs that shouldn't be indexed" },
  { id: "indexing-sitemap-gaps", category: "indexing", impact: "low", title: "Indexable pages missing from the sitemap", doc: "indexing-sitemap-incomplete" },
  { id: "indexing-https-certificate", category: "indexing", impact: "high", title: "HTTPS certificate expired, untrusted or expiring soon" },

  // structure
  { id: "structure-h1-missing", category: "structure", impact: "medium", title: "Pages with no <h1>", doc: "structure-h1-multiple" },
  { id: "structure-h1-multiple", category: "structure", impact: "low", title: "Pages with multiple <h1> elements", doc: "structure-h1-multiple" },
  { id: "structure-heading-skip", category: "structure", impact: "low", title: "Heading levels skip a rank", doc: "structure-headings-skipped" },
  { id: "structure-thin-content", category: "structure", impact: "medium", title: "Thin-content pages" },
  { id: "content-readability", category: "structure", impact: "low", title: "Hard-to-read content" },
  { id: "content-keyword-stuffing", category: "structure", impact: "medium", title: "Possible keyword stuffing" },

  // images
  { id: "img-alt-missing", category: "images", impact: "medium", title: "Images missing alt text", doc: "images-alt-missing" },
  { id: "img-dimensions-missing", category: "images", impact: "medium", title: "Images without width/height (layout shift)" },
  { id: "img-lazy-missing", category: "images", impact: "low", title: "Image-heavy pages without lazy loading" },
  { id: "img-legacy-format", category: "images", impact: "medium", title: "Large images in legacy formats" },

  // structured data
  { id: "schema-missing", category: "schema", impact: "medium", title: "Pages without structured data" },
  { id: "schema-invalid", category: "schema", impact: "medium", title: "Structured data missing properties Google requires" },
  { id: "schema-website-missing", category: "schema", impact: "low", title: "Homepage lacks Organization/WebSite schema" },

  // internal linking
  { id: "link-orphan-pages", category: "internal-linking", impact: "high", title: "Orphan pages (no internal links in)", doc: "linking-orphans" },
  { id: "link-deep-pages", category: "internal-linking", impact: "medium", title: "Pages buried deep in the click path" },
  { id: "link-broken-internal", category: "internal-linking", impact: "medium", title: "Internal links to broken pages" },
  { id: "link-broken-external", category: "internal-linking", impact: "medium", title: "Links to broken destinations" },
  { id: "link-generic-anchors", category: "internal-linking", impact: "low", title: "Non-descriptive internal anchor text", doc: "linking-weak-anchors" },
  { id: "link-missing-internal-opportunities", category: "internal-linking", impact: "medium", title: "Missing internal links between related pages" },

  // performance
  { id: "perf-core-web-vitals", category: "performance", impact: "medium", title: "Core Web Vitals need improvement for real users (CrUX)" },
  { id: "perf-slow-ttfb", category: "performance", impact: "medium", title: "Slow server response (TTFB)" },
  { id: "perf-render-blocking", category: "performance", impact: "medium", title: "Render-blocking resources in <head>", doc: "performance-render-blocking" },
  { id: "perf-oversized-images", category: "performance", impact: "medium", title: "Oversized images" },
  { id: "perf-heavy-html", category: "performance", impact: "low", title: "Very large HTML documents" },
  { id: "perf-mixed-content", category: "performance", impact: "high", title: "Insecure (http) resources on a secure page" },
  { id: "perf-viewport-missing", category: "performance", impact: "high", title: "Missing mobile viewport meta" },

  // framework
  { id: "framework-sitemap-missing", category: "framework", impact: "medium", title: "No sitemap.xml" },
  { id: "framework-robots-missing", category: "framework", impact: "low", title: "No robots.txt" },
  { id: "framework-robots-no-sitemap", category: "framework", impact: "low", title: "robots.txt doesn't reference the sitemap", doc: "indexing-robots-stale" },
];
