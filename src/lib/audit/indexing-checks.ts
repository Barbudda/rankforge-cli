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

  return issues;
}
