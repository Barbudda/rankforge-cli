// End-to-end tests for the v3 engine: sitemap-seeded crawl, robots.txt
// respect, X-Robots-Tag, hreflang, canonical targets, soft 404s, sitemap
// hygiene, snapshots, diff / watch regression gates, white-label reports.
// Zero dependencies: node:test + node:http against local fixture sites.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

/**
 * A small multilingual site with planted problems. `state.after` flips it to
 * a regressed version (noindex on /fr, Googlebot blocked, a page gone) so the
 * diff/watch gates have something real to catch. `preview: true` behaves like
 * a preview deployment: X-Robots-Tag noindex on every response.
 */
function makeSite({ preview = false } = {}) {
  const state = { after: false, base: "" };
  const page = (title, body, head = "") =>
    `<!doctype html><html lang="en"><head><title>${title}</title>
    <meta name="description" content="${title}: a page of the fixture site used by the RankForge tests.">
    <meta name="viewport" content="width=device-width, initial-scale=1">${head}</head><body>${body}</body></html>`;
  const alt = (lang, path) => `<link rel="alternate" hreflang="${lang}" href="${state.base}${path}">`;

  const routes = {
    "/": () =>
      page(
        "Fixture home",
        `<h1>Fixture home</h1><p>Welcome. We ship 12 widgets a day to 40 countries.</p>
         <a href="/fr">Français</a> <a href="/uk">UK</a> <a href="/headers">Headers</a>
         <a href="/canonical-broken">Moved</a> <a href="/gone">Old</a> <a href="/oops">Oops</a>
         <a href="/private/area">Private</a> <a href="/stable">Stable</a> <a href="/login">Log in</a>`,
        `<link rel="canonical" href="${state.base}/">${alt("en", "/")}${alt("fr", "/fr")}${alt("en-UK", "/uk")}`,
      ),
    "/fr": () =>
      page(
        "Accueil",
        `<h1>Accueil</h1><p>Bienvenue sur le site de test.</p><a href="/">English</a>`,
        `<link rel="canonical" href="${state.base}/fr">${alt("fr", "/fr")}${alt("en", "/")}` +
          (state.after ? `<meta name="robots" content="noindex">` : ""),
      ),
    "/uk": () => page("UK", `<h1>UK</h1><p>No hreflang here, so no return link.</p><a href="/">Home</a>`, `<link rel="canonical" href="${state.base}/uk">`),
    "/headers": () => page("Headers", `<h1>Headers</h1><p>Noindexed through the HTTP header only.</p>`),
    "/canonical-broken": () =>
      page("Moved", `<h1>Moved</h1><p>The canonical below points at a page that is gone.</p>`, `<link rel="canonical" href="${state.base}/gone">`),
    "/oops": () => page("Page not found", `<h1>Page not found</h1><p>Sorry.</p>`),
    "/orphan": () => page("Orphan", `<h1>Orphan</h1><p>Only the sitemap knows this page.</p><a href="/">Home</a>`, `<link rel="canonical" href="${state.base}/orphan">`),
    "/stable": () =>
      state.after ? null : page("Stable", `<h1>Stable</h1><p>Here before, gone after.</p>`, `<link rel="canonical" href="${state.base}/stable">`),
    "/private/area": () => page("Private", `<h1>Private</h1><p>robots.txt disallows this path.</p>`),
    // Deliberately noindexed, like most sign-in pages: a notice, not a critical.
    "/login": () => page("Log in", `<h1>Log in</h1><form><input name="email"></form>`, `<meta name="robots" content="noindex">`),
  };

  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const headers = { "content-type": "text/html; charset=utf-8" };
    if (preview) headers["x-robots-tag"] = "noindex";
    if (path === "/robots.txt") {
      const googlebot = state.after ? "User-agent: Googlebot\nDisallow: /\n\n" : "";
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(`${googlebot}User-agent: *\nDisallow: /private\n\nSitemap: ${state.base}/sitemap.xml\n`);
    }
    if (path === "/sitemap.xml") {
      const urls = ["/", "/fr", "/orphan", "/redirect-me", "/headers"].map((p) => `<url><loc>${state.base}${p}</loc></url>`);
      urls.push("<url><loc>http://elsewhere.example/page</loc></url>");
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
    }
    if (path === "/redirect-me") {
      res.writeHead(301, { location: "/" });
      return res.end();
    }
    const route = routes[path];
    const html = route ? route() : null;
    if (html) {
      if (path === "/headers") headers["x-robots-tag"] = "noindex, nofollow";
      res.writeHead(200, headers);
      return res.end(req.method === "HEAD" ? undefined : html);
    }
    res.writeHead(404, headers);
    res.end("<h1>Not found</h1>");
  });
  return { server, state };
}

let prod;
let preview;
let base;
let previewBase;

async function listen(site) {
  await new Promise((r) => site.server.listen(0, "127.0.0.1", r));
  site.state.base = `http://127.0.0.1:${site.server.address().port}`;
  return site.state.base;
}

before(async () => {
  prod = makeSite();
  preview = makeSite({ preview: true });
  base = await listen(prod);
  previewBase = await listen(preview);
});

after(() => {
  prod?.server.close();
  preview?.server.close();
});

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args, "--no-color"], {
      env: { ...process.env, NO_COLOR: "1", CRUX_API_KEY: "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const tmp = () => mkdtempSync(join(tmpdir(), "rf3-"));
const notesOf = (issue) => (issue?.affectedUrls ?? []).map((u) => `${u.url} ${u.note ?? ""}`).join(" | ");

test("v3 audit: sitemap seeding, robots.txt, header noindex, hreflang, canonicals, soft 404s", async () => {
  prod.state.after = false;
  const { code, stdout, stderr } = await run(["audit", base, "--json", "--pages", "30", "--no-probe"]);
  assert.equal(code, 0, stderr);
  const r = JSON.parse(stdout);
  const byId = Object.fromEntries(r.issues.map((i) => [i.ruleId, i]));

  // robots.txt: /private is disallowed for every bot, so RankForgeBot skips it.
  assert.ok(r.crawl.blockedByRobots.includes("/private/area"), "honours robots.txt Disallow");
  assert.equal(r.crawl.sitemapUrls, 6, "reads the sitemap declared in robots.txt");

  // The orphan is only in the sitemap: the crawl reaches it and calls it out.
  const orphans = byId["link-orphan-pages"];
  assert.ok(orphans, "flags orphan pages");
  assert.match(notesOf(orphans), /\/orphan .*listed in the sitemap/);

  // noindex sent only through the X-Robots-Tag header, on a page the sitemap
  // asks to index: critical.
  assert.match(notesOf(byId["indexing-noindex"]), /\/headers .*X-Robots-Tag.*listed in the sitemap/);
  // A noindexed sign-in page is a notice, and content rules skip it.
  assert.doesNotMatch(notesOf(byId["indexing-noindex"]), /\/login/);
  assert.match(notesOf(byId["indexing-noindex-utility"]), /\/login .*meta robots/);
  assert.equal(byId["indexing-noindex-utility"].impact, "low");
  for (const rule of ["indexing-canonical-missing", "structure-thin-content", "schema-missing"]) {
    assert.doesNotMatch(notesOf(byId[rule]), /\/login/, `${rule} skips noindexed pages`);
  }

  // hreflang: "en-UK" is invalid (GB), and /uk doesn't link back.
  const hl = notesOf(byId["indexing-hreflang-invalid"]);
  assert.match(hl, /"en-UK".*GB/);
  assert.match(hl, /no return link: \/uk/);

  // canonical -> a 404 page.
  assert.match(notesOf(byId["indexing-canonical-target-invalid"]), /\/canonical-broken .*HTTP 404/);

  // An error page served with 200.
  assert.match(notesOf(byId["indexing-soft-404"]), /\/oops/);

  // Sitemap hygiene: a redirect, a noindex page, and a URL on another host.
  const hygiene = notesOf(byId["indexing-sitemap-hygiene"]);
  assert.match(hygiene, /\/redirect-me .*redirects/);
  assert.match(hygiene, /\/headers .*noindex/);
  assert.match(hygiene, /elsewhere\.example/);
  assert.match(byId["indexing-sitemap-hygiene"].evidence, /on http:\/\/elsewhere\.example, not .*check the site URL/);

  // Unknown paths return 404 here, so the site-wide soft-404 rule stays quiet.
  assert.equal(byId["indexing-soft-404-site"], undefined);
});

test("v3 audit --save + diff catches the regressions (and fails the gate)", async () => {
  const dir = tmp();
  const snap = join(dir, "before.json");
  prod.state.after = false;
  const saved = await run(["audit", base, "--json", "--pages", "30", "--no-probe", "--save", snap]);
  assert.equal(saved.code, 0, saved.stderr);
  assert.ok(existsSync(snap));
  const s = JSON.parse(readFileSync(snap, "utf8"));
  assert.equal(s.v, 1);
  assert.ok(s.pages["/fr"], "snapshot keeps per-page state");

  prod.state.after = true; // noindex on /fr, Googlebot blocked, /stable gone
  const md = join(dir, "summary.md");
  const d = await run(["diff", snap, base, "--json", "--pages", "30", "--markdown", md]);
  prod.state.after = false;
  assert.equal(d.code, 1, "critical regressions fail the default gate");
  const diff = JSON.parse(d.stdout);
  const kinds = diff.changes.map((c) => c.kind);
  assert.ok(kinds.includes("noindex-added"), "noindex added on /fr");
  assert.ok(kinds.includes("googlebot-blocked"), "robots.txt now blocks Googlebot");
  assert.ok(kinds.includes("page-error"), "/stable now 404s");
  assert.equal(diff.level, "critical");
  assert.equal(diff.crossOrigin, false);
  assert.match(readFileSync(md, "utf8"), /RankForge · Critical/);
});

test("v3 watch: first run saves the baseline, an unchanged site passes", async () => {
  const dir = tmp();
  const baseline = join(dir, "nested", "baseline.json");
  prod.state.after = false;
  const first = await run(["watch", base, "--baseline", baseline, "--pages", "30", "--no-probe"]);
  assert.equal(first.code, 0, first.stderr);
  assert.ok(existsSync(baseline), "creates the baseline (and its folder)");
  const second = await run(["watch", base, "--baseline", baseline, "--pages", "30", "--no-probe", "--json"]);
  assert.equal(second.code, 0, second.stderr);
  const d = JSON.parse(second.stdout);
  assert.notEqual(d.level, "critical");
  assert.equal(d.changes.filter((c) => c.level === "critical").length, 0);
});

test("v3 diff production vs preview: environment differences don't fail the gate", async () => {
  prod.state.after = false;
  preview.state.after = false;
  const d = await run(["diff", base, previewBase, "--json", "--pages", "30", "--fail-on", "new"]);
  assert.equal(d.code, 0, `preview noindex headers must not count as regressions:\n${d.stdout.slice(0, 1500)}`);
  const diff = JSON.parse(d.stdout);
  assert.equal(diff.crossOrigin, true);
  assert.ok(diff.environment.length > 0, "reports them as environment differences");

  preview.state.after = true; // a real code change: meta noindex on /fr
  const bad = await run(["diff", base, previewBase, "--json", "--pages", "30"]);
  preview.state.after = false;
  assert.equal(bad.code, 1, "a meta noindex introduced by the code still fails");
  assert.ok(JSON.parse(bad.stdout).changes.some((c) => c.kind === "noindex-added" && c.path === "/fr"));
});

test("v3 white-label HTML report", async () => {
  const out = join(tmp(), "client.html");
  const { code } = await run(["audit", base, "--pages", "5", "--no-probe", "--html", out, "--brand", "Studio Lune", "--brand-color", "#ff7a2f"]);
  assert.equal(code, 0);
  const html = readFileSync(out, "utf8");
  assert.match(html, /Prepared by <strong>Studio Lune<\/strong>/);
  assert.match(html, /--accent:#ff7a2f/);
  assert.doesNotMatch(html, /rankforge/i, "no RankForge branding on a white-label report");
});

test("v3 vitals without a key explains how to get one (no network call)", async () => {
  const { code, stdout } = await run(["vitals", "https://example.com", "--json"]);
  assert.equal(code, 2);
  const r = JSON.parse(stdout);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-key");
  assert.match(r.message, /CRUX_API_KEY/);
});

test("v3 audit --markdown writes the summary the pull-request comment uses", async () => {
  prod.state.after = false;
  const md = join(tmp(), "report.md");
  const r = await run(["audit", base, "--pages", "30", "--no-probe", "--markdown", md]);
  assert.equal(r.code, 0, r.stderr);
  const text = readFileSync(md, "utf8");
  assert.match(text, /^### RankForge · SEO audit: \d+\/100 · \d+ critical/);
  assert.match(text, /\| \*\*critical\*\* \| Pages set to noindex \| 1 \|/);
});

test("v3 action: one pull-request comment, posted once and then updated in place", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const script = [join(here, "..", "..", "scripts", "public", "pr-comment.mjs"), join(here, "..", "pr-comment.mjs")].find((f) =>
    existsSync(f),
  );
  assert.ok(script, "pr-comment.mjs not found");

  // A fake GitHub API: lists, creates and edits issue comments.
  const calls = [];
  const comments = [];
  const gh = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization });
      const json = (code, data) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.method === "GET") return json(200, comments);
      const { body } = JSON.parse(raw);
      if (req.method === "POST") {
        comments.push({ id: 99, body });
        return json(201, comments[0]);
      }
      comments[0].body = body;
      return json(200, comments[0]);
    });
  });
  await new Promise((r) => gh.listen(0, "127.0.0.1", r));
  const dir = tmp();
  const event = join(dir, "event.json");
  const report = join(dir, "report.md");
  writeFileSync(event, JSON.stringify({ pull_request: { number: 7 } }));
  const env = {
    ...process.env,
    GITHUB_API_URL: `http://127.0.0.1:${gh.address().port}`,
    GITHUB_EVENT_PATH: event,
    GITHUB_REPOSITORY: "acme/site",
    RF_GITHUB_TOKEN: "t0k",
  };
  const node = (args, extra = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [script, ...args], { env: { ...env, ...extra } });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
    });
  try {
    writeFileSync(report, "### RankForge · Critical: 1 critical change: /pricing became noindex (robots meta tag)\n");
    const first = await node([report]);
    assert.equal(first.code, 0, first.out);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`), [
      "GET /repos/acme/site/issues/7/comments",
      "POST /repos/acme/site/issues/7/comments",
    ]);
    assert.equal(calls[1].auth, "Bearer t0k");
    assert.match(comments[0].body, /^<!-- rankforge-check -->\n### RankForge · Critical/);

    // The next push edits the same comment instead of adding one.
    writeFileSync(report, "### RankForge · OK: No SEO regressions · score 91 (+0)\n");
    const second = await node([report]);
    assert.equal(second.code, 0, second.out);
    assert.equal(calls.at(-1).method, "PATCH");
    assert.equal(calls.at(-1).url, "/repos/acme/site/issues/comments/99");
    assert.equal(comments.length, 1);
    assert.match(comments[0].body, /No SEO regressions/);

    // Outside a pull request: no call at all, and no failure.
    const before = calls.length;
    writeFileSync(event, JSON.stringify({ ref: "refs/heads/main" }));
    const push = await node([report]);
    assert.equal(push.code, 0);
    assert.match(push.out, /not a pull request/);
    assert.equal(calls.length, before);
  } finally {
    gh.close();
  }
});
