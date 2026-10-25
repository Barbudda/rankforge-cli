import type { Severity } from "@/types";
import type { CrawledPage } from "./types";
import type { EngineResult, SiteFilesInput } from "./engine";
import type { GeoReport } from "./geo";
import { AI_BOTS, botAllowed } from "./geo";
import { headerDirectives } from "./robots-directives";
import { normalizePath } from "./link-graph";
import type { VitalsRating, VitalsReport } from "./vitals";

/**
 * Snapshots and diffs: what makes Septune a monitor instead of a one-off
 * audit. A snapshot is the compact state of a site at one moment (scores,
 * issues, and the indexing-critical fields of every crawled page); a diff
 * says what changed between two of them, and how bad it is.
 *
 * Pages are keyed by path, so two snapshots of different hosts compare too:
 * that is how a CI job diffs a preview deployment against production.
 */

export const SNAPSHOT_VERSION = 1;

export interface PageState {
  status: number;
  title: string | null;
  description: string | null;
  /** Absolute canonical URL, null when absent. */
  canonical: string | null;
  /** noindex from the robots meta tag (a code decision). */
  noindexMeta: boolean;
  /** noindex from the X-Robots-Tag header (often an environment setting). */
  noindexHeader: boolean;
  h1: string | null;
  /** Path the request landed on when it redirected. */
  redirectedTo?: string;
}

export interface SnapshotIssue {
  ruleId: string;
  impact: Severity;
  category: string;
  title: string;
  /** Affected paths/URLs as the engine reports them. */
  paths: string[];
}

export interface SiteSnapshot {
  v: number;
  url: string;
  origin: string;
  takenAt: string;
  pagesCrawled: number;
  overall: number;
  categoryScores: Record<string, number>;
  geoScore: number | null;
  issues: SnapshotIssue[];
  pages: Record<string, PageState>;
  robots: { status: number | null; hash: string | null; googlebotAllowed: boolean; aiSearchBlocked: string[] };
  sitemap: { present: boolean; urls: number };
  tls: { validTo: string; daysLeft: number; trusted: boolean } | null;
  /** Core Web Vitals p75 (CrUX), when fetched. */
  vitals?: { scope: "url" | "origin"; lcp?: VitalState; inp?: VitalState; cls?: VitalState } | null;
}

export interface VitalState {
  p75: number;
  rating: VitalsRating;
}

/** FNV-1a, enough to notice that a file changed (not a security hash). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function pathKey(u: string, base: string): string {
  return normalizePath(u, base) ?? u;
}

export function buildSnapshot(input: {
  url: string;
  pages: CrawledPage[];
  engine: EngineResult;
  overall: number;
  geo?: GeoReport | null;
  siteFiles?: SiteFilesInput & { sitemapUrls?: string[] };
  vitals?: VitalsReport | null;
  takenAt?: string;
}): SiteSnapshot {
  const { url, pages, engine, overall, geo, siteFiles } = input;
  const origin = (() => {
    try {
      return new URL(pages[0]?.url ?? url).origin;
    } catch {
      return url;
    }
  })();

  const pageStates: Record<string, PageState> = {};
  for (const p of pages) {
    const key = pathKey(p.requestedUrl ?? p.url, url);
    let canonical: string | null = null;
    if (p.canonical) {
      try {
        canonical = new URL(p.canonical, p.url).toString();
      } catch {
        canonical = p.canonical;
      }
    }
    const state: PageState = {
      status: p.statusCode,
      title: p.title?.slice(0, 200) ?? null,
      description: p.metaDescription?.slice(0, 300) ?? null,
      canonical,
      noindexMeta: /\b(noindex|none)\b/.test((p.metaRobots ?? "").toLowerCase()),
      noindexHeader: headerDirectives(p.xRobotsTag).some((d) => d === "noindex" || d === "none"),
      h1: p.h1s[0]?.slice(0, 200) ?? null,
    };
    if (p.requestedUrl) state.redirectedTo = pathKey(p.url, url);
    pageStates[key] = state;
  }

  const robotsTxt = siteFiles?.robotsTxt ?? "";
  return {
    v: SNAPSHOT_VERSION,
    url,
    origin,
    takenAt: input.takenAt ?? new Date().toISOString(),
    pagesCrawled: pages.length,
    overall,
    categoryScores: { ...(engine.categoryScores as Record<string, number>) },
    geoScore: geo ? geo.score : null,
    issues: engine.issues.map((i) => ({
      ruleId: i.ruleId,
      impact: i.impact,
      category: i.category,
      title: i.title,
      paths: i.affectedUrls.map((a) => a.url),
    })),
    pages: pageStates,
    robots: {
      status: siteFiles?.robotsStatus ?? null,
      hash: robotsTxt ? fnv1a(robotsTxt) : null,
      googlebotAllowed: botAllowed(robotsTxt, "Googlebot", "/"),
      aiSearchBlocked: AI_BOTS.filter((b) => b.purpose !== "training" && b.bot !== "Googlebot" && !botAllowed(robotsTxt, b.bot, "/")).map((b) => b.bot),
    },
    sitemap: { present: Boolean(siteFiles?.hasSitemap), urls: siteFiles?.sitemapUrls?.length ?? 0 },
    tls: siteFiles?.tls
      ? { validTo: siteFiles.tls.validTo, daysLeft: siteFiles.tls.daysLeft, trusted: siteFiles.tls.trusted }
      : null,
    vitals: (() => {
      const v = input.vitals ?? siteFiles?.vitals;
      if (!v) return null;
      const pick = (m?: { p75: number; rating: VitalsRating }) => (m ? { p75: m.p75, rating: m.rating } : undefined);
      return { scope: v.scope, lcp: pick(v.lcp), inp: pick(v.inp), cls: pick(v.cls) };
    })(),
  };
}

const RATING_RANK: Record<VitalsRating, number> = { good: 0, "needs-improvement": 1, poor: 2 };

// ── diff ────────────────────────────────────────────────────────────

export type ChangeLevel = "critical" | "warning" | "info";

export interface SiteChange {
  kind: string;
  level: ChangeLevel;
  /** One plain-English sentence. */
  title: string;
  path?: string;
  before?: string;
  after?: string;
}

export interface IssueDelta {
  ruleId: string;
  impact: Severity;
  title: string;
  /** Paths newly affected (all of them for a new issue). */
  paths: string[];
}

export interface SnapshotDiff {
  from: { url: string; takenAt: string; overall: number };
  to: { url: string; takenAt: string; overall: number };
  /** The two snapshots are of different hosts (e.g. preview vs production). */
  crossOrigin: boolean;
  overallDelta: number;
  geoDelta: number | null;
  categoryDeltas: Record<string, number>;
  newIssues: IssueDelta[];
  worsenedIssues: IssueDelta[];
  resolvedIssues: IssueDelta[];
  changes: SiteChange[];
  /** Differences that only come from the environment (cross-origin diffs). */
  environment: string[];
  level: "none" | ChangeLevel;
  summary: string;
}

/**
 * Rules whose result depends on the host rather than the code: a preview
 * deployment sends `X-Robots-Tag: noindex`, has its own robots.txt and
 * certificate, and its canonicals and sitemap point at production. On a
 * cross-origin diff these are reported as environment differences, never as
 * regressions.
 */
const ENV_SENSITIVE_RULES = new Set([
  "indexing-noindex",
  "indexing-noindex-utility",
  "indexing-canonical-mismatch",
  "indexing-canonical-target-invalid",
  // Previews usually emit production URLs in their alternates.
  "indexing-hreflang-invalid",
  "indexing-sitemap-hygiene",
  "indexing-sitemap-gaps",
  "indexing-robots-unavailable",
  "indexing-robots-html",
  "indexing-robots-blocks-google",
  "indexing-robots-blocks-pages",
  "indexing-https-certificate",
  "indexing-soft-404-site",
  "framework-sitemap-missing",
  "framework-robots-missing",
  "framework-robots-no-sitemap",
  "perf-slow-ttfb",
]);

const IMPACT_LEVEL: Record<Severity, ChangeLevel> = {
  critical: "critical",
  high: "warning",
  medium: "info",
  low: "info",
};

const LEVEL_RANK: Record<"none" | ChangeLevel, number> = { none: 0, info: 1, warning: 2, critical: 3 };

function canonicalPath(c: string | null): string | null {
  if (!c) return null;
  try {
    return new URL(c).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return c;
  }
}

export function diffSnapshots(prev: SiteSnapshot, next: SiteSnapshot): SnapshotDiff {
  const crossOrigin = prev.origin !== next.origin;
  const changes: SiteChange[] = [];
  const environment: string[] = [];
  const add = (c: SiteChange) => changes.push(c);

  // ── pages present in both crawls ──
  const added: string[] = [];
  const titleChanges: string[] = [];
  for (const [path, b] of Object.entries(next.pages)) {
    const a = prev.pages[path];
    if (!a) {
      if (b.status >= 200 && b.status < 300) added.push(path);
      continue;
    }
    const wasOk = a.status >= 200 && a.status < 300 && !a.redirectedTo;
    const isOk = b.status >= 200 && b.status < 300 && !b.redirectedTo;
    if (wasOk && b.status >= 400) {
      add({ kind: "page-error", level: "critical", path, title: `${path} now returns HTTP ${b.status}`, before: String(a.status), after: String(b.status) });
      continue;
    }
    if (wasOk && b.redirectedTo && !a.redirectedTo) {
      add({ kind: "redirect-added", level: "warning", path, title: `${path} now redirects to ${b.redirectedTo}`, after: b.redirectedTo });
      continue;
    }
    if (!wasOk || !isOk) continue;
    const aNo = a.noindexMeta || (!crossOrigin && a.noindexHeader);
    const bNo = b.noindexMeta || (!crossOrigin && b.noindexHeader);
    if (!aNo && bNo) {
      add({ kind: "noindex-added", level: "critical", path, title: `${path} became noindex${b.noindexMeta ? " (robots meta tag)" : " (X-Robots-Tag header)"}` });
    } else if (aNo && !bNo) {
      add({ kind: "noindex-removed", level: "info", path, title: `${path} is indexable again` });
    }
    if (crossOrigin && !a.noindexHeader && b.noindexHeader) {
      environment.push(`${path} sends an X-Robots-Tag noindex header (normal on preview deployments)`);
    }
    const ca = crossOrigin ? canonicalPath(a.canonical) : a.canonical;
    const cb = crossOrigin ? canonicalPath(b.canonical) : b.canonical;
    if (ca !== cb) {
      const pointsElsewhere = cb !== null && canonicalPath(cb) !== path;
      add({
        kind: "canonical-changed",
        level: pointsElsewhere ? "warning" : "info",
        path,
        title: cb === null ? `${path} lost its canonical tag` : `${path} canonical changed to ${cb}`,
        before: ca ?? "none",
        after: cb ?? "none",
      });
    }
    if ((a.title ?? "") !== (b.title ?? "")) titleChanges.push(path);
    if ((a.h1 ?? "") && !(b.h1 ?? "")) add({ kind: "h1-removed", level: "warning", path, title: `${path} lost its H1 heading`, before: a.h1 ?? "" });
    if ((a.description ?? "") && !(b.description ?? "")) {
      add({ kind: "description-removed", level: "warning", path, title: `${path} lost its meta description` });
    }
  }
  if (titleChanges.length) {
    add({
      kind: "titles-changed",
      level: "info",
      title: `${titleChanges.length} page title${titleChanges.length > 1 ? "s" : ""} changed (${titleChanges.slice(0, 3).join(", ")}${titleChanges.length > 3 ? "…" : ""})`,
    });
  }
  if (added.length) {
    add({ kind: "pages-added", level: "info", title: `${added.length} new page${added.length > 1 ? "s" : ""} found (${added.slice(0, 3).join(", ")}${added.length > 3 ? "…" : ""})` });
  }

  // ── site-level (same host only: a preview has its own robots/TLS) ──
  if (!crossOrigin) {
    const ra = prev.robots;
    const rb = next.robots;
    if (ra.googlebotAllowed && !rb.googlebotAllowed) {
      add({ kind: "googlebot-blocked", level: "critical", path: "/robots.txt", title: "robots.txt now blocks Googlebot from the whole site" });
    } else if (!ra.googlebotAllowed && rb.googlebotAllowed) {
      add({ kind: "googlebot-unblocked", level: "info", path: "/robots.txt", title: "robots.txt lets Googlebot in again" });
    }
    const newlyBlocked = rb.aiSearchBlocked.filter((b) => !ra.aiSearchBlocked.includes(b));
    if (newlyBlocked.length) {
      add({ kind: "ai-search-blocked", level: "warning", path: "/robots.txt", title: `robots.txt now blocks ${newlyBlocked.join(", ")} (AI search)` });
    }
    const failing = (s: number | null) => s !== null && (s >= 500 || s === 429);
    if (!failing(ra.status) && failing(rb.status)) {
      add({ kind: "robots-unavailable", level: "critical", path: "/robots.txt", title: `robots.txt now fails with HTTP ${rb.status}: Google pauses crawling` });
    } else if (ra.hash !== rb.hash && rb.googlebotAllowed === ra.googlebotAllowed && !newlyBlocked.length) {
      add({ kind: "robots-changed", level: "info", path: "/robots.txt", title: "robots.txt changed" });
    }

    if (prev.sitemap.present && !next.sitemap.present) {
      add({ kind: "sitemap-gone", level: "warning", path: "/sitemap.xml", title: "The sitemap can no longer be read" });
    } else if (prev.sitemap.urls >= 10 && next.sitemap.urls < prev.sitemap.urls * 0.8) {
      add({
        kind: "sitemap-shrunk",
        level: "warning",
        path: "/sitemap.xml",
        title: `The sitemap shrank from ${prev.sitemap.urls} to ${next.sitemap.urls} URLs`,
        before: String(prev.sitemap.urls),
        after: String(next.sitemap.urls),
      });
    }

    if (next.tls) {
      if (prev.tls?.trusted !== false && !next.tls.trusted) {
        add({ kind: "tls-invalid", level: "critical", title: "The HTTPS certificate is no longer trusted" });
      } else if (next.tls.daysLeft <= 14) {
        add({
          kind: "tls-expiring",
          level: next.tls.daysLeft <= 3 ? "critical" : "warning",
          title: `The HTTPS certificate expires in ${next.tls.daysLeft} day${next.tls.daysLeft === 1 ? "" : "s"}`,
        });
      }
    }
  }

  // ── Core Web Vitals (same host only: a preview has no CrUX data) ──
  if (!crossOrigin && prev.vitals && next.vitals) {
    for (const k of ["lcp", "inp", "cls"] as const) {
      const a = prev.vitals[k];
      const b = next.vitals[k];
      if (!a || !b || RATING_RANK[b.rating] <= RATING_RANK[a.rating]) continue;
      const fmt = (v: VitalState) => (k === "cls" ? v.p75.toFixed(2) : `${Math.round(v.p75)} ms`);
      add({
        kind: "vitals-regressed",
        level: b.rating === "poor" ? "warning" : "info",
        title: `${k.toUpperCase()} got worse for real users: ${fmt(a)} → ${fmt(b)} (${b.rating.replace("-", " ")})`,
        before: fmt(a),
        after: fmt(b),
      });
    }
  }

  // ── issues ──
  const prevIssues = new Map(prev.issues.map((i) => [i.ruleId, i]));
  const nextIssues = new Map(next.issues.map((i) => [i.ruleId, i]));
  const newIssues: IssueDelta[] = [];
  const worsenedIssues: IssueDelta[] = [];
  const resolvedIssues: IssueDelta[] = [];
  for (const [ruleId, i] of nextIssues) {
    const before = prevIssues.get(ruleId);
    if (crossOrigin && ENV_SENSITIVE_RULES.has(ruleId)) {
      if (!before) environment.push(`${i.title} (only on ${next.origin})`);
      continue;
    }
    if (!before) {
      newIssues.push({ ruleId, impact: i.impact, title: i.title, paths: i.paths });
      continue;
    }
    const was = new Set(before.paths);
    const fresh = i.paths.filter((p) => !was.has(p));
    if (fresh.length) worsenedIssues.push({ ruleId, impact: i.impact, title: i.title, paths: fresh });
  }
  for (const [ruleId, i] of prevIssues) {
    if (!nextIssues.has(ruleId) && !(crossOrigin && ENV_SENSITIVE_RULES.has(ruleId))) {
      resolvedIssues.push({ ruleId, impact: i.impact, title: i.title, paths: i.paths });
    }
  }
  for (const i of newIssues) {
    add({ kind: "new-issue", level: IMPACT_LEVEL[i.impact], title: `New issue: ${i.title} (${i.paths.length})`, path: i.paths[0] });
  }
  for (const i of worsenedIssues) {
    add({
      kind: "worsened-issue",
      level: i.impact === "critical" || i.impact === "high" ? "warning" : "info",
      title: `${i.title}: ${i.paths.length} more page${i.paths.length > 1 ? "s" : ""}`,
      path: i.paths[0],
    });
  }

  const overallDelta = next.overall - prev.overall;
  if (overallDelta <= -5) add({ kind: "score-drop", level: "warning", title: `Score dropped ${-overallDelta} points (${prev.overall} → ${next.overall})` });

  const categoryDeltas: Record<string, number> = {};
  for (const [cat, score] of Object.entries(next.categoryScores)) {
    categoryDeltas[cat] = score - (prev.categoryScores[cat] ?? score);
  }

  changes.sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level]);
  const level = changes.reduce<"none" | ChangeLevel>((m, c) => (LEVEL_RANK[c.level] > LEVEL_RANK[m] ? c.level : m), "none");
  const critical = changes.filter((c) => c.level === "critical");
  const warnings = changes.filter((c) => c.level === "warning");
  const scoreText = `score ${next.overall} (${overallDelta >= 0 ? "+" : ""}${overallDelta})`;
  const summary = critical.length
    ? `${critical.length} critical change${critical.length > 1 ? "s" : ""}: ${critical.slice(0, 2).map((c) => c.title).join("; ")}`
    : warnings.length
      ? `${warnings.length} warning${warnings.length > 1 ? "s" : ""}: ${warnings.slice(0, 2).map((c) => c.title).join("; ")} · ${scoreText}`
      : `No SEO regressions · ${scoreText}`;

  return {
    from: { url: prev.url, takenAt: prev.takenAt, overall: prev.overall },
    to: { url: next.url, takenAt: next.takenAt, overall: next.overall },
    crossOrigin,
    overallDelta,
    geoDelta: prev.geoScore !== null && next.geoScore !== null ? next.geoScore - prev.geoScore : null,
    categoryDeltas,
    newIssues,
    worsenedIssues,
    resolvedIssues,
    changes,
    environment,
    level,
    summary,
  };
}

/** Does this diff fail a gate? "critical": only critical changes; "new": any new/worsened issue above low impact. */
export function diffFails(d: SnapshotDiff, gate: "critical" | "new" | "none"): boolean {
  if (gate === "none") return false;
  if (d.changes.some((c) => c.level === "critical")) return true;
  if (gate === "critical") return false;
  return [...d.newIssues, ...d.worsenedIssues].some((i) => i.impact !== "low");
}

/** Markdown rendering (CI job summaries, PR comments, alert emails). */
export function diffToMarkdown(d: SnapshotDiff): string {
  const label = d.level === "critical" ? "Critical" : d.level === "warning" ? "Warning" : "OK";
  const lines: string[] = [];
  lines.push(`### Septune · ${label}: ${d.summary}`);
  lines.push("");
  lines.push(`Compared **${d.to.url}** with **${d.from.url}**. Score ${d.from.overall} → ${d.to.overall}.`);
  if (d.changes.length) {
    lines.push("");
    lines.push("| | Change |");
    lines.push("|---|---|");
    for (const c of d.changes.slice(0, 40)) {
      const tag = c.level === "critical" ? "**critical**" : c.level;
      lines.push(`| ${tag} | ${c.title.replace(/\|/g, "\\|")} |`);
    }
  }
  if (d.resolvedIssues.length) {
    lines.push("");
    lines.push(`Fixed: ${d.resolvedIssues.map((i) => i.title).join(" · ")}`);
  }
  if (d.environment.length) {
    lines.push("");
    const n = d.environment.length;
    lines.push(`<details><summary>${n} difference${n > 1 ? "s" : ""} that come${n > 1 ? "" : "s"} from the environment, not the code</summary>`);
    lines.push("");
    for (const e of d.environment.slice(0, 20)) lines.push(`- ${e}`);
    lines.push("</details>");
  }
  lines.push("");
  return lines.join("\n");
}
