// The CLI runs on the user's own machine: auditing http://localhost is the
// point, and there is no hosted server to protect. The SSRF guard reads this
// at call time (not import time), so setting it here is enough.
process.env.RANKFORGE_ALLOW_LOCAL = "1";

import type { CategoryScore, Framework, Repository, SeoCategory, SeoIssue, Severity } from "@/types";
import { crawl, probeSiteFiles } from "@/lib/agents/crawl";
import { runDeterministicAudit, type EngineIssue } from "@/lib/audit/engine";
import { probeResources } from "@/lib/audit/resource-probe";
import { FIXABLE_RULE_IDS, generateDeterministicFix } from "@/lib/audit/deterministic-fix";
import { SEO_RULES } from "@/lib/audit/rules";
import { runGeoAudit, buildLlmsTxt, type GeoReport } from "@/lib/audit/geo";
import { computeOverallScore } from "@/lib/scoring";
import { CATEGORY_WEIGHTS } from "@/lib/seo/constants";
import { writeFileSync } from "node:fs";
import { renderHtmlReport } from "./html-report";
import { runStdioServer } from "./mcp-stdio";

/**
 * rankforge — deterministic technical-SEO audit, from the terminal.
 *
 *   rankforge audit <url> [--pages N] [--framework nextjs] [--json] [--fail-under N] [--no-probe]
 *   rankforge fix <ruleId> [--framework nextjs] [--url https://…]
 *   rankforge geo <url>            AI-search (GEO) readiness
 *   rankforge llms <url>           generate llms.txt
 *   rankforge links <url>          internal-link suggestions
 *   rankforge mcp                  local MCP server (stdio) for Claude Code / Cursor
 *   rankforge rules
 *
 * No AI, no API keys, no telemetry. The same engine that powers rankforge.dev.
 */

const VERSION = "0.2.0";
const APP_URL = "https://rank-forge-blue.vercel.app";

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
  if (!v) return fail("Missing <url>. Example: rankforge audit https://example.com");
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

// ── audit ─────────────────────────────────────────────────────────────
async function cmdAudit(args: Args) {
  const url = asUrl(args._[1]);
  const framework = asFramework(args.flags.framework);
  const maxPages = Math.max(1, Math.min(Number(args.flags.pages) || 8, 24));
  const json = args.flags.json === true;
  const probe = args.flags.probe !== false;
  const failUnder = args.flags["fail-under"] !== undefined ? Number(args.flags["fail-under"]) : null;

  const started = Date.now();
  if (!json) process.stderr.write(`${c.dim(`crawling ${url} (up to ${maxPages} pages)…`)}\n`);

  const repo = synthRepo(url, framework);
  const [pages, siteFiles] = await Promise.all([
    crawl(url, { maxPages, deadlineMs: 90_000 }),
    probeSiteFiles(url),
  ]);
  const resources =
    probe && maxPages > 1 ? await probeResources(pages, url).catch(() => undefined) : undefined;
  const engine = runDeterministicAudit(repo, pages, siteFiles, resources);

  const scores = engine.categoryScores as Record<string, number>;
  const overall = weightedOverall(engine.categoryScores);
  const geo = runGeoAudit(pages, siteFiles);
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
          siteSignals: engine.siteSignals,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    printReport({ url, pages: pages.length, elapsed, overall, scores, issues, engine, geo });
  }

  if (typeof args.flags.html === "string") {
    writeFileSync(
      args.flags.html,
      renderHtmlReport({
        url, pages: pages.length, elapsed, overall, scores, issues, geo,
        fixable: [...FIXABLE_RULE_IDS], version: VERSION,
      }),
    );
    process.stderr.write(`${c.green("✓")} HTML report written to ${args.flags.html}\n`);
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
}) {
  const out: string[] = [];
  const w = (s = "") => out.push(s);

  w("");
  w(`${c.bold("RankForge audit")}  ${c.cyan(r.url)}`);
  w(c.dim(`${r.pages} pages · ${r.elapsed}s · deterministic — no AI, no external API`));
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
      const urls = i.affectedUrls.slice(0, 3).map((u) => u.url);
      if (urls.length) {
        const more = i.affectedUrls.length > 3 ? c.dim(` +${i.affectedUrls.length - 3} more`) : "";
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
  const geoFails = r.geo.checks.filter((x) => x.status !== "pass").length;
  w(`${c.bold("AI search readiness")}  ${gTone(c.bold(`${r.geo.score}/100`))}  ${c.dim(geoFails ? `${geoFails} thing${geoFails > 1 ? "s" : ""} to improve, run: rankforge geo ${r.url}` : "all checks pass")}`);
  w("");

  const fixable = r.issues.filter((i) => i.ruleId && FIXABLE_RULE_IDS.includes(i.ruleId));
  if (fixable.length) {
    w(`${c.green("✚")} ${fixable.length} issue${fixable.length > 1 ? "s have" : " has"} a ready patch: ${c.cyan(`rankforge fix <ruleId> --framework <fw>`)}`);
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
        SEO_RULES.map((r) => ({
          id: r.id,
          category: r.category,
          title: r.title,
          impact: r.defaultImpact,
          canAutoFix: r.canAutoFix,
        })),
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const out: string[] = [""];
  out.push(`${c.bold("Rule catalog")} ${c.dim(`(${SEO_RULES.length} documented classes; the engine checks ~35)`)}`);
  let last = "";
  for (const r of SEO_RULES) {
    if (r.category !== last) {
      out.push("");
      out.push(c.cyan(r.category));
      last = r.category;
    }
    const auto = r.canAutoFix ? c.green(" auto-fix") : "";
    out.push(`  ${impactPaint[r.defaultImpact as Severity](r.defaultImpact.padEnd(8))} ${r.title}${auto}`);
  }
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

function pagesFlag(args: Args, def: number): number {
  return Math.max(1, Math.min(Number(args.flags.pages) || def, 24));
}

// ── geo ───────────────────────────────────────────────────────────────
async function cmdGeo(args: Args) {
  const url = asUrl(args._[1]);
  const json = args.flags.json === true;
  if (!json) process.stderr.write(`${c.dim(`checking AI-search readiness of ${url}…`)}\n`);
  const [pages, siteFiles] = await Promise.all([
    crawl(url, { maxPages: pagesFlag(args, 8), deadlineMs: 90_000 }),
    probeSiteFiles(url),
  ]);
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
        const mark = ch.status === "pass" ? c.green("✓") : ch.status === "warn" ? c.yellow("!") : c.red("✗");
        out.push(`  ${mark} ${ch.title}`);
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
  const pages = await crawl(url, { maxPages: pagesFlag(args, 12), deadlineMs: 90_000 });
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
  const [pages, siteFiles] = await Promise.all([
    crawl(url, { maxPages: pagesFlag(args, 16), deadlineMs: 90_000 }),
    probeSiteFiles(url),
  ]);
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

// ── help / main ───────────────────────────────────────────────────────
function help() {
  process.stdout.write(`
${c.bold("rankforge")} ${c.dim(`v${VERSION}`)} — deterministic technical-SEO audit. No AI, no API keys.

${c.bold("Commands")}
  audit <url>    full technical-SEO audit + AI-search readiness summary
  geo <url>      AI-search (GEO) readiness: AI crawler access, llms.txt, citability
  llms <url>     generate an llms.txt for your site            [--out public/llms.txt]
  links <url>    internal-link suggestions, orphans, strongest pages
  fix <ruleId>   print a ready-to-apply patch                  [--framework] [--url]
  rules          the rule catalog
  mcp            run as a local MCP server for Claude Code / Cursor / VS Code

${c.bold("Examples")}
  rankforge audit http://localhost:3000
  rankforge audit https://example.com --pages 12 --framework astro
  rankforge audit https://example.com --json --fail-under 80     ${c.dim("# CI gate")}
  rankforge audit https://example.com --html report.html         ${c.dim("# shareable report")}
  rankforge geo https://example.com
  rankforge llms https://example.com --out public/llms.txt
  rankforge fix framework-robots-missing --framework nextjs
  claude mcp add rankforge -- npx -y rankforge-cli mcp           ${c.dim("# the agent, in your editor")}

${c.bold("Flags")}
  --pages N        pages to crawl, breadth-first (default 8, max 24)
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
    else if (cmd === "mcp") await runStdioServer();
    else fail(`Unknown command "${cmd}". Try: rankforge --help`);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

main();
