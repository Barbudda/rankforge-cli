// End-to-end tests for the built CLI (cli/dist/index.js) against a small
// fixture site served locally. Zero dependencies: node:test + node:http.
// Run: npm run cli:test   (builds first)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

// ── fixture site ──────────────────────────────────────────────────────
// Deliberately flawed: home blocks no bots but /blog lacks a canonical and a
// description, /about is an orphan-ish thin page, robots.txt blocks GPTBot
// (training) and PerplexityBot (search), there's no llms.txt and a broken link.
const PAGES = {
  "/": `<!doctype html><html lang="en"><head><title>Acme Widgets | Acme</title>
    <meta name="description" content="Acme builds durable widgets for makers and small factories since 2009.">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="canonical" href="/">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme","url":"/"}</script>
    </head><body><h1>Acme Widgets</h1>
    <p>We ship widgets that last 10 years. 98% of customers reorder within 12 months.</p>
    <h2>How do Acme widgets work?</h2><p>They snap together in under 5 minutes.</p>
    <h2>What does a widget cost?</h2><p>From 49 € per unit.</p>
    <a href="/blog">Blog</a> <a href="/pricing">Pricing</a> <a href="/missing">Old page</a>
    </body></html>`,
  "/blog": `<!doctype html><html lang="en"><head><title>Blog | Acme</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body><h1>Blog</h1><p>Widget maintenance guides and stories from the workshop.</p>
    <a href="/">Home</a> <a href="/pricing">Pricing</a></body></html>`,
  "/pricing": `<!doctype html><html lang="en"><head><title>Pricing | Acme</title>
    <meta name="description" content="Acme widget pricing: transparent per-unit prices with volume discounts.">
    <meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="/pricing"></head>
    <body><h1>Pricing</h1><p>Widgets cost 49 € each, 39 € above 100 units.</p><a href="/">Home</a></body></html>`,
};
const ROBOTS = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n";

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(ROBOTS);
    }
    const html = PAGES[path];
    if (html) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(req.method === "HEAD" ? undefined : html);
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<h1>Not found</h1>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

function run(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args, "--no-color"], { env: { ...process.env, NO_COLOR: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (opts.input !== undefined) child.stdin.end(opts.input);
  });
}

// ── tests ─────────────────────────────────────────────────────────────
test("CLI is built", () => {
  assert.ok(existsSync(CLI), `missing ${CLI} — run npm run cli:build`);
});

test("--version and --help", async () => {
  const v = await run(["--version"]);
  assert.equal(v.code, 0);
  assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+$/);
  const h = await run(["--help"]);
  for (const cmd of ["audit", "geo", "llms", "links", "fix", "rules", "mcp"]) assert.match(h.stdout, new RegExp(`\\b${cmd}\\b`));
});

test("audit --json finds the real issues on the fixture", async () => {
  const { code, stdout } = await run(["audit", base, "--json", "--pages", "4"]);
  assert.equal(code, 0);
  const r = JSON.parse(stdout);
  assert.ok(r.pagesCrawled >= 3, "crawls the linked pages");
  assert.ok(r.overall > 0 && r.overall <= 100);
  const ids = r.issues.map((i) => i.ruleId);
  assert.ok(ids.includes("meta-description-missing"), "flags /blog's missing description");
  assert.ok(ids.includes("indexing-canonical-missing"), "flags /blog's missing canonical");
  assert.ok(typeof r.geo?.score === "number", "includes the GEO summary");
});

test("audit --fail-under exits 1 below the threshold", async () => {
  const { code } = await run(["audit", base, "--json", "--pages", "2", "--fail-under", "101"]);
  assert.equal(code, 1);
});

test("audit --html writes a self-contained report", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "rf-")), "report.html");
  const { code } = await run(["audit", base, "--pages", "3", "--html", out]);
  assert.equal(code, 0);
  const html = readFileSync(out, "utf8");
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /AI search readiness/);
  assert.doesNotMatch(html, /<script/i, "no scripts in the report");
});

test("geo detects blocked AI crawlers, split search vs training", async () => {
  const { code, stdout } = await run(["geo", base, "--json", "--pages", "3"]);
  assert.equal(code, 0);
  const g = JSON.parse(stdout);
  const bot = (n) => g.bots.find((b) => b.bot === n);
  assert.equal(bot("GPTBot").allowed, false);
  assert.equal(bot("PerplexityBot").allowed, false);
  assert.equal(bot("ClaudeBot").allowed, true);
  assert.equal(bot("OAI-SearchBot").allowed, true);
  const search = g.checks.find((c) => c.id === "geo-ai-search-bots");
  assert.equal(search.status, "fail", "blocking a search bot fails access");
  assert.match(search.detail, /PerplexityBot/);
  const training = g.checks.find((c) => c.id === "geo-ai-training-bots");
  assert.equal(training.status, "warn", "blocking training is a choice, never a fail");
  assert.equal(g.checks.find((c) => c.id === "geo-llms-txt").status, "warn");
  assert.equal(g.checks.find((c) => c.id === "geo-question-headings").status, "pass");
});

test("llms generates a valid llms.txt", async () => {
  const { code, stdout } = await run(["llms", base, "--pages", "4"]);
  assert.equal(code, 0);
  assert.match(stdout, /^# Acme/m, "H1 site name without the suffix");
  assert.match(stdout, /^> Acme builds durable widgets/m, "blockquote summary");
  assert.match(stdout, /^- \[Pricing\]\(http:\/\/127\.0\.0\.1:\d+\/pricing\): Acme widget pricing/m);
});

test("links reports suggestions and authority", async () => {
  const { code, stdout } = await run(["links", base, "--json", "--pages", "4"]);
  assert.equal(code, 0);
  const l = JSON.parse(stdout);
  assert.ok(Array.isArray(l.suggestions));
  assert.ok(l.authority.length > 0);
});

test("fix prints a framework-idiomatic diff", async () => {
  const next = await run(["fix", "framework-robots-missing", "--framework", "nextjs"]);
  assert.equal(next.code, 0);
  assert.match(next.stdout, /app\/robots\.ts/);
  const svelte = await run(["fix", "framework-robots-missing", "--framework", "sveltekit"]);
  assert.match(svelte.stdout, /static\/robots\.txt/);
  const bad = await run(["fix", "not-a-rule"]);
  assert.notEqual(bad.code, 0);
});

test("rules lists the catalog", async () => {
  const { code, stdout } = await run(["rules", "--json"]);
  assert.equal(code, 0);
  assert.ok(JSON.parse(stdout).length >= 10);
});

test("bad input fails cleanly, no stack trace", async () => {
  const r = await run(["audit"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Missing <url>/);
  assert.doesNotMatch(r.stderr, /at .*\.js:\d+/);
});

test("mcp: stdio server speaks JSON-RPC and runs tools", async () => {
  const msgs = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "geo_audit", arguments: { url: base, maxPages: 2 } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } },
  ];
  const child = spawn(process.execPath, [CLI, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  const replies = new Map();
  let buf = "";
  const done = new Promise((resolve) => {
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line); // stdout must carry ONLY protocol JSON
        replies.set(m.id, m);
        if (replies.size === 4) resolve();
      }
    });
  });
  for (const m of msgs) child.stdin.write(JSON.stringify(m) + "\n");
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error("mcp timeout")), 30_000))]);
  child.kill();

  assert.equal(replies.get(1).result.serverInfo.name, "rankforge");
  const tools = replies.get(2).result.tools.map((t) => t.name);
  for (const t of ["audit_site", "audit_page", "geo_audit", "generate_llms_txt", "get_fix_template", "seo_docs", "list_rules"]) {
    assert.ok(tools.includes(t), `tool ${t}`);
  }
  const geo = JSON.parse(replies.get(3).result.content[0].text);
  assert.ok(typeof geo.score === "number");
  assert.equal(replies.get(4).error.code, -32602);
});

test("package bin resolves the built file", () => {
  const pkg = JSON.parse(readFileSync(join(dirname(CLI), "..", "package.json"), "utf8"));
  assert.equal(pkg.bin.rankforge, "dist/index.js", "npm normalizes ./ away; keep it canonical");
  const r = spawnSync(process.execPath, [CLI, "--version"], { encoding: "utf8" });
  assert.equal(r.stdout.trim(), pkg.version, "CLI version matches package.json");
});
