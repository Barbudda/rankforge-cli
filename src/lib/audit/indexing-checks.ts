import type { CrawledPage } from "./types";
import type { EngineIssue, SiteFilesInput } from "./engine";
import { botAllowed } from "./geo";
import { isNoindex } from "./robots-directives";

/**
 * Indexing checks that need more than one page at a time: hreflang clusters,
 * sitemap hygiene, canonical targets, soft 404s, robots.txt availability and
 * the HTTPS certificate. Every finding is computed from crawled data and the
 * probed site files; nothing is inferred by a model.
 *
 * House rule (see the engine's adversarial review): only report what was
 * actually observed. A target that wasn't crawled is not "broken", it's
 * unchecked, and the evidence says so.
 */

export interface IndexingCheckInput {
  pages: CrawledPage[];
  startUrl: string;
  siteFiles?: SiteFilesInput;
  /** Display form of a URL (same-origin path, else the full URL). */
  norm: (u: string) => string;
  hints: { page: string; layout: string; sitemap: string; robots: string; config: string };
}

// ISO 639-1 language codes (hreflang language part).
const ISO_639_1 = new Set(
  ("aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu").split(" "),
);
// ISO 3166-1 alpha-2 region codes (hreflang region part).
const ISO_3166_1 = new Set(
  ("ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw").split(" "),
);

/**
 * Why an hreflang value is invalid for Google, or null when it's fine.
 * Format: ISO 639-1 language, optional ISO 15924 script, optional ISO 3166-1
 * alpha-2 region, or "x-default".
 */
export function hreflangCodeProblem(code: string): string | null {
  const c = code.trim().toLowerCase();
  if (c === "x-default") return null;
  if (c.includes("_")) return `uses "_" instead of "-" (write ${c.replace(/_/g, "-")})`;
  const m = c.match(/^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z0-9]{2,3}))?$/);
  if (!m) return "isn't a language[-script][-region] code";
  const [, lang, , region] = m;
  if (!ISO_639_1.has(lang!)) {
    if (ISO_3166_1.has(lang!) && !region) return `"${lang}" is a country, not a language: hreflang needs a language first (e.g. "en-${lang}")`;
    return `"${lang}" isn't an ISO 639-1 language code`;
  }
  if (region) {
    if (region === "uk") return 'uses "UK", which Google ignores: the region code for the United Kingdom is "GB"';
    if (/^\d+$/.test(region)) return `uses the numeric region "${region}": Google supports ISO 3166-1 alpha-2 regions only`;
    if (!ISO_3166_1.has(region)) return `"${region}" isn't an ISO 3166-1 alpha-2 region code`;
  }
  return null;
}

/** Comparable identity of a page URL: origin + path, no trailing slash, no query/hash. */
function pageKey(u: string, base?: string): string | null {
  try {
    const x = new URL(u, base);
    const path = x.pathname.replace(/\/+$/, "") || "/";
    return `${x.protocol}//${x.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

function absolute(u: string, base: string): string | null {
  try {
    return new URL(u, base).toString();
  } catch {
    return null;
  }
}

/** First 4 notes per URL, then a count, so one page can't flood the report. */
function joinNotes(notes: string[]): string {
  const shown = notes.slice(0, 4).join("; ");
  return notes.length > 4 ? `${shown}; +${notes.length - 4} more` : shown;
}

const SOFT_404_RE =
  /(^|[\s|:–-])404([\s|:–-]|$)|\bpage (?:was )?not found\b|\b(?:could not|can['’]?t|cannot) be found\b|^\s*not found\s*$|page introuvable|page non trouv[ée]e|seite nicht gefunden|p[áa]gina no encontrada|pagina non trovata|pagina niet gevonden/i;

export function runIndexingChecks(input: IndexingCheckInput): EngineIssue[] {
  const { pages, startUrl, siteFiles, norm, hints } = input;
  const issues: EngineIssue[] = [];
  const push = (i: EngineIssue) => {
    if (i.affectedUrls.length > 0) issues.push(i);
  };

  const ok = pages.filter((p) => p.statusCode >= 200 && p.statusCode < 300);
  // The site's real origin is where the start page landed (http→https, www…).
  const siteOrigin = (() => {
    try {
      return new URL(pages[0]?.url ?? startUrl).origin;
    } catch {
      return "";
    }
  })();

  // Page lookup by identity; a requested URL that redirected maps to its
  // landing page, flagged as a redirect.
  const index = new Map<string, { page: CrawledPage; viaRedirect: boolean }>();
  for (const p of pages) {
    const k = pageKey(p.url);
    if (k && !index.has(k)) index.set(k, { page: p, viaRedirect: false });
  }
  for (const p of pages) {
    for (const from of [p.requestedUrl, ...(p.redirectedFrom ?? [])]) {
      if (!from) continue;
      const k = pageKey(from);
      if (k && !index.has(k)) index.set(k, { page: p, viaRedirect: true });
    }
  }
  const lookup = (u: string) => {
    const k = pageKey(u);
    return k ? index.get(k) : undefined;
  };
  const samePage = (a: string, b: string) => {
    const ka = pageKey(a);
    return ka !== null && ka === pageKey(b);
  };
  const canonicalElsewhere = (p: CrawledPage): string | null => {
    if (!p.canonical) return null;
    const abs = absolute(p.canonical, p.url);
    return abs && !samePage(abs, p.url) ? abs : null;
  };
  const indexable = (p: CrawledPage) =>
    p.statusCode >= 200 && p.statusCode < 300 && !isNoindex(p) && !canonicalElsewhere(p);

  // ══ robots.txt availability & Googlebot access ═════════════════════
  const robots = siteFiles?.robotsTxt ?? "";
  const robotsStatus = siteFiles?.robotsStatus;
  if (robotsStatus !== undefined && (robotsStatus >= 500 || robotsStatus === 429)) {
    push({
      ruleId: "indexing-robots-unavailable",
      category: "indexing",
      title: "robots.txt is failing (server error)",
      description:
        "Your robots.txt answers with a server error. Google then stops crawling the whole site for up to 12 hours, and keeps using an old copy for up to 30 days. Make robots.txt return 200 (or 404 if you have none).",
      impact: "critical",
      effort: "low",
      risk: "low",
      confidence: 95,
      evidence: `GET /robots.txt returned HTTP ${robotsStatus}.`,
      affectedUrls: [{ url: "/robots.txt", note: `HTTP ${robotsStatus}` }],
      files: [{ path: hints.robots, reason: "Serve robots.txt as a static file or a route that can't fail.", confidence: 60 }],
      canAutoFix: false,
    });
  }
  if (siteFiles?.robotsIsHtml) {
    push({
      ruleId: "indexing-robots-html",
      category: "indexing",
      title: "robots.txt is an HTML page",
      description:
        "Requesting /robots.txt returns your HTML app (a single-page-app fallback), so crawlers find no rules and no Sitemap line. Serve a real text file.",
      impact: "medium",
      effort: "low",
      risk: "low",
      confidence: 90,
      evidence: "GET /robots.txt answered 200 with Content-Type text/html.",
      affectedUrls: [{ url: "/robots.txt", note: "served as text/html" }],
      files: [{ path: hints.robots, reason: "Add a robots file so the router stops serving the app shell.", confidence: 65 }],
      canAutoFix: true,
    });
  }
  if (robots && !botAllowed(robots, "Googlebot", "/")) {
    push({
      ruleId: "indexing-robots-blocks-google",
      category: "indexing",
      title: "robots.txt blocks Googlebot from the whole site",
      description:
        "robots.txt disallows the site root for Googlebot. Google can't crawl your pages, and that also keeps you out of AI Overviews and AI Mode. This is the classic staging rule that ships to production.",
      impact: "critical",
      effort: "low",
      risk: "low",
      confidence: 95,
      evidence: "Googlebot (or its * fallback group) has a Disallow rule matching /.",
      affectedUrls: [{ url: "/robots.txt", note: "Disallow: / for Googlebot" }],
      files: [{ path: hints.robots, reason: "Remove the site-wide Disallow for production.", confidence: 70 }],
      canAutoFix: false,
    });
  } else if (robots) {
    const blocked = ok.filter((p) => {
      try {
        const u = new URL(p.url);
        return !botAllowed(robots, "Googlebot", u.pathname + u.search) && !isNoindex(p);
      } catch {
        return false;
      }
    });
    push({
      ruleId: "indexing-robots-blocks-pages",
      category: "indexing",
      title: "Pages Googlebot isn't allowed to crawl",
      description:
        "These pages are reachable and linked, but robots.txt disallows them for Googlebot, so Google can't read them (it may still list the bare URL). If they should rank, remove the Disallow rule; if they shouldn't, a noindex is the reliable way, and it requires the page to be crawlable.",
      impact: "high",
      effort: "low",
      risk: "medium",
      confidence: 85,
      evidence: `${blocked.length} crawled page(s) match a Disallow rule for Googlebot.`,
      affectedUrls: blocked.map((p) => ({ url: norm(p.url) })),
      files: [{ path: hints.robots, reason: "Narrow the Disallow rule.", confidence: 60 }],
      canAutoFix: false,
    });
  }

  // ══ Missing pages must return 404 ═════════════════════════════════
  if (siteFiles?.notFoundStatus !== undefined && siteFiles.notFoundStatus >= 200 && siteFiles.notFoundStatus < 300) {
    push({
      ruleId: "indexing-soft-404-site",
      category: "indexing",
      title: "Missing pages return 200 instead of 404",
      description:
        "A URL that doesn't exist answers with HTTP 200 and a normal page. Google reports these as soft 404s, wastes crawl budget on them, and every mistyped or removed link becomes a duplicate page. Return a real 404 status for unknown routes.",
      impact: "high",
      effort: "low",
      risk: "low",
      confidence: 90,
      evidence:
        `GET ${siteFiles.notFoundProbe ?? "a random non-existent path"} returned HTTP ${siteFiles.notFoundStatus}` +
        (siteFiles.notFoundLandedOn ? ` after redirecting to ${norm(siteFiles.notFoundLandedOn)}.` : "."),
      affectedUrls: [
        {
          url: siteFiles.notFoundProbe ?? "/",
          note: siteFiles.notFoundLandedOn
            ? `redirects to ${norm(siteFiles.notFoundLandedOn)} instead of returning 404`
            : `HTTP ${siteFiles.notFoundStatus} for a page that doesn't exist`,
        },
      ],
      files: [{ path: hints.config, reason: "Make the catch-all / fallback route respond with status 404.", confidence: 45 }],
      canAutoFix: false,
    });
  }

  const soft404 = ok.filter(
    (p) => p.wordCount < 250 && (SOFT_404_RE.test(p.title ?? "") || SOFT_404_RE.test(p.h1s[0] ?? "")),
  );
  push({
    ruleId: "indexing-soft-404",
    category: "indexing",
    title: "Error pages served with HTTP 200 (soft 404)",
    description:
      "These pages look like error pages (\"not found\" title or heading, little content) but answer HTTP 200. Search engines treat them as soft 404s. Return a 404 or 410 status, or redirect to the right page.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 70,
    evidence: `${soft404.length} page(s) read like an error page but return 200.`,
    affectedUrls: soft404.map((p) => ({ url: norm(p.url), note: (p.h1s[0] ?? p.title ?? "").slice(0, 60) })),
    files: [{ path: hints.page, reason: "The not-found route must set the 404 status.", confidence: 40 }],
    canAutoFix: false,
  });

  // ══ Canonical targets ═════════════════════════════════════════════
  const badCanonical: { url: string; note: string }[] = [];
  for (const p of ok) {
    const target = canonicalElsewhere(p);
    if (!target) continue;
    const hit = lookup(target);
    if (!hit) continue; // not crawled: unchecked, not broken
    const t = hit.page;
    if (t.statusCode >= 400) badCanonical.push({ url: norm(p.url), note: `canonical ${norm(target)} returns HTTP ${t.statusCode}` });
    else if (hit.viaRedirect) badCanonical.push({ url: norm(p.url), note: `canonical ${norm(target)} redirects to ${norm(t.url)}` });
    else if (isNoindex(t)) badCanonical.push({ url: norm(p.url), note: `canonical ${norm(target)} is noindex` });
  }
  push({
    ruleId: "indexing-canonical-target-invalid",
    category: "indexing",
    title: "Canonical points to a page that can't be indexed",
    description:
      "These pages declare a canonical URL that is broken, redirects, or is noindex. Google then ignores the canonical and picks one itself, or drops the page. Point the canonical at the final, indexable URL.",
    impact: "high",
    effort: "low",
    risk: "low",
    confidence: 90,
    evidence: `${badCanonical.length} canonical tag(s) point at a URL that isn't indexable.`,
    affectedUrls: badCanonical,
    files: [{ path: hints.layout, reason: "Where the canonical tag / metadataBase is set.", confidence: 50 }],
    canAutoFix: false,
  });

  // ══ hreflang clusters ═════════════════════════════════════════════
  const hreflangIssues: { url: string; note: string }[] = [];
  let unchecked = 0;
  for (const p of ok) {
    if (p.hreflang.length === 0) continue;
    const notes: string[] = [];
    const entries = p.hreflang.map((h) => ({ lang: h.lang.trim(), href: h.href.trim(), abs: absolute(h.href.trim(), p.url) }));
    for (const e of entries) {
      const problem = hreflangCodeProblem(e.lang);
      if (problem) notes.push(`"${e.lang}" ${problem}`);
      if (!/^https?:\/\//i.test(e.href)) notes.push(`"${e.lang}" uses a relative URL (${e.href}); hreflang URLs must be fully qualified`);
    }
    if (!entries.some((e) => e.abs && samePage(e.abs, p.url))) {
      notes.push("doesn't list itself: every language version must include its own hreflang");
    }
    const byLang = new Map<string, Set<string>>();
    for (const e of entries) {
      const k = e.lang.toLowerCase();
      const key = e.abs ? pageKey(e.abs) : e.href;
      if (!byLang.has(k)) byLang.set(k, new Set());
      byLang.get(k)!.add(key ?? e.href);
    }
    for (const [lang, urls] of byLang) {
      if (urls.size > 1) notes.push(`"${lang}" is declared for ${urls.size} different URLs`);
    }
    for (const e of entries) {
      if (!e.abs || samePage(e.abs, p.url)) continue;
      const hit = lookup(e.abs);
      if (!hit) {
        unchecked++;
        continue;
      }
      const t = hit.page;
      if (t.statusCode >= 400) notes.push(`"${e.lang}" → ${norm(e.abs)} returns HTTP ${t.statusCode}`);
      else if (hit.viaRedirect) notes.push(`"${e.lang}" → ${norm(e.abs)} redirects to ${norm(t.url)}`);
      else if (isNoindex(t)) notes.push(`"${e.lang}" → ${norm(e.abs)} is noindex`);
      else if (!t.hreflang.some((x) => {
        const back = absolute(x.href, t.url);
        return back !== null && samePage(back, p.url);
      })) notes.push(`no return link: ${norm(e.abs)} doesn't point back to this page`);
    }
    if (notes.length) hreflangIssues.push({ url: norm(p.url), note: joinNotes(notes) });
  }
  push({
    ruleId: "indexing-hreflang-invalid",
    category: "indexing",
    title: "hreflang annotations Google will ignore",
    description:
      "Google drops hreflang annotations that aren't reciprocal, don't include the page itself, use invalid language or region codes, use relative URLs, or point at broken, redirected or noindex pages. Fix the cluster so each language version lists all versions, itself included.",
    impact: "high",
    effort: "medium",
    risk: "low",
    confidence: 85,
    evidence:
      `${hreflangIssues.length} page(s) have hreflang errors.` +
      (unchecked ? ` ${unchecked} alternate URL(s) weren't crawled (other host or beyond the page limit) and weren't checked.` : ""),
    affectedUrls: hreflangIssues,
    files: [{ path: hints.layout, reason: "Where alternates / hreflang links are generated.", confidence: 50 }],
    canAutoFix: false,
  });

  // ══ Sitemap hygiene ═══════════════════════════════════════════════
  const sitemapUrls = siteFiles?.sitemapUrls ?? [];
  if (sitemapUrls.length) {
    const hygiene: { url: string; note: string }[] = [];
    const offHost = new Map<string, number>();
    let checked = 0;
    for (const u of sitemapUrls) {
      let origin = "";
      try {
        origin = new URL(u).origin;
      } catch {
        hygiene.push({ url: u, note: "isn't an absolute URL" });
        continue;
      }
      if (siteOrigin && origin !== siteOrigin) {
        offHost.set(origin, (offHost.get(origin) ?? 0) + 1);
        hygiene.push({ url: u, note: `listed on ${origin}, but the site lives on ${siteOrigin}` });
        continue;
      }
      const hit = lookup(u);
      if (!hit) continue;
      checked++;
      const t = hit.page;
      if (t.statusCode >= 400) hygiene.push({ url: norm(u), note: `returns HTTP ${t.statusCode}` });
      else if (hit.viaRedirect) hygiene.push({ url: norm(u), note: `redirects to ${norm(t.url)}` });
      else if (isNoindex(t)) hygiene.push({ url: norm(u), note: "is noindex" });
      else {
        const c = canonicalElsewhere(t);
        if (c) hygiene.push({ url: norm(u), note: `canonicalises to ${norm(c)}` });
      }
    }
    // Entries on another host usually mean the sitemap (or the robots.txt
    // line pointing to it) is generated from the wrong site URL, e.g. an
    // environment variable left at production or at localhost.
    const offHostCount = [...offHost.values()].reduce((a, b) => a + b, 0);
    const foreignFile = (siteFiles?.sitemapFiles ?? []).find((f) => {
      try {
        return new URL(f).origin !== siteOrigin;
      } catch {
        return false;
      }
    });
    const offHostText = offHostCount
      ? ` ${offHostCount} of them are on ${[...offHost.keys()].slice(0, 2).join(", ")}, not ${siteOrigin}` +
        (foreignFile ? `, and the sitemap itself was read from another host (${foreignFile})` : "") +
        ": check the site URL your sitemap and robots.txt are generated from."
      : "";
    push({
      ruleId: "indexing-sitemap-hygiene",
      category: "indexing",
      title: "Sitemap lists URLs that shouldn't be indexed",
      description:
        "A sitemap should list only final, indexable URLs on your canonical origin. Entries that redirect, error, are noindex, canonicalise elsewhere or sit on another host make search engines trust the sitemap less.",
      impact: "medium",
      effort: "low",
      risk: "low",
      confidence: 90,
      evidence: `${hygiene.length} problem entr${hygiene.length === 1 ? "y" : "ies"} (${checked} of ${sitemapUrls.length} listed URLs were crawled and checked).${offHostText}`,
      affectedUrls: hygiene,
      files: [{ path: hints.sitemap, reason: "Generate the sitemap from indexable routes only.", confidence: 65 }],
      canAutoFix: false,
    });

    if (!siteFiles?.sitemapTruncated) {
      const listed = new Set(sitemapUrls.map((u) => pageKey(u)).filter((k): k is string => k !== null));
      const missing = ok.filter((p) => {
        if (p.discoveredVia === "sitemap" || !indexable(p)) return false;
        const k = pageKey(p.url);
        return k !== null && !listed.has(k);
      });
      push({
        ruleId: "indexing-sitemap-gaps",
        category: "indexing",
        title: "Indexable pages missing from the sitemap",
        description:
          "These pages are linked and indexable but not listed in your sitemap, so search engines learn about them later, and only through links.",
        impact: "low",
        effort: "low",
        risk: "low",
        confidence: 80,
        evidence: `${missing.length} crawled indexable page(s) aren't in the sitemap (${sitemapUrls.length} URLs listed).`,
        affectedUrls: missing.map((p) => ({ url: norm(p.url) })),
        files: [{ path: hints.sitemap, reason: "Include every indexable route.", confidence: 60 }],
        canAutoFix: false,
      });
    }
  }

  // ══ HTTPS certificate ═════════════════════════════════════════════
  const tls = siteFiles?.tls;
  if (tls) {
    const expired = tls.daysLeft < 0;
    const untrusted = tls.error && !expired;
    if (expired || untrusted || tls.daysLeft <= 14) {
      push({
        ruleId: "indexing-https-certificate",
        category: "indexing",
        title: expired
          ? "HTTPS certificate has expired"
          : untrusted
            ? "HTTPS certificate isn't trusted"
            : `HTTPS certificate expires in ${tls.daysLeft} day${tls.daysLeft === 1 ? "" : "s"}`,
        description: expired || untrusted
          ? "Browsers show a security warning instead of your site, and search engines can't fetch it reliably. Renew or fix the certificate now."
          : "Certificates that auto-renew usually do so around 30 days before expiry, so one this close to expiring suggests renewal is failing. Check your host's certificate settings.",
        impact: expired || untrusted ? "critical" : "high",
        effort: "low",
        risk: "low",
        confidence: 95,
        evidence: `${tls.host}: valid until ${tls.validTo.slice(0, 10)}${tls.issuer ? `, issued by ${tls.issuer}` : ""}${tls.error ? ` (${tls.error})` : ""}.`,
        affectedUrls: [{ url: `https://${tls.host}/`, note: expired ? `expired ${-tls.daysLeft} day(s) ago` : tls.error ?? `${tls.daysLeft} day(s) left` }],
        files: [{ path: "-", reason: "Certificates are managed by the host or CDN, not the repo.", confidence: 20 }],
        canAutoFix: false,
      });
    }
  }

  // ══ One site, one address: www / bare, http / https ═══════════════
  const site = (() => {
    try {
      return new URL(siteOrigin);
    } catch {
      return null;
    }
  })();
  for (const v of siteFiles?.hostVariants ?? []) {
    // A spelling that doesn't resolve or errors duplicates nothing.
    if (!site || v.status < 200 || v.status >= 300) continue;
    let landed: URL;
    try {
      landed = new URL(v.finalUrl || v.url);
    } catch {
      continue;
    }
    const canonicalHome = (() => {
      try {
        return v.canonical ? new URL(v.canonical, landed).host === site.host : false;
      } catch {
        return false;
      }
    })();
    if (v.kind === "host" && landed.hostname !== site.hostname && !canonicalHome) {
      push({
        ruleId: "indexing-host-duplicate",
        category: "indexing",
        title: `${landed.hostname} and ${site.hostname} both serve the site`,
        description:
          "Your homepage answers on both spellings of the domain without one redirecting to the other, so search engines can index two copies and split their signals between them. Redirect the spare spelling to the real one with a permanent (301 or 308) redirect.",
        impact: "high",
        effort: "low",
        risk: "low",
        confidence: 90,
        evidence: `GET ${v.url} answered ${v.status} on ${landed.host}, with no redirect to ${site.host}${v.canonical ? ` (canonical: ${v.canonical})` : " and no canonical"}.`,
        affectedUrls: [{ url: v.url, note: `serves the site instead of redirecting to ${site.host}` }],
        files: [{ path: "-", reason: "Domain redirects live in the host's domain settings (Vercel, Netlify, Cloudflare…).", confidence: 40 }],
        canAutoFix: false,
      });
    }
    if (v.kind === "http" && landed.protocol === "http:" && !canonicalHome) {
      push({
        ruleId: "indexing-http-not-redirected",
        category: "indexing",
        title: "The http:// version doesn't redirect to https://",
        description:
          "Your homepage still answers over plain HTTP instead of redirecting to HTTPS. Visitors who type the address land on an unencrypted page, and search engines may index both versions. Redirect every http:// URL to its https:// twin.",
        impact: "high",
        effort: "low",
        risk: "low",
        confidence: 90,
        evidence: `GET ${v.url} answered ${v.status} over HTTP (landed on ${landed.href}).`,
        affectedUrls: [{ url: v.url, note: "served over HTTP" }],
        files: [{ path: "-", reason: "Force HTTPS in the host's settings, or with a redirect rule in front of the app.", confidence: 40 }],
        canAutoFix: false,
      });
    }
  }

  // ══ robots.txt lines crawlers can't read ══════════════════════════
  if (robots) {
    const KNOWN = new Set(["user-agent", "allow", "disallow", "sitemap", "crawl-delay", "host", "clean-param", "request-rate", "visit-time"]);
    const bad: string[] = [];
    robots.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) return;
      const colon = line.indexOf(":");
      const name = colon > 0 ? line.slice(0, colon).trim().toLowerCase() : "";
      if (!name) bad.push(`line ${i + 1}: "${line.slice(0, 60)}" has no directive`);
      else if (name === "noindex") bad.push(`line ${i + 1}: Noindex isn't supported in robots.txt (Google ignores it since 2019)`);
      else if (!KNOWN.has(name)) bad.push(`line ${i + 1}: unknown directive "${line.slice(0, colon).trim()}"`);
    });
    if (bad.length) {
      push({
        ruleId: "indexing-robots-format",
        category: "indexing",
        title: "robots.txt has lines crawlers can't read",
        description:
          "Crawlers skip any robots.txt line they don't understand, so a misspelled Disallow simply isn't applied and the page stays crawlable. Fix or remove these lines.",
        impact: "medium",
        effort: "low",
        risk: "low",
        confidence: 90,
        evidence: `${bad.length} unreadable line${bad.length === 1 ? "" : "s"}: ${joinNotes(bad.slice(0, 3))}.`,
        affectedUrls: [{ url: "/robots.txt", note: bad.slice(0, 3).join("; ") }],
        files: [{ path: hints.robots, reason: "Correct the directive names (User-agent, Allow, Disallow, Sitemap).", confidence: 70 }],
        canAutoFix: false,
      });
    }
  }

  // ══ Head tags read once per page ══════════════════════════════════
  const headOf = (html: string) => {
    const end = html.search(/<\/head>/i);
    return end > 0 ? html.slice(0, end) : html.slice(0, 200_000);
  };

  const multiCanonical = ok
    .map((p) => {
      const tags = [...headOf(p.html).matchAll(/<link\b[^>]*\brel=["']?canonical\b[^>]*>/gi)].map((m) => m[0]);
      const hrefs = [...new Set(tags.map((t) => t.match(/\bhref=["']([^"']*)["']/i)?.[1] ?? ""))];
      return { p, count: tags.length, hrefs };
    })
    .filter((x) => x.count > 1);
  push({
    ruleId: "indexing-canonical-multiple",
    category: "indexing",
    title: "Pages with more than one canonical tag",
    description:
      "When a page declares several canonical URLs, Google ignores all of them and picks one itself. Keep exactly one canonical per page; two usually means a plugin or a layout adds its own next to the page's.",
    impact: "high",
    effort: "low",
    risk: "low",
    confidence: 95,
    evidence: `${multiCanonical.length} page${multiCanonical.length === 1 ? "" : "s"} declare more than one canonical.`,
    affectedUrls: multiCanonical.map(({ p, count, hrefs }) => ({
      url: norm(p.url),
      note: `${count} canonical tags${hrefs.length > 1 ? `: ${hrefs.slice(0, 3).join(", ")}` : " (same URL repeated)"}`,
    })),
    files: [{ path: hints.layout, reason: "Find where the second canonical comes from: a shared layout, a plugin or the page itself.", confidence: 55 }],
    canAutoFix: false,
  });

  const refreshes = ok
    .map((p) => ({ p, tag: headOf(p.html).match(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/i)?.[0] }))
    .filter((x): x is { p: CrawledPage; tag: string } => Boolean(x.tag));
  push({
    ruleId: "indexing-meta-refresh",
    category: "indexing",
    title: "Pages that redirect with a meta refresh",
    description:
      "A meta refresh reloads or redirects the page from the browser. Google may treat it as a redirect it can't trust, and it breaks the back button. Use a real 301 or 308 redirect from the server instead.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 95,
    evidence: `${refreshes.length} page${refreshes.length === 1 ? "" : "s"} carry <meta http-equiv="refresh">.`,
    affectedUrls: refreshes.map(({ p, tag }) => ({
      url: norm(p.url),
      note: tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? "refresh",
    })),
    files: [{ path: hints.config, reason: "Declare the redirect in the framework's redirects config.", confidence: 50 }],
    canAutoFix: false,
  });

  const noWidth = ok.filter((p) => p.viewport && !/\bwidth\s*=/i.test(p.viewport));
  push({
    ruleId: "perf-viewport-no-width",
    category: "performance",
    title: "Viewport meta without a width",
    description:
      "A viewport tag without width=device-width leaves phones rendering the page at desktop width, then shrinking it. Google's mobile-first indexing sees the zoomed-out version. Add width=device-width.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 95,
    evidence: `${noWidth.length} page${noWidth.length === 1 ? "" : "s"} have a viewport tag with no width.`,
    affectedUrls: noWidth.map((p) => ({ url: norm(p.url), note: `content="${p.viewport}"` })),
    files: [{ path: hints.layout, reason: 'Set content="width=device-width, initial-scale=1" in the root layout.', confidence: 65 }],
    canAutoFix: false,
  });

  // Links a browser may forgive but a crawler won't follow.
  const MALFORMED: [RegExp, string][] = [
    [/^https?:\/(?!\/)/i, "one slash after the scheme"],
    [/^https?\/\//i, "missing colon after http"],
    [/^(?:htp|htps|htt|hhtp|htttp|htttps|ttp|ttps):/i, "misspelled scheme"],
    [/\\/, "backslash in the URL"],
    [/^\S*\s+\S/, "space inside the URL"],
  ];
  const malformed = ok
    .map((p) => {
      const found = p.links
        .map((l) => l.href.trim())
        .filter((h) => h && !/^(mailto|tel|javascript|data|sms):/i.test(h) && !h.startsWith("#"))
        .map((h) => ({ h, why: MALFORMED.find(([re]) => re.test(h))?.[1] }))
        .filter((x): x is { h: string; why: string } => Boolean(x.why));
      return { p, found };
    })
    .filter((x) => x.found.length > 0);
  push({
    ruleId: "link-malformed",
    category: "internal-linking",
    title: "Links with a malformed URL",
    description:
      "These links have a typo in their URL (a missing colon or slash, a backslash, a space). Browsers sometimes guess what was meant, but crawlers don't, so the page behind the link isn't reached through it. Fix the href.",
    impact: "medium",
    effort: "low",
    risk: "low",
    confidence: 90,
    evidence: `${malformed.reduce((n, x) => n + x.found.length, 0)} malformed link${malformed.length === 1 && malformed[0]!.found.length === 1 ? "" : "s"} on ${malformed.length} page${malformed.length === 1 ? "" : "s"}.`,
    affectedUrls: malformed.map(({ p, found }) => ({
      url: norm(p.url),
      note: found.slice(0, 2).map((f) => `"${f.h.slice(0, 60)}" (${f.why})`).join(", "),
    })),
    files: [{ path: hints.page, reason: "Correct the href where the link is written.", confidence: 60 }],
    canAutoFix: false,
  });

  // ══ Sitemap files search engines can't read ═══════════════════════
  // A site with no sitemap at all is "framework-sitemap-missing"; this is about
  // sitemaps that are declared, or listed by an index, and still unreadable.
  const sitemapErrors = siteFiles?.sitemapErrors ?? [];
  if (sitemapErrors.length && (siteFiles?.hasSitemap || siteFiles?.robotsDeclaresSitemap)) {
    push({
      ruleId: "indexing-sitemap-format",
      category: "indexing",
      title: "Sitemap files that can't be read",
      description:
        "Search engines skip a sitemap they can't fetch or parse, so the pages only it lists may never be discovered. Each file must answer 200 with XML whose root is <urlset> or <sitemapindex>.",
      impact: "high",
      effort: "low",
      risk: "low",
      confidence: 90,
      evidence: `${sitemapErrors.length} sitemap file${sitemapErrors.length === 1 ? "" : "s"} couldn't be read: ${joinNotes(sitemapErrors.slice(0, 3).map((e) => `${norm(e.file)} (${e.reason})`))}.`,
      affectedUrls: sitemapErrors.slice(0, 20).map((e) => ({ url: norm(e.file), note: e.reason })),
      files: [{ path: hints.sitemap, reason: "Serve the sitemap from a route or static file that returns XML.", confidence: 60 }],
      canAutoFix: false,
    });
  }

  // ══ URL shape ═════════════════════════════════════════════════════
  const shaped = ok
    .filter(indexable)
    .map((p) => {
      let u: URL;
      try {
        u = new URL(p.url);
      } catch {
        return null;
      }
      const why: string[] = [];
      if (u.pathname.includes("_")) why.push("underscore in the path (Google reads it as joining words)");
      const params = [...u.searchParams.keys()].length;
      if (params > 2) why.push(`${params} query parameters`);
      if (p.url.length > 200) why.push(`${p.url.length} characters long`);
      return why.length ? { p, why } : null;
    })
    .filter((x): x is { p: CrawledPage; why: string[] } => x !== null);
  push({
    ruleId: "structure-url-format",
    category: "structure",
    title: "URLs that are hard to read or share",
    description:
      "Short, hyphenated URLs are easier for people to read and for search engines to split into words. Underscores join words together for Google, many query parameters create near-duplicate URLs, and very long URLs get cut off when shared. Change them only on new pages, or with a permanent redirect.",
    impact: "low",
    effort: "medium",
    risk: "medium",
    confidence: 85,
    evidence: `${shaped.length} indexable page${shaped.length === 1 ? "" : "s"} have a URL worth reshaping.`,
    affectedUrls: shaped.slice(0, 40).map(({ p, why }) => ({ url: norm(p.url), note: why.join(", ") })),
    files: [{ path: hints.page, reason: "Rename the route, and redirect the old URL permanently.", confidence: 40 }],
    canAutoFix: false,
  });

  return issues;
}
