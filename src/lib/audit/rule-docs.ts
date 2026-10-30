import type { FixSuggestion, Framework, Repository, SeoIssue } from "@/types";
import { RULE_CATALOG, type CatalogRule } from "./catalog";
import { FIXABLE_RULE_IDS, generateDeterministicFix } from "./deterministic-fix";
import { RULE_DOC_DATA } from "./rule-docs.data";

/**
 * The public page of every rule (/docs/issues/<rule id>), derived from the
 * catalog so a rule can't ship without its page. The text comes from the
 * engine's own behaviour: what fails, what is measured, the fix, the check.
 */

export type DocFramework = "nextjs" | "nuxt" | "astro" | "sveltekit";

export interface RuleDoc {
  summary: string;
  failing: { label: string; lang: "html" | "http" | "text" | "xml"; code: string };
  measured: string;
  consequence: string;
  fix: string;
  frameworks?: Partial<Record<DocFramework, string>>;
  verify: string;
  related: string[];
}

export interface RulePage extends CatalogRule, RuleDoc {
  /** First published at this URL (YYYY-MM-DD). */
  published: string;
  /** Last content change (YYYY-MM-DD). */
  updated: string;
}

// Pages that already existed at the same URL before the rewrite of 2026-10-30
// (first published with the docs on 2026-07-06). Every other rule page is new.
const PUBLISHED_BEFORE = new Set([
  "meta-title-missing",
  "meta-description-missing",
  "meta-og-image-missing",
  "indexing-canonical-missing",
  "structure-h1-multiple",
]);
const FIRST_DOCS = "2026-07-06";
const REWRITE = "2026-10-30";

const DATA = RULE_DOC_DATA as Record<string, RuleDoc>;

export const RULE_PAGES: RulePage[] = RULE_CATALOG.map((rule) => ({
  ...rule,
  ...DATA[rule.id]!,
  published: PUBLISHED_BEFORE.has(rule.id) ? FIRST_DOCS : REWRITE,
  updated: REWRITE,
}));

export function getRulePage(id: string): RulePage | undefined {
  return RULE_PAGES.find((r) => r.id === id);
}

// The engine reports titles over 65 characters (meta-title-length); the root
// layout appends " · Septune" (10 characters) to every page title.
const TITLE_MAX = 65 - " · Septune".length;
const SHORT_TITLES: Record<string, string> = {
  "indexing-noindex-utility": "Utility pages kept out of search with noindex",
  "indexing-robots-unavailable": "robots.txt answers with a server error",
};

/** The <title> of a rule page, short enough to pass Septune's own check. */
export function pageTitle(rule: RulePage): string {
  const base = SHORT_TITLES[rule.id] ?? rule.title;
  const howTo = `${base}: how to fix it`;
  return howTo.length <= TITLE_MAX ? howTo : base;
}

/**
 * The body of a patch for a reader: the diff headers repeat the file name the
 * page already shows next to it.
 */
export function patchBody(diff: string): string {
  return diff
    .split("\n")
    .filter((line) => !/^(diff --git |new file mode |--- |\+\+\+ |@@ )/.test(line))
    .join("\n");
}

/** First sentence of a summary, for lists and link descriptions. */
export function firstSentence(text: string): string {
  const end = text.search(/\.\s/);
  return end === -1 ? text : text.slice(0, end + 1);
}

/**
 * Old doc URLs, from before the pages followed the catalog ids, and the rule
 * page that replaces each one (served as permanent redirects).
 */
export const LEGACY_DOC_SLUGS: Record<string, string> = {
  "indexing-sitemap-incomplete": "indexing-sitemap-gaps",
  "indexing-robots-stale": "framework-robots-no-sitemap",
  "structure-headings-skipped": "structure-heading-skip",
  "images-alt-missing": "img-alt-missing",
  "schema-article-missing": "schema-missing",
  "schema-product-missing": "schema-invalid",
  "linking-orphans": "link-orphan-pages",
  "linking-weak-anchors": "link-generic-anchors",
  "performance-render-blocking": "perf-render-blocking",
};

export const DOC_FRAMEWORKS: { id: DocFramework; name: string }[] = [
  { id: "nextjs", name: "Next.js" },
  { id: "nuxt", name: "Nuxt" },
  { id: "astro", name: "Astro" },
  { id: "sveltekit", name: "SvelteKit" },
];

/** The patch the engine generates for this rule and framework, when it has one. */
export function fixTemplateFor(ruleId: string, framework: Framework): FixSuggestion | null {
  if (!FIXABLE_RULE_IDS.includes(ruleId)) return null;
  const repo = {
    id: "docs",
    framework,
    productionUrl: "https://example.com/",
    fullName: "example/example",
    defaultBranch: "main",
  } as unknown as Repository;
  const issue = {
    id: `iss_docs:${ruleId}`,
    repoId: "docs",
    title: RULE_CATALOG.find((r) => r.id === ruleId)?.title ?? ruleId,
    description: "",
    category: "framework",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 90,
    status: "open",
    affectedUrls: [{ url: "https://example.com/" }],
    evidence: "",
    canAutoFix: true,
    files: [],
  } as unknown as SeoIssue;
  return generateDeterministicFix(issue, repo);
}
