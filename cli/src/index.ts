// The CLI runs on the user's own machine: auditing http://localhost is the
// point, and there is no hosted server to protect. The SSRF guard reads this
// at call time (not import time), so setting it here is enough.
process.env.RANKFORGE_ALLOW_LOCAL = "1";

import type { CategoryScore, Framework, Repository, SeoCategory, SeoIssue, Severity } from "@/types";
import { crawlSite, probeSiteFiles, type SiteFiles } from "@/lib/agents/crawl";
import { runDeterministicAudit, type EngineIssue } from "@/lib/audit/engine";
import { probeResources } from "@/lib/audit/resource-probe";
import { FIXABLE_RULE_IDS, generateDeterministicFix } from "@/lib/audit/deterministic-fix";
import { RULE_CATALOG } from "@/lib/audit/catalog";
import { runGeoAudit, buildLlmsTxt, type GeoReport } from "@/lib/audit/geo";
import { computeOverallScore } from "@/lib/scoring";
import { CATEGORY_WEIGHTS } from "@/lib/seo/constants";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CrawledPage } from "@/lib/audit/types";
import { buildSnapshot, diffSnapshots, diffFails, diffToMarkdown, type SiteSnapshot, type SnapshotDiff } from "@/lib/audit/snapshot";
import { fetchVitals, formatVital, type VitalsReport } from "@/lib/audit/vitals";
import { renderHtmlReport } from "./html-report";
import { runStdioServer } from "./mcp-stdio";

/**
 * septune — deterministic technical-SEO audit, from the terminal.
 *
 *   septune audit <url> [--pages N] [--framework nextjs] [--json] [--fail-under N] [--save snap.json]
 *   septune diff <before> <after>  compare two snapshots or two live URLs (preview vs production)
 *   septune watch <url> --baseline snap.json   regression gate against a saved baseline
 *   septune vitals <url>         Core Web Vitals of real users (CrUX, needs CRUX_API_KEY)
 *   septune fix <ruleId> [--framework nextjs] [--url https://…]
 *   septune geo <url>            AI-search (GEO) readiness
 *   septune llms <url>           generate llms.txt
 *   septune links <url>          internal-link suggestions
 *   septune mcp                  local MCP server (stdio) for Claude Code / Cursor
 *   septune rules
 *
 * No AI, no API keys, no telemetry. The same engine that powers www.septune.dev.
 * (The only outbound call to a third party is the opt-in --vitals / vitals,
 * which asks Google's CrUX API about the URL.)
 */

const VERSION = "0.3.0";
const APP_URL = "https://www.septune.dev";

const FRAMEWORKS: Framework[] = ["nextjs", "nuxt", "astro", "sveltekit", "remix", "vite-react", "mdx", "static"];

// ── tiny ANSI helper (zero deps; honors NO_COLOR and non-TTY) ─────────
const useColor = !process.env.NO_COLOR && process.stdout.isTTY && !process.argv.includes("--no-color");
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  cyan: paint("36"),
  gray: paint("90"),
};

const IMPACT_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const impactPaint: Record<Severity, (s: string) => string> = {
  critical: c.red,
  high: c.red,
  medium: c.yellow,
  low: c.gray,
};

// ── arg parsing (no deps) ─────────────────────────────────────────────
type Args = { _: string[]; flags: Record<string, string | boolean> };
function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) out.flags[k!] = inline;
      else if (k!.startsWith("no-")) out.flags[k!.slice(3)] = false;
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          out.flags[k!] = next;
          i++;
        } else out.flags[k!] = true;
      }
    } else out._.push(a);
  }
  return out;
}

function fail(msg: string, code = 2): never {
  process.stderr.write(`${c.red("error")} ${msg}\n`);
  process.exit(code);
}

function asFramework(v: unknown): Framework {
  if (v === undefined) return "nextjs";
  if (FRAMEWORKS.includes(v as Framework)) return v as Framework;
  return fail(`Unknown framework "${String(v)}". Use one of: ${FRAMEWORKS.join(", ")}`);
}

function asUrl(v: string | undefined): string {
  if (!v) return fail("Missing <url>. Example: septune audit https://example.com");
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    return u.toString();
  } catch {
    return fail(`Not a valid URL: ${v}`);
  }
}

function synthRepo(url: string, framework: Framework): Repository {
  return {
    id: "cli",
    framework,
    productionUrl: url,
    fullName: "local/site",
    defaultBranch: "main",
    score: 0,
  } as unknown as Repository;
}

// ── shared site scan ──────────────────────────────────────────────────
interface Scan {
  url: string;
  pages: CrawledPage[];
  siteFiles: SiteFiles & { crawlComplete: boolean; vitals?: VitalsReport | null };
  blockedByRobots: string[];
}

/**
 * Probe the site files first (robots.txt rules + sitemap URLs), then crawl:
 * links first, sitemap entries nothing links to after, robots.txt honoured
 * unless --ignore-robots.
 */
async function scanSite(url: string, args: Args, defaultPages: number): Promise<Scan> {
  const maxPages = pagesFlag(args, defaultPages);
  const concurrency = Math.max(1, Math.min(Number(args.flags.concurrency) || 4, 8));
  const ignoreRobots = args.flags["ignore-robots"] === true;
  const siteFiles = await probeSiteFiles(url);
  const seeds = (siteFiles.sitemapUrls ?? []).slice(0, 2000).map((u) => ({ url: u, via: "sitemap" as const }));
  const res = await crawlSite(url, {
    maxPages,
    hardCap: MAX_PAGES,
    concurrency,
    deadlineMs: Math.max(90_000, maxPages * 1500),
    robotsTxt: ignoreRobots ? undefined : siteFiles.robotsTxt,
    seeds,
  });
  if (res.pages.length === 0 && res.blockedByRobots.length) {
    fail("robots.txt disallows SeptuneBot on this URL. If it's your own site, re-run with --ignore-robots.");
  }
  return { url, pages: res.pages, siteFiles: { ...siteFiles, crawlComplete: res.complete }, blockedByRobots: res.blockedByRobots };
}

/** --vitals: CrUX field data (opt-in, needs CRUX_API_KEY or --crux-key). */
async function maybeVitals(url: string, args: Args, quiet: boolean): Promise<VitalsReport | null> {
  if (args.flags.vitals !== true) return null;
  const key = typeof args.flags["crux-key"] === "string" ? args.flags["crux-key"] : process.env.CRUX_API_KEY;
  const r = await fetchVitals(url, key);
  if (r.ok) return r.report;
  if (!quiet) process.stderr.write(`${c.yellow("!")} ${r.message}\n`);
  return null;
}

function snapshotOf(scan: Scan, framework: Framework, resources?: Awaited<ReturnType<typeof probeResources>>) {
  const engine = runDeterministicAudit(synthRepo(scan.url, framework), scan.pages, scan.siteFiles, resources);
  const overall = weightedOverall(engine.categoryScores);
  const geo = runGeoAudit(scan.pages, scan.siteFiles);
  const snapshot = buildSnapshot({ url: scan.url, pages: scan.pages, engine, overall, geo, siteFiles: scan.siteFiles });
  return { engine, overall, geo, snapshot };
}

// ── audit ─────────────────────────────────────────────────────────────
async function cmdAudit(args: Args) {
  const url = asUrl(args._[1]);
  const framework = asFramework(args.flags.framework);
  const maxPages = pagesFlag(args, DEFAULT_PAGES);
  const json = args.flags.json === true;
  const probe = args.flags.probe !== false;
  const failUnder = args.flags["fail-under"] !== undefined ? Number(args.flags["fail-under"]) : null;

  const started = Date.now();
  if (!json) process.stderr.write(`${c.dim(`crawling ${url} (up to ${maxPages} pages)…`)}\n`);

  const scan = await scanSite(url, args, DEFAULT_PAGES);
  const { pages, siteFiles } = scan;
  const resources =
    probe && maxPages > 1 ? await probeResources(pages, url).catch(() => undefined) : undefined;
  siteFiles.vitals = await maybeVitals(url, args, json);
  const { engine, overall, geo, snapshot } = snapshotOf(scan, framework, resources);

  const scores = engine.categoryScores as Record<string, number>;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const issues = [...engine.issues].sort(
    (a, b) =>
      IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) ||
      b.affectedUrls.length - a.affectedUrls.length,
  );

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          url,
          pagesCrawled: pages.length,
          elapsedSeconds: Number(elapsed),
          overall,
          categoryScores: scores,
          issues: issues.map(compactIssue),
          geo,
          vitals: siteFiles.vitals ?? null,
          crawl: {
            complete: siteFiles.crawlComplete,
            sitemapUrls: siteFiles.sitemapUrls?.length ?? 0,
            blockedByRobots: scan.blockedByRobots,
          },
          siteSignals: engine.siteSignals,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    printReport({ url, pages: pages.length, elapsed, overall, scores, issues, engine, geo, scan });
  }

  if (typeof args.flags.html === "string") {
    writeFileSync(
      args.flags.html,
      renderHtmlReport({
        url, pages: pages.length, elapsed, overall, scores, issues, geo,
        fixable: [...FIXABLE_RULE_IDS], version: VERSION,
        brand: typeof args.flags.brand === "string" ? args.flags.brand : undefined,
        brandUrl: typeof args.flags["brand-url"] === "string" ? args.flags["brand-url"] : undefined,
        brandColor: typeof args.flags["brand-color"] === "string" ? args.flags["brand-color"] : undefined,
      }),
    );
    process.stderr.write(`${c.green("✓")} HTML report written to ${args.flags.html}\n`);
  }

  // --markdown appends, like diff: the GitHub Action collects both in one file.
  if (typeof args.flags.markdown === "string") {
    appendFileSync(args.flags.markdown, auditToMarkdown({ url, pages: pages.length, overall, issues, geoScore: geo.score }));
  }

  if (typeof args.flags.save === "string") {
    writeFileSync(args.flags.save, JSON.stringify(snapshot, null, 2) + "\n");
    process.stderr.write(`${c.green("✓")} snapshot saved to ${args.flags.save} (compare later: septune diff ${args.flags.save} <url>)\n`);
  }

  if (failUnder !== null && overall < failUnder) {
    if (!json) process.stderr.write(`\n${c.red("✗")} score ${overall} is below --fail-under ${failUnder}\n`);
    // exitCode, not exit(): on Windows, process.exit() with HTTP sockets still
    // open can abort Node (0xC0000409) — CI would see a crash instead of a 1.
    process.exitCode = 1;
  }
}

function compactIssue(i: EngineIssue) {
  return {
    ruleId: i.ruleId,
    category: i.category,
    impact: i.impact,
    title: i.title,
    evidence: i.evidence,
    affectedCount: i.affectedUrls.length,
    affectedUrls: i.affectedUrls.slice(0, 10),
    likelyFiles: i.files.map((f) => f.path),
    fixTemplate: FIXABLE_RULE_IDS.includes(i.ruleId),
  };
}

/** The audit as a short Markdown summary (job summary, pull-request comment). */
function auditToMarkdown(r: { url: string; pages: number; overall: number; issues: EngineIssue[]; geoScore: number }): string {
  const critical = r.issues.filter((i) => i.impact === "critical").length;
  const lines = [
    `### Septune · SEO audit: ${r.overall}/100${critical ? ` · ${critical} critical` : ""}`,
    "",
    `**${r.url}** · ${r.pages} pages · AI-search readiness ${r.geoScore}/100`,
    "",
  ];
  if (!r.issues.length) {
    lines.push("No issues detected.", "");
    return lines.join("\n");
  }
  lines.push("| Impact | Issue | Pages |", "|---|---|---|");
  for (const i of r.issues.slice(0, 12)) {
    const impact = i.impact === "critical" ? "**critical**" : i.impact;
    lines.push(`| ${impact} | ${i.title.replace(/\|/g, "\\|")} | ${i.affectedUrls.length} |`);
  }
  if (r.issues.length > 12) lines.push(`| | ${r.issues.length - 12} more issues in the full report | |`);
  lines.push("");
  return lines.join("\n");
}

function bar(score: number, width = 12): string {
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * width);
  const tone = score >= 80 ? c.green : score >= 60 ? c.yellow : c.red;
  return tone("█".repeat(filled)) + c.gray("░".repeat(width - filled));
}

function printReport(r: {
  url: string;
  pages: number;
  elapsed: string;
  overall: number;
  scores: Record<string, number>;
  issues: EngineIssue[];
  engine: ReturnType<typeof runDeterministicAudit>;
  geo: GeoReport;
  scan?: Scan;
}) {
  const out: string[] = [];
  const w = (s = "") => out.push(s);

  w("");
  w(`${c.bold("Septune audit")}  ${c.cyan(r.url)}`);
  w(c.dim(`${r.pages} pages · ${r.elapsed}s · deterministic, no AI, no external API`));
  if (r.scan) {
    const sf = r.scan.siteFiles;
    const bits = [
      sf.crawlComplete ? "every linked page crawled" : `stopped at the ${r.pages}-page limit (raise it with --pages)`,
      sf.sitemapUrls?.length ? `${sf.sitemapUrls.length} sitemap URL${sf.sitemapUrls.length > 1 ? "s" : ""}` : "no sitemap read",
    ];
    if (r.scan.blockedByRobots.length) bits.push(`${r.scan.blockedByRobots.length} path(s) skipped by robots.txt`);
    w(c.dim(bits.join(" · ")));
    const v = sf.vitals;
    if (v) {
      const parts = (["lcp", "inp", "cls"] as const).filter((k) => v[k]).map((k) => formatVital(k, v[k]!));
      w(c.dim(`Core Web Vitals (real users, ${v.scope}): ${parts.join(" · ")}`));
    }
  }
  w("");

  const tone = r.overall >= 80 ? c.green : r.overall >= 60 ? c.yellow : c.red;
  w(`${c.bold("Score")}  ${tone(c.bold(`${r.overall}/100`))}`);
  for (const [cat, score] of Object.entries(r.scores)) {
    w(`  ${cat.padEnd(17)} ${bar(score)}  ${String(score).padStart(3)}`);
  }
  w("");

  if (r.issues.length === 0) {
    w(`${c.green("✓")} No issues detected. Nice.`);
  } else {
    w(`${c.bold("Issues")} ${c.dim(`(${r.issues.length})`)}`);
    for (const i of r.issues) {
      const tag = impactPaint[i.impact](i.impact.toUpperCase().padEnd(8));
      const fixable = i.ruleId && FIXABLE_RULE_IDS.includes(i.ruleId) ? c.green(" · fix template") : "";
      w(`  ${tag} ${c.bold(i.title)} ${c.dim(`(${i.affectedUrls.length})`)}${fixable}`);
      if (i.evidence) w(`           ${c.dim(i.evidence)}`);
      // One rule can list a page several times (a link suggestion per target).
      const unique = [...new Set(i.affectedUrls.map((u) => u.url))];
      const urls = unique.slice(0, 3);
      if (urls.length) {
        const more = unique.length > 3 ? c.dim(` +${unique.length - 3} more`) : "";
        w(`           ${c.gray("→")} ${urls.join(c.gray(", "))}${more}`);
      }
    }
    w("");
  }

  const s = r.engine.siteSignals;
  const signals: string[] = [];
  if (s.orphanPages?.length) signals.push(`${s.orphanPages.length} orphan page${s.orphanPages.length > 1 ? "s" : ""}`);
  if (typeof s.maxDepth === "number") signals.push(`max click depth ${s.maxDepth}`);
  if (s.brokenInternalLinks?.length) signals.push(`${s.brokenInternalLinks.length} broken internal links`);
  if (s.duplicateClusters?.length) signals.push(`${s.duplicateClusters.length} near-duplicate clusters`);
  if (s.linkSuggestions?.length) signals.push(`${s.linkSuggestions.length} internal-link suggestions`);
  if (signals.length) {
    w(`${c.bold("Site signals")}  ${c.dim(signals.join(" · "))}`);
    w("");
  }

  const gTone = r.geo.score >= 80 ? c.green : r.geo.score >= 60 ? c.yellow : c.red;
  const geoFails = r.geo.checks.filter((x) => x.status !== "pass" && !x.informational).length;
  w(`${c.bold("AI search readiness")}  ${gTone(c.bold(`${r.geo.score}/100`))}  ${c.dim(geoFails ? `${geoFails} thing${geoFails > 1 ? "s" : ""} to improve, run: septune geo ${r.url}` : "all checks pass")}`);
  w("");

  const fixable = r.issues.filter((i) => i.ruleId && FIXABLE_RULE_IDS.includes(i.ruleId));
  if (fixable.length) {
    w(`${c.green("✚")} ${fixable.length} issue${fixable.length > 1 ? "s have" : " has"} a ready patch: ${c.cyan(`septune fix <ruleId> --framework <fw>`)}`);
  }
  w(c.dim(`Full report, patches by file & the editor agent: ${APP_URL}`));
  w("");
  process.stdout.write(out.join("\n"));
}

// ── fix ───────────────────────────────────────────────────────────────
function cmdFix(args: Args) {
  const ruleId = args._[1];
  if (!ruleId) return fail(`Missing <ruleId>. Fixable rules: ${FIXABLE_RULE_IDS.join(", ")}`);
  if (!FIXABLE_RULE_IDS.includes(ruleId)) {
    return fail(`No deterministic patch for "${ruleId}". Fixable rules: ${FIXABLE_RULE_IDS.join(", ")}`);
  }
  const framework = asFramework(args.flags.framework);
  const url = typeof args.flags.url === "string" ? asUrl(args.flags.url) : "https://example.com/";
  const repo = synthRepo(url, framework);
  const issue = {
    id: `iss_cli:${ruleId}`,
    repoId: "cli",
    title: ruleId,
    description: "",
    category: "framework",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 90,
    status: "open",
    affectedUrls: [{ url }],
    evidence: "",
    canAutoFix: true,
    files: [],
  } as unknown as SeoIssue;
  const fix = generateDeterministicFix(issue, repo);
  if (!fix) return fail("No template available for this rule.");

  if (args.flags.json === true) {
    process.stdout.write(JSON.stringify(fix, null, 2) + "\n");
    return;
  }
  const out: string[] = [];
  out.push("");
  out.push(`${c.bold(fix.summary)}`);
  out.push(c.dim(`files: ${fix.filesChanged.join(", ")} · branch: ${fix.branchName} · confidence ${fix.confidence}%`));
  out.push("");
  for (const line of fix.diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) out.push(c.bold(line));
    else if (line.startsWith("@@")) out.push(c.cyan(line));
    else if (line.startsWith("+")) out.push(c.green(line));
    else if (line.startsWith("-")) out.push(c.red(line));
    else out.push(c.dim(line));
  }
  // The first paragraph of the PR description carries the caveats (what to
  // adapt per page); the rest repeats the code shown above.
  const note = fix.prDescription.split("\n\n")[0]?.trim();
  if (note) {
    out.push("");
    out.push(c.bold("Notes"));
    out.push(`  ${note}`);
  }
  out.push("");
  out.push(`${c.bold("Verify")}`);
  for (const step of fix.validationSteps) out.push(`  • ${step}`);
  out.push("");
  process.stdout.write(out.join("\n"));
}

// ── rules ─────────────────────────────────────────────────────────────
function cmdRules(args: Args) {
  if (args.flags.json === true) {
    process.stdout.write(
      JSON.stringify(
        RULE_CATALOG.map((r) => ({
          id: r.id,
          category: r.category,
          impact: r.impact,
          title: r.title,
          fixTemplate: FIXABLE_RULE_IDS.includes(r.id),
          docs: r.doc ? `${APP_URL}/docs/issues/${r.doc}` : null,
        })),
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const out: string[] = [""];
  out.push(`${c.bold("Rule catalog")} ${c.dim(`(${RULE_CATALOG.length} site checks, plus the AI-search checks of septune geo)`)}`);
  let last = "";
  for (const r of RULE_CATALOG) {
    if (r.category !== last) {
      out.push("");
      out.push(c.cyan(r.category));
      last = r.category;
    }
    const fix = FIXABLE_RULE_IDS.includes(r.id) ? c.green(" · fix template") : "";
    out.push(`  ${impactPaint[r.impact](r.impact.padEnd(8))} ${r.title}  ${c.dim(r.id)}${fix}`);
  }
  out.push("");
  out.push(c.dim("Patch a rule with a fix template: septune fix <ruleId> --framework nextjs"));
  out.push("");
  process.stdout.write(out.join("\n"));
}

// ── shared ────────────────────────────────────────────────────────────
function weightedOverall(cats: Record<string, number>): number {
  const list: CategoryScore[] = (Object.entries(cats) as [SeoCategory, number][]).map(
    ([category, score]) => ({ category, score, issues: 0, weight: CATEGORY_WEIGHTS[category] }),
  );
  return computeOverallScore(list);
}

const DEFAULT_PAGES = 25;
const MAX_PAGES = 500;

function pagesFlag(args: Args, def: number): number {
  return Math.max(1, Math.min(Number(args.flags.pages) || def, MAX_PAGES));
}

// ── geo ───────────────────────────────────────────────────────────────
async function cmdGeo(args: Args) {
  const url = asUrl(args._[1]);
  const json = args.flags.json === true;
  if (!json) process.stderr.write(`${c.dim(`checking AI-search readiness of ${url}…`)}\n`);
  const { pages, siteFiles } = await scanSite(url, args, 12);
  const geo = runGeoAudit(pages, siteFiles);
  if (json) {
    process.stdout.write(JSON.stringify({ url, pagesCrawled: pages.length, ...geo }, null, 2) + "\n");
  } else {
    const out: string[] = [""];
    const tone = geo.score >= 80 ? c.green : geo.score >= 60 ? c.yellow : c.red;
    out.push(`${c.bold("AI search readiness (GEO)")}  ${c.cyan(url)}`);
    out.push(c.dim(`${pages.length} pages · can ChatGPT, Claude, Perplexity & Gemini reach, read and cite you?`));
    out.push("");
    out.push(`${c.bold("Score")}  ${tone(c.bold(`${geo.score}/100`))}`);
    out.push("");
    out.push(c.bold("AI crawler access (robots.txt)"));
    for (const b of geo.bots) {
      const label = b.allowed ? "allowed" : "blocked";
      const st = b.allowed ? c.green(label) : b.purpose === "training" ? c.yellow(label) : c.red(label);
      out.push(`  ${b.bot.padEnd(18)} ${st}  ${c.dim(`${b.purpose} · ${b.owner}`)}`);
    }
    out.push("");
    const groups: [GeoCheckGroup, string][] = [
      ["access", "Access"],
      ["readable", "Readable"],
      ["citable", "Citable"],
    ];
    for (const [g, label] of groups) {
      out.push(c.bold(label));
      for (const ch of geo.checks.filter((x) => x.group === g)) {
        const mark = ch.informational ? c.gray("i") : ch.status === "pass" ? c.green("✓") : ch.status === "warn" ? c.yellow("!") : c.red("✗");
        out.push(`  ${mark} ${ch.title}${ch.informational ? c.dim("  (for information, not scored)") : ""}`);
        out.push(`    ${c.dim(ch.detail)}`);
        if (ch.pages?.length) out.push(`    ${c.gray("→")} ${ch.pages.slice(0, 5).join(c.gray(", "))}`);
        if (ch.fix) for (const l of ch.fix.split("\n")) out.push(`    ${c.cyan(l)}`);
      }
      out.push("");
    }
    out.push(c.dim("Measures what you control: access, readability, citability. Nobody outside the engines can honestly promise a citation."));
    out.push("");
    process.stdout.write(out.join("\n"));
  }
  if (args.flags["fail-under"] !== undefined && geo.score < Number(args.flags["fail-under"])) {
    process.exitCode = 1; // see cmdAudit: never process.exit() with sockets open
  }
}

type GeoCheckGroup = GeoReport["checks"][number]["group"];

// ── llms.txt ──────────────────────────────────────────────────────────
async function cmdLlms(args: Args) {
  const url = asUrl(args._[1]);
  process.stderr.write(`${c.dim(`crawling ${url} to build llms.txt…`)}\n`);
  const { pages } = await scanSite(url, args, 25);
  const txt = buildLlmsTxt(pages, url);
  if (typeof args.flags.out === "string") {
    writeFileSync(args.flags.out, txt);
    process.stderr.write(`${c.green("✓")} wrote ${args.flags.out} (${pages.length} pages)\n`);
  } else {
    process.stdout.write(txt);
  }
}

// ── internal links ────────────────────────────────────────────────────
async function cmdLinks(args: Args) {
  const url = asUrl(args._[1]);
  const json = args.flags.json === true;
  if (!json) process.stderr.write(`${c.dim(`mapping internal links of ${url}…`)}\n`);
  const repo = synthRepo(url, "nextjs");
  const { pages, siteFiles } = await scanSite(url, args, DEFAULT_PAGES);
  const s = runDeterministicAudit(repo, pages, siteFiles).siteSignals;
  if (json) {
    process.stdout.write(
      JSON.stringify(
        { url, pagesCrawled: pages.length, suggestions: s.linkSuggestions, orphanPages: s.orphanPages, authority: s.authorityRanking },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const out: string[] = ["", `${c.bold("Internal linking")}  ${c.cyan(url)}  ${c.dim(`${pages.length} pages`)}`, ""];
  out.push(c.bold("Link these related pages"));
  if (!s.linkSuggestions.length) out.push(c.dim("  No missing links between related pages found."));
  for (const l of s.linkSuggestions.slice(0, 20)) {
    out.push(`  ${l.from} ${c.gray("→")} ${l.to}  ${c.dim(`${Math.round(l.similarity * 100)}% related · anchor: "${l.anchorHint}"`)}`);
  }
  out.push("");
  if (s.orphanPages.length) {
    out.push(c.bold("Orphan pages (nothing links to them)"));
    for (const o of s.orphanPages) out.push(`  ${c.red("•")} ${o}`);
    out.push("");
  }
  if (s.authorityRanking.length) {
    out.push(c.bold("Strongest pages (internal PageRank)"));
    for (const a of s.authorityRanking.slice(0, 8)) out.push(`  ${a.path.padEnd(40)} ${c.dim(a.pageRank.toFixed(3))}`);
    out.push("");
  }
  process.stdout.write(out.join("\n"));
}

// ── diff / watch ─────────────────────────────────────────────────────
type Gate = "critical" | "new" | "none";

function asGate(v: unknown, def: Gate): Gate {
  if (v === undefined) return def;
  if (v === "critical" || v === "new" || v === "none") return v;
  return fail(`--fail-on must be critical, new or none (got "${String(v)}")`);
}

function readSnapshot(file: string): SiteSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fail(`${file} isn't a readable Septune snapshot (JSON).`);
  }
  const snap = parsed as SiteSnapshot;
  if (!snap || typeof snap !== "object" || typeof snap.v !== "number" || !snap.pages || !Array.isArray(snap.issues)) {
    return fail(`${file} isn't a Septune snapshot. Create one with: septune audit <url> --save ${file}`);
  }
  return snap;
}

/** A diff side: a saved snapshot file, or a live URL audited now. */
async function resolveSide(arg: string | undefined, args: Args, label: string): Promise<SiteSnapshot> {
  if (!arg) return fail(`Missing <${label}>. Usage: septune diff <before.json|url> <after.json|url>`);
  if (existsSync(arg) || /\.json$/i.test(arg)) return readSnapshot(arg);
  const url = asUrl(arg);
  if (args.flags.json !== true) process.stderr.write(`${c.dim(`auditing ${url}…`)}\n`);
  const scan = await scanSite(url, args, DEFAULT_PAGES);
  return snapshotOf(scan, asFramework(args.flags.framework)).snapshot;
}

function printDiff(d: SnapshotDiff) {
  const out: string[] = [""];
  const tone = d.level === "critical" ? c.red : d.level === "warning" ? c.yellow : c.green;
  out.push(`${c.bold("Septune diff")}  ${c.cyan(d.from.url)} ${c.gray("→")} ${c.cyan(d.to.url)}`);
  out.push(`${tone(c.bold(d.summary))}`);
  out.push("");
  const tag: Record<string, string> = { critical: c.red("CRITICAL"), warning: c.yellow("WARNING "), info: c.gray("info    ") };
  for (const ch of d.changes) out.push(`  ${tag[ch.level]} ${ch.title}`);
  if (!d.changes.length) out.push(`  ${c.green("✓")} nothing changed that matters for search`);
  if (d.resolvedIssues.length) {
    out.push("");
    out.push(`${c.green("Fixed")}  ${d.resolvedIssues.map((i) => i.title).join(c.gray(" · "))}`);
  }
  if (d.environment.length) {
    out.push("");
    out.push(c.dim(`${d.environment.length} difference${d.environment.length > 1 ? "s come" : " comes"} from the environment, not the code (preview headers, robots.txt, sitemap host…):`));
    for (const e of d.environment.slice(0, 6)) out.push(c.dim(`  · ${e}`));
  }
  out.push("");
  process.stdout.write(out.join("\n"));
}

function emitDiff(d: SnapshotDiff, args: Args, gate: Gate) {
  if (args.flags.json === true) process.stdout.write(JSON.stringify(d, null, 2) + "\n");
  else printDiff(d);
  // --markdown appends (GitHub's $GITHUB_STEP_SUMMARY is an append-only file).
  if (typeof args.flags.markdown === "string") appendFileSync(args.flags.markdown, diffToMarkdown(d));
  if (diffFails(d, gate)) {
    if (args.flags.json !== true) {
      process.stderr.write(`${c.red("✗")} regression gate failed (--fail-on ${gate})\n`);
    }
    process.exitCode = 1;
  }
}

async function cmdDiff(args: Args) {
  const gate = asGate(args.flags["fail-on"], "critical");
  const before = await resolveSide(args._[1], args, "before");
  const after = await resolveSide(args._[2], args, "after");
  emitDiff(diffSnapshots(before, after), args, gate);
}

async function cmdWatch(args: Args) {
  const url = asUrl(args._[1]);
  const baseline = typeof args.flags.baseline === "string" ? args.flags.baseline : ".septune/baseline.json";
  const gate = asGate(args.flags["fail-on"], "critical");
  const json = args.flags.json === true;
  if (!json) process.stderr.write(`${c.dim(`auditing ${url}…`)}\n`);
  const scan = await scanSite(url, args, DEFAULT_PAGES);
  scan.siteFiles.vitals = await maybeVitals(url, args, json);
  const { snapshot } = snapshotOf(scan, asFramework(args.flags.framework));
  const save = () => {
    const dir = dirname(baseline);
    if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(baseline, JSON.stringify(snapshot, null, 2) + "\n");
  };
  if (!existsSync(baseline)) {
    save();
    if (!json) process.stdout.write(`\n${c.green("✓")} baseline saved to ${baseline} (score ${snapshot.overall}). Next runs compare against it.\n\n`);
    else process.stdout.write(JSON.stringify({ baselineCreated: baseline, overall: snapshot.overall }, null, 2) + "\n");
    return;
  }
  emitDiff(diffSnapshots(readSnapshot(baseline), snapshot), args, gate);
  if (args.flags.update === true) {
    save();
    if (!json) process.stderr.write(`${c.green("✓")} baseline updated\n`);
  }
}

// ── vitals ────────────────────────────────────────────────────────────
async function cmdVitals(args: Args) {
  const url = asUrl(args._[1]);
  const key = typeof args.flags["crux-key"] === "string" ? args.flags["crux-key"] : process.env.CRUX_API_KEY;
  const formFactor = args.flags.device === "desktop" ? "DESKTOP" : args.flags.device === "mobile" ? "PHONE" : undefined;
  const r = await fetchVitals(url, key, { formFactor });
  if (args.flags.json === true) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    if (!r.ok && r.reason !== "no-data") process.exitCode = 2;
    return;
  }
  if (!r.ok) {
    process.stdout.write(`\n${r.reason === "no-data" ? c.yellow("!") : c.red("✗")} ${r.message}\n\n`);
    if (r.reason !== "no-data") process.exitCode = 2;
    return;
  }
  const v = r.report;
  const out: string[] = ["", `${c.bold("Core Web Vitals")}  ${c.cyan(v.key)}  ${c.dim(`real Chrome users, p75${v.period ? `, ${v.period.first} → ${v.period.last}` : ""}`)}`];
  if (v.scope === "origin") out.push(c.dim("This URL has too few visits on its own: these are the numbers for the whole origin."));
  out.push("");
  for (const k of ["lcp", "inp", "cls", "fcp", "ttfb"] as const) {
    const m = v[k];
    if (!m) continue;
    const tone = m.rating === "good" ? c.green : m.rating === "poor" ? c.red : c.yellow;
    out.push(`  ${tone(formatVital(k, m))}`);
  }
  out.push("");
  out.push(c.dim("Good = LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Source: Chrome UX Report (Google)."));
  out.push("");
  process.stdout.write(out.join("\n"));
}

// ── help / main ───────────────────────────────────────────────────────
function help() {
  process.stdout.write(`
${c.bold("septune")} ${c.dim(`v${VERSION}`)}: deterministic technical-SEO audit. No AI, no API keys.

${c.bold("Commands")}
  audit <url>    full technical-SEO audit + AI-search readiness summary
  diff <a> <b>   what changed between two snapshots or two live URLs (preview vs production)
  watch <url>    compare against a saved baseline; exit 1 on regressions  [--baseline file] [--update]
  vitals <url>   Core Web Vitals of real users (Google CrUX; needs CRUX_API_KEY)  [--device mobile|desktop]
  geo <url>      AI-search (GEO) readiness: AI crawler access, llms.txt, citability
  llms <url>     generate an llms.txt for your site            [--out public/llms.txt]
  links <url>    internal-link suggestions, orphans, strongest pages
  fix <ruleId>   print a ready-to-apply patch                  [--framework] [--url]
  rules          the rule catalog
  mcp            run as a local MCP server for Claude Code / Cursor / VS Code

${c.bold("Examples")}
  septune audit http://localhost:3000
  septune audit https://example.com --pages 12 --framework astro
  septune audit https://example.com --json --fail-under 80     ${c.dim("# CI gate")}
  septune audit https://example.com --html report.html         ${c.dim("# shareable report")}
  septune audit https://example.com --save before.json         ${c.dim("# snapshot for later")}
  septune diff https://example.com https://preview.example.com ${c.dim("# fails on critical regressions")}
  septune watch https://example.com --baseline .septune/baseline.json
  septune geo https://example.com
  septune llms https://example.com --out public/llms.txt
  septune fix framework-robots-missing --framework nextjs
  claude mcp add septune -- npx -y septune mcp           ${c.dim("# the agent, in your editor")}

${c.bold("Flags")}
  --pages N        pages to crawl: linked pages first, then sitemap-only ones (default 25, max 500)
  --concurrency N  parallel requests (default 4, max 8)
  --ignore-robots  crawl paths robots.txt disallows for SeptuneBot (your own site only)
  --save file      write a snapshot (audit) for diff / watch
  --fail-on gate   diff & watch: critical (default) | new (any new issue) | none
  --markdown file  audit, diff & watch: append a Markdown summary (e.g. $GITHUB_STEP_SUMMARY)
  --vitals         add Core Web Vitals from Google CrUX (sends the URL to Google)
  --crux-key key   CrUX API key for --vitals / vitals (default: CRUX_API_KEY)
  --update         watch: replace the baseline with this run once it's compared
  --brand name     white-label the --html report  [--brand-url] [--brand-color #hex]
  --framework fw   ${FRAMEWORKS.join(" | ")}
  --json           machine-readable output
  --fail-under N   exit 1 if the score is below N (for CI): audit & geo
  --html file      write a self-contained HTML report (audit)
  --out file       write llms.txt to a file (llms)
  --no-probe       skip real image/link probing (faster)
  --no-color       plain output (also: NO_COLOR=1)

${c.dim(`Hosted app, patches by file & the editor agent (MCP): ${APP_URL}`)}
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (args.flags.version === true || cmd === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!cmd || args.flags.help === true || cmd === "help") return help();
  try {
    if (cmd === "audit") await cmdAudit(args);
    else if (cmd === "fix") cmdFix(args);
    else if (cmd === "rules") cmdRules(args);
    else if (cmd === "geo") await cmdGeo(args);
    else if (cmd === "llms") await cmdLlms(args);
    else if (cmd === "links") await cmdLinks(args);
    else if (cmd === "diff") await cmdDiff(args);
    else if (cmd === "watch") await cmdWatch(args);
    else if (cmd === "vitals") await cmdVitals(args);
    else if (cmd === "mcp") await runStdioServer();
    else fail(`Unknown command "${cmd}". Try: septune --help`);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

main();
