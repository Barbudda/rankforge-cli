/**
 * RankForge domain model.
 * Strict, framework-agnostic types shared across the audit engine,
 * the GitHub service, and the UI. The sample dataset (lib/sample)
 * produces values that satisfy exactly these shapes, so swapping in a
 * real backend later is a pure implementation detail.
 */

// ── Primitives ──────────────────────────────────────────────────

export type Framework =
  | "nextjs"
  | "nuxt"
  | "astro"
  | "sveltekit"
  | "remix"
  | "vite-react"
  | "mdx"
  | "static";

export type Severity = "critical" | "high" | "medium" | "low";
export type Effort = "low" | "medium" | "high";
export type Risk = "low" | "medium" | "high";

export type IssueStatus =
  | "open"
  | "pr_open"
  | "pr_merged"
  | "fixed"
  | "ignored";

export type SeoCategory =
  | "metadata"
  | "indexing"
  | "structure"
  | "images"
  | "schema"
  | "internal-linking"
  | "performance"
  | "framework";

export type PullRequestStatus =
  | "draft"
  | "open"
  | "merged"
  | "closed"
  | "simulated";

export type Plan = "starter" | "growth" | "agency" | "enterprise";

// ── User & workspace ────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  githubLogin: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  repoCount: number;
  seatCount: number;
}

// ── Repository ──────────────────────────────────────────────────

export interface Repository {
  id: string;
  name: string;
  owner: string;
  /** "owner/name" */
  fullName: string;
  framework: Framework;
  defaultBranch: string;
  productionUrl: string;
  /** Pages discovered on the latest crawl. */
  pages: number;
  /** Latest SEO score 0–100. */
  score: number;
  /** Score delta vs the previous audit. */
  scoreDelta: number;
  openIssues: number;
  openPullRequests: number;
  private: boolean;
  lastAuditAt: string | null;
  connectedAt: string;
  /** Soft signal of detection confidence (0–100). */
  detectionConfidence: number;
  /** How much autonomy RankForge has on this repo (overrides workspace default). */
  agentLevel: AgentMode;
}

// ── Audit ───────────────────────────────────────────────────────

export interface CategoryScore {
  category: SeoCategory;
  score: number;
  issues: number;
  /** Weight of this category in the overall score (0–1). */
  weight: number;
}

export interface CrawlSummary {
  pagesScanned: number;
  pagesWithIssues: number;
  /** Average render time in ms (Playwright real-render signal). */
  avgRenderMs: number;
  brokenLinks: number;
  /** Whether the crawl used real rendering or the static fallback. */
  renderMode: "rendered" | "static";
}

export interface FrameworkSignal {
  label: string;
  detail: string;
  ok: boolean;
}

export interface Audit {
  id: string;
  repoId: string;
  score: number;
  previousScore: number | null;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  durationMs: number;
  totalIssues: number;
  categories: CategoryScore[];
  crawl: CrawlSummary;
  frameworkSignals: FrameworkSignal[];
}

// ── SEO issue ───────────────────────────────────────────────────

export interface AffectedUrl {
  url: string;
  /** Optional evidence snippet for this specific URL. */
  note?: string;
}

export interface FileSuggestion {
  path: string;
  reason: string;
  /** Likelihood this is the right file to edit (0–100). */
  confidence: number;
}

export interface FixSuggestion {
  summary: string;
  filesChanged: string[];
  /** Unified diff preview (string with +/- lines). */
  diff: string;
  branchName: string;
  prTitle: string;
  prDescription: string;
  validationSteps: string[];
  rollbackNotes: string;
  confidence: number;
}

export interface SeoIssue {
  id: string;
  repoId: string;
  auditId: string;
  title: string;
  description: string;
  category: SeoCategory;
  impact: Severity;
  effort: Effort;
  risk: Risk;
  /** 0–100 confidence that this is a real, actionable issue. */
  confidence: number;
  status: IssueStatus;
  affectedUrls: AffectedUrl[];
  /** Raw evidence pulled from the rendered HTML. */
  evidence: string;
  suggestedFix: FixSuggestion;
  files: FileSuggestion[];
  canAutoFix: boolean;
  createdAt: string;
}

// ── Pull request ────────────────────────────────────────────────

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  /** Unified diff for this file. */
  diff: string;
}

export interface PullRequest {
  id: string;
  repoId: string;
  issueIds: string[];
  number: number;
  title: string;
  description: string;
  branchName: string;
  baseBranch: string;
  status: PullRequestStatus;
  files: PullRequestFile[];
  additions: number;
  deletions: number;
  checklist: { label: string; done: boolean }[];
  expectedImpact: string;
  risk: Risk;
  url: string | null;
  createdAt: string;
}

// ── Agent settings ──────────────────────────────────────────────

/**
 * The autonomy spectrum: how far RankForge is allowed to go on a repo,
 * from plain advice up to full root-level autonomy. Ordered low → high.
 */
export type AgentMode =
  | "advisor" // advice only — no code, no diffs
  | "suggest" // generates diffs to copy, no GitHub writes
  | "draft_pr" // opens draft PRs on a branch
  | "auto_low_risk" // auto-opens ready PRs for low-risk fixes
  | "autopilot"; // full autonomy across categories/paths (root level)

export interface AgentSettings {
  mode: AgentMode;
  weeklyAudit: boolean;
  maxPrsPerWeek: number;
  allowedCategories: SeoCategory[];
  excludedPaths: string[];
}

// ── Helper view-model types ─────────────────────────────────────

export interface DashboardStats {
  globalScore: number;
  scoreDelta: number;
  repositories: number;
  openIssues: number;
  prsCreated: number;
  /** Sum of impact "points" resolved by merged PRs. */
  impactFixed: number;
}

export interface ScoreTrendPoint {
  label: string;
  score: number;
}
