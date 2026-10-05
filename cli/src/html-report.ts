import type { EngineIssue } from "@/lib/audit/engine";
import type { GeoReport } from "@/lib/audit/geo";

/**
 * `--html report.html` — a single self-contained file (no external assets, no
 * scripts) you can attach to a PR, email to a client, or open offline. Light
 * and dark aware.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const tone = (n: number) => (n >= 80 ? "good" : n >= 60 ? "ok" : "bad");

export function renderHtmlReport(r: {
  url: string;
  pages: number;
  elapsed: string;
  overall: number;
  scores: Record<string, number>;
  issues: EngineIssue[];
  geo: GeoReport;
  fixable: string[];
  version: string;
}): string {
  const date = new Date().toISOString().slice(0, 10);
  const cats = Object.entries(r.scores)
    .map(
      ([k, v]) =>
        `<div class="cat"><span>${esc(k)}</span><span class="bar"><i class="${tone(v)}" style="width:${v}%"></i></span><b class="${tone(v)}">${v}</b></div>`,
    )
    .join("");
  const issues = r.issues
    .map((i) => {
      const urls = i.affectedUrls.slice(0, 8).map((u) => `<code>${esc(u.url)}</code>`).join(" ");
      const patch = r.fixable.includes(i.ruleId)
        ? `<span class="tag patch">patch: rankforge fix ${esc(i.ruleId)}</span>`
        : "";
      return `<li><div class="row"><span class="tag ${i.impact}">${i.impact}</span><strong>${esc(i.title)}</strong><span class="muted">(${i.affectedUrls.length})</span>${patch}</div><p>${esc(i.evidence ?? "")}</p>${urls ? `<p class="urls">${urls}</p>` : ""}</li>`;
    })
    .join("");
  const geo = r.geo.checks
    .map(
      (c) =>
        `<li><div class="row"><span class="tag ${c.status === "pass" ? "pass" : c.status === "warn" ? "medium" : "high"}">${c.status}</span><strong>${esc(c.title)}</strong></div><p>${esc(c.detail)}</p>${c.fix ? `<pre>${esc(c.fix)}</pre>` : ""}</li>`,
    )
    .join("");
  const bots = r.geo.bots
    .map((b) => `<tr><td>${esc(b.bot)}</td><td class="muted">${esc(b.owner)}</td><td>${b.purpose}</td><td class="${b.allowed ? "good" : "bad"}">${b.allowed ? "allowed" : "blocked"}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SEO audit — ${esc(r.url)}</title>
<style>
:root{--bg:#f6f8fc;--card:#fff;--ink:#0e1220;--muted:#5a667e;--line:#e3e8f2;--good:#0f9e76;--ok:#b9760f;--bad:#d1384f;--accent:#3559d6}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d14;--card:#12141f;--ink:#eaeef7;--muted:#a2adc4;--line:#232a3b;--good:#34e0a1;--ok:#ffb454;--bad:#ff6b81;--accent:#708cff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 20px 60px}h1{font-size:26px;margin:0}h2{font-size:18px;margin:36px 0 12px}
.muted{color:var(--muted)}code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;white-space:pre-wrap}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
.hero{display:flex;gap:28px;flex-wrap:wrap;align-items:center}.big{font:600 56px/1 ui-monospace,Menlo,monospace}.big small{font-size:20px;color:var(--muted)}
.cats{flex:1;min-width:260px;display:grid;gap:6px}.cat{display:grid;grid-template-columns:130px 1fr 32px;gap:10px;align-items:center;font-size:13px}
.bar{height:6px;background:var(--line);border-radius:6px;overflow:hidden}.bar i{display:block;height:100%}
.bar i.good{background:var(--good)}.bar i.ok{background:var(--ok)}.bar i.bad{background:var(--bad)}b.good,.good{color:var(--good)}b.ok{color:var(--ok)}b.bad,.bad{color:var(--bad)}
ul{list-style:none;padding:0;margin:0}li{border-top:1px solid var(--line);padding:14px 0}li:first-child{border-top:0}li p{margin:4px 0;color:var(--muted)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tag{font:600 11px ui-monospace,monospace;text-transform:uppercase;padding:2px 6px;border-radius:5px;border:1px solid var(--line)}
.tag.critical,.tag.high{color:var(--bad)}.tag.medium{color:var(--ok)}.tag.low{color:var(--muted)}.tag.pass,.tag.patch{color:var(--good)}.urls code{margin-right:6px}
table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 4px;border-top:1px solid var(--line)}
footer{margin-top:40px;font-size:12px;color:var(--muted)}a{color:var(--accent)}
</style></head><body><main>
<h1>Technical SEO audit</h1>
<p class="muted">${esc(r.url)} · ${r.pages} pages · ${r.elapsed}s · ${date} · deterministic — every finding is measured</p>
<div class="card hero"><div><div class="muted">Overall score</div><div class="big ${tone(r.overall)}">${r.overall}<small>/100</small></div><div class="muted" style="margin-top:6px">AI-search readiness: <b class="${tone(r.geo.score)}">${r.geo.score}/100</b></div></div><div class="cats">${cats}</div></div>
<h2>Issues (${r.issues.length})</h2><div class="card"><ul>${issues || "<li>No issues detected.</li>"}</ul></div>
<h2>AI search readiness (GEO) — ${r.geo.score}/100</h2><div class="card"><ul>${geo}</ul></div>
<h2>AI crawler access (robots.txt)</h2><div class="card"><table>${bots}</table></div>
<footer>Generated by <a href="https://github.com/Barbudda/rankforge-cli">rankforge-cli</a> v${esc(r.version)}. RankForge measures the technical layer your code controls; it never promises ranking outcomes.</footer>
</main></body></html>
`;
}
