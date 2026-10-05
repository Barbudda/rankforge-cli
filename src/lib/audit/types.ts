import type {
  Audit,
  Effort,
  Framework,
  Repository,
  Risk,
  SeoCategory,
  SeoIssue,
  Severity,
} from "@/types";

/**
 * Audit engine contracts. The MVP ships a MockAuditRunner that returns
 * fixtures, but the interfaces are shaped for the real pipeline:
 *   Crawler → FrameworkDetector → SeoRule[] → scoring → FixGenerator →
 *   PullRequestGenerator.
 */

export interface CrawledPage {
  url: string;
  statusCode: number;
  /** Rendered HTML after JS execution (Playwright) or static fetch. */
  html: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  h1s: string[];
  headings: { level: number; text: string }[];
  images: {
    src: string;
    alt: string | null;
    width?: number;
    height?: number;
    /** loading attribute ("lazy" | "eager" | null). */
    loading?: string | null;
  }[];
  links: { href: string; internal: boolean; anchor: string; nofollow?: boolean }[];
  jsonLd: unknown[];
  renderMs: number;

  // ── Deterministic signals (populated by the crawler, no LLM needed) ──
  /** `lang` attribute on <html>. */
  lang: string | null;
  /** Content of <meta name="robots">, lowercased. */
  metaRobots: string | null;
  /** Content of <meta name="viewport"> (mobile-friendly signal). */
  viewport: string | null;
  /** hreflang alternates declared in <head>. */
  hreflang: { lang: string; href: string }[];
  /** OpenGraph properties present (og:title, og:image, …). */
  og: Record<string, string>;
  /** twitter:card value, if any. */
  twitterCard: string | null;
  /** Visible text content (tags stripped), capped for analysis. */
  textContent: string;
  /** Approximate visible word count (thin-content signal). */
  wordCount: number;
  /** Raw HTML byte size (page-weight signal). */
  htmlBytes: number;
  /** Time to first byte in ms (server-response performance proxy). */
  responseTimeMs: number;
  /** Render-blocking resources counted in <head>. */
  renderBlocking: { scripts: number; stylesheets: number };
  /** Count of <img> without explicit width/height (CLS proxy). */
  imagesMissingDims: number;
  /** Click depth from the crawl start page (BFS); set by the crawler. */
  depth?: number;
}

export interface Crawler {
  crawl(
    startUrl: string,
    opts?: { maxPages?: number; render?: boolean },
  ): Promise<CrawledPage[]>;
}

export interface FrameworkDetectionResult {
  framework: Framework;
  confidence: number;
  signals: { label: string; detail: string; ok: boolean }[];
}

export interface FrameworkDetector {
  /** Detect from repo files (package.json, *.config.*) and/or rendered HTML. */
  detect(input: {
    files?: Record<string, string>;
    pages?: CrawledPage[];
  }): Promise<FrameworkDetectionResult>;
}

export interface RuleContext {
  repo: Repository;
  pages: CrawledPage[];
  framework: Framework;
}

/** A single technical-SEO check. Pure where possible. */
export interface SeoRule {
  id: string;
  category: SeoCategory;
  title: string;
  description: string;
  defaultImpact: Severity;
  defaultEffort: Effort;
  defaultRisk: Risk;
  canAutoFix: boolean;
  /** Frameworks this rule has tailored fixes for. */
  frameworks?: Framework[];
  /** Evaluate the rendered site and emit issues (without fix codegen). */
  evaluate?(ctx: RuleContext): Omit<SeoIssue, "suggestedFix" | "auditId">[];
}

export interface FixGenerator {
  /** Turn an issue into a concrete patch for the repo + framework. */
  generateFix(
    issue: SeoIssue,
    repoContext: { repo: Repository; files?: Record<string, string> },
  ): Promise<SeoIssue["suggestedFix"]>;
}

export interface AuditResult {
  audit: Audit;
  issues: SeoIssue[];
}

export interface AuditRunner {
  run(repo: Repository): Promise<AuditResult>;
}
