import type { CrawledPage } from "@/lib/audit/types";
import { guardedFetch } from "@/lib/net/ssrf";
import { SEPTUNE_BOT_UA } from "@/lib/net/user-agent";
import { botAllowed } from "@/lib/audit/geo";
import { probeTls, type TlsInfo } from "@/lib/net/tls";
import { scanSitemaps, sitemapsFromRobots } from "./sitemap";

/**
 * Lightweight server-side crawler. Fetches the static HTML of a URL (no JS
 * render — Playwright is intentionally not a dependency) and extracts the
 * SEO-relevant fields the audit swarm reasons over. Good enough for the
 * head-level checks (title, meta, canonical, OG, headings, alt text, JSON-LD);
 * a Playwright-backed LiveCrawler can replace this behind the same shape.
 */

const MAX_HTML = 60_000; // cap stored/forwarded HTML to control tokens
const FETCH_TIMEOUT_MS = 12_000;

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Numeric entities (&#x27; &#39; &#8217;…) — common in React/Next output.
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .trim();
}

function safeChar(code: number): string {
  try {
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
}

function stripTags(s: string): string {
  return decode(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? decode(m[1]!) : null;
}

function metaContent(html: string, key: "name" | "property", value: string) {
  const re = new RegExp(`<meta\\b[^>]*>`, "gi");
  for (const m of html.matchAll(re)) {
    const tag = m[0];
    const k = attr(tag, key);
    if (k && k.toLowerCase() === value.toLowerCase()) return attr(tag, "content");
  }
  return null;
}

/** Extract the visible text of the <body>, minus script/style/noscript. */
function visibleText(html: string): string {
  const body = html.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? html;
  const cleaned = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ");
  return stripTags(cleaned);
}

function parse(
  url: string,
  statusCode: number,
  html: string,
  renderMs: number,
  responseTimeMs: number,
): CrawledPage {
  const origin = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  })();

  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? html;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]!) : null;

  const canonicalTag = html.match(
    /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i,
  );
  const canonical = canonicalTag ? attr(canonicalTag[0], "href") : null;

  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
  const lang = attr(htmlTag, "lang");

  const metaRobots = metaContent(html, "name", "robots")?.toLowerCase() ?? null;
  const metaGooglebot = metaContent(html, "name", "googlebot")?.toLowerCase() ?? null;
  const viewport = metaContent(html, "name", "viewport");
  const twitterCard = metaContent(html, "name", "twitter:card");

  const og: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const prop = attr(m[0], "property");
    if (prop && prop.toLowerCase().startsWith("og:")) {
      const content = attr(m[0], "content");
      if (content) og[prop.toLowerCase()] = content;
    }
  }

  const hreflang: CrawledPage["hreflang"] = [];
  for (const m of head.matchAll(/<link\b[^>]*rel\s*=\s*["']alternate["'][^>]*>/gi)) {
    const hl = attr(m[0], "hreflang");
    const href = attr(m[0], "href");
    if (hl && href) hreflang.push({ lang: hl, href });
  }

  const headings: { level: number; text: string }[] = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = stripTags(m[2]!);
    if (text) headings.push({ level: Number(m[1]), text });
  }
  const h1s = headings.filter((h) => h.level === 1).map((h) => h.text);

  const images: CrawledPage["images"] = [];
  let imagesMissingDims = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(m[0], "src");
    if (!src) continue;
    const w = attr(m[0], "width");
    const h = attr(m[0], "height");
    const loading = attr(m[0], "loading");
    const hasW = !!w && /^\d+$/.test(w);
    const hasH = !!h && /^\d+$/.test(h);
    if (!hasW || !hasH) imagesMissingDims++;
    images.push({
      src,
      alt: attr(m[0], "alt"),
      ...(hasW ? { width: Number(w) } : {}),
      ...(hasH ? { height: Number(h) } : {}),
      loading: loading ?? null,
    });
  }

  const links: CrawledPage["links"] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1]!);
    if (
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    )
      continue;
    const internal =
      href.startsWith("/") || (origin !== "" && href.startsWith(origin));
    const rel = attr(m[0], "rel")?.toLowerCase() ?? "";
    links.push({
      href,
      internal,
      anchor: stripTags(m[2]!).slice(0, 120),
      nofollow: rel.includes("nofollow"),
    });
  }

  const jsonLd: unknown[] = [];
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      jsonLd.push(JSON.parse(m[1]!.trim()));
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  // Render-blocking resources in <head>: sync <script src> (no async/defer/
  // module) and non-conditional <link rel=stylesheet>.
  let blockingScripts = 0;
  for (const m of head.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\bsrc\s*=/.test(tag)) continue;
    if (/\b(async|defer)\b/i.test(tag)) continue;
    if (/type\s*=\s*["']module["']/i.test(tag)) continue;
    blockingScripts++;
  }
  let blockingStyles = 0;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    if (/media\s*=\s*["']print["']/i.test(tag)) continue;
    blockingStyles++;
  }

  const text = visibleText(html);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;

  return {
    url,
    statusCode,
    html: html.slice(0, MAX_HTML),
    title,
    metaDescription: metaContent(html, "name", "description"),
    canonical,
    h1s,
    headings: headings.slice(0, 60),
    images: images.slice(0, 120),
    links: links.slice(0, 300),
    jsonLd,
    renderMs,
    lang,
    metaRobots,
    metaGooglebot,
    viewport,
    hreflang,
    og,
    twitterCard,
    textContent: text.slice(0, 12_000),
    wordCount,
    htmlBytes: Buffer.byteLength(html),
    responseTimeMs,
    renderBlocking: { scripts: blockingScripts, stylesheets: blockingStyles },
    imagesMissingDims,
  };
}

/** Hard cap on bytes read from a crawled page (well above MAX_HTML). */
const MAX_FETCH_BYTES = 512 * 1024;

/** Stream-read a response body with a byte cap — never buffers huge pages. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_FETCH_BYTES);
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= MAX_FETCH_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return out;
}

function stripHash(u: string): string {
  const i = u.indexOf("#");
  return i === -1 ? u : u.slice(0, i);
}

async function fetchPage(url: string): Promise<CrawledPage> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // guardedFetch validates the target (and every redirect hop) against
    // private/internal addresses on hosted deployments (SSRF); it's a plain
    // redirect-following fetch in local dev.
    const res = await guardedFetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": SEPTUNE_BOT_UA },
    });
    // TTFB proxy: time until response headers arrive (before body streaming).
    const ttfb = Date.now() - started;
    // Only audit HTML documents; tag everything else as a fetch problem so
    // the engine treats it as an error page, not site content.
    const contentType = res.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html") || contentType === "";
    const finalUrl = res.url || url; // record the redirect target, not the request URL
    const xRobotsTag = res.headers.get("x-robots-tag")?.toLowerCase() ?? null;
    const tag = (page: CrawledPage): CrawledPage => {
      page.xRobotsTag = xRobotsTag;
      if (stripHash(finalUrl) !== stripHash(url)) page.requestedUrl = url;
      return page;
    };
    if (!res.ok || !isHtml) {
      const note = !res.ok
        ? `<!-- fetch-error: HTTP ${res.status} -->`
        : `<!-- fetch-error: non-HTML content-type ${contentType} -->`;
      res.body?.cancel().catch(() => {});
      return tag(parse(finalUrl, res.status, note, Date.now() - started, ttfb));
    }
    const html = await readCapped(res);
    return tag(parse(finalUrl, res.status, html, Date.now() - started, ttfb));
  } finally {
    clearTimeout(timer);
  }
}

export interface SiteFiles {
  /** A sitemap was found and read (declared in robots.txt or at a conventional path). */
  hasSitemap: boolean;
  /** /robots.txt returns 2xx with a non-HTML body. */
  hasRobots: boolean;
  /** robots.txt contains a Sitemap: directive. */
  robotsDeclaresSitemap: boolean;
  /** Raw robots.txt body (up to 100 KB), "" when absent. Used by the GEO audit and the crawler. */
  robotsTxt?: string;
  /** robots.txt answered 200 with an HTML page (SPA fallback): crawlers get no rules. */
  robotsIsHtml?: boolean;
  /** HTTP status of /robots.txt (0 when unreachable). */
  robotsStatus?: number;
  /** HTTP status of a path that cannot exist: 200 means missing pages aren't 404s. */
  notFoundStatus?: number;
  /** The probe path used for notFoundStatus. */
  notFoundProbe?: string;
  /** Where the probe landed when the site redirected it. */
  notFoundLandedOn?: string;
  /** /llms.txt returns 2xx with non-HTML content. */
  hasLlmsTxt?: boolean;
  /** llms.txt body (up to 16 KB), for format validation. */
  llmsTxt?: string;
  /** Page URLs listed in the sitemap(s). */
  sitemapUrls?: string[];
  /** Sitemap files read. */
  sitemapFiles?: string[];
  /** A cap cut the sitemap scan short (very large sitemaps). */
  sitemapTruncated?: boolean;
  /** HTTPS certificate of the start URL's host; null on http:// or when unreachable. */
  tls?: TlsInfo | null;
  /** The other host spelling (www / bare) and the http:// homepage: where they land. */
  hostVariants?: HostVariant[];
}

export interface HostVariant {
  kind: "host" | "http";
  url: string;
  /** Final status after redirects; 0 when the host doesn't resolve or answer. */
  status: number;
  finalUrl: string;
  /** Canonical declared by the page it landed on, when it answered 200. */
  canonical: string | null;
}

/**
 * The homepage under its other spellings: www.example.com when the site is
 * example.com (and the reverse), and http:// when it's served over https.
 * Each should redirect to the one real address, or at least declare it as
 * canonical, otherwise search engines index the site twice.
 */
async function probeHostVariants(origin: string): Promise<HostVariant[]> {
  let site: URL;
  try {
    site = new URL(origin);
  } catch {
    return [];
  }
  const targets: { kind: HostVariant["kind"]; url: string }[] = [];
  const isNameHost = site.hostname.includes(".") && !/^[\d.]+$/.test(site.hostname) && !site.hostname.includes(":");
  if (isNameHost) {
    const other = site.hostname.startsWith("www.") ? site.hostname.slice(4) : `www.${site.hostname}`;
    targets.push({ kind: "host", url: `${site.protocol}//${other}${site.port ? `:${site.port}` : ""}/` });
  }
  if (site.protocol === "https:") targets.push({ kind: "http", url: `http://${site.host}/` });

  return Promise.all(
    targets.map(async ({ kind, url }) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const res = await guardedFetch(url, { signal: ctrl.signal, headers: { "user-agent": SEPTUNE_BOT_UA } });
        const html = res.ok ? (await res.text()).slice(0, 64_000) : "";
        if (!res.ok) res.body?.cancel().catch(() => {});
        const canonical = html.match(/<link\b[^>]*\brel=["']?canonical["']?[^>]*\bhref=["']([^"']+)["']/i)?.[1] ??
          html.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']?canonical["']?/i)?.[1] ??
          null;
        return { kind, url, status: res.status, finalUrl: res.url || url, canonical };
      } catch {
        return { kind, url, status: 0, finalUrl: url, canonical: null };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

/**
 * Probe the site-level files directly (cheap, deterministic): robots.txt,
 * the sitemaps it declares (or the conventional ones), llms.txt, and the TLS
 * certificate. Nothing here is inferred from the HTML.
 */
export async function probeSiteFiles(
  startUrl: string,
  /** `light`: a small sitemap read and short TLS timeout, for tight budgets (the free web audit). */
  opts?: { sitemaps?: boolean; tls?: boolean; light?: boolean },
): Promise<SiteFiles> {
  const origin = (() => {
    try {
      return new URL(startUrl).origin;
    } catch {
      return "";
    }
  })();
  if (!origin) return { hasSitemap: false, hasRobots: false, robotsDeclaresSitemap: false, robotsTxt: "", hasLlmsTxt: false };

  const get = async (path: string, cap: number) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await guardedFetch(`${origin}${path}`, {
        signal: ctrl.signal,
        headers: { "user-agent": SEPTUNE_BOT_UA },
      });
      const html = (res.headers.get("content-type") ?? "").includes("text/html");
      const finalUrl = res.url || `${origin}${path}`;
      if (!res.ok) {
        res.body?.cancel().catch(() => {});
        return { ok: false, body: "", html, status: res.status, finalUrl };
      }
      const body = cap > 0 ? (await res.text()).slice(0, cap) : "";
      if (cap === 0) res.body?.cancel().catch(() => {});
      return { ok: true, body, html, status: res.status, finalUrl };
    } catch {
      return { ok: false, body: "", html: false, status: 0, finalUrl: "" };
    } finally {
      clearTimeout(timer);
    }
  };

  // A path that cannot exist: a healthy site answers 404, not 200.
  const notFoundProbe = `/septune-404-check-${Math.random().toString(36).slice(2, 10)}`;
  const [robots, llms, tls, missing, hostVariants] = await Promise.all([
    get("/robots.txt", 100_000),
    get("/llms.txt", 16_000),
    opts?.tls === false ? Promise.resolve(null) : probeTls(startUrl, opts?.light ? 3500 : 6000).catch(() => null),
    get(notFoundProbe, 0),
    probeHostVariants(origin).catch(() => []),
  ]);
  const landedPath = (() => {
    try {
      return new URL(missing.finalUrl).pathname;
    } catch {
      return notFoundProbe;
    }
  })();
  const robotsIsHtml = robots.ok && robots.html;
  const robotsTxt = robots.ok && !robots.html ? robots.body : "";
  const declared = sitemapsFromRobots(robotsTxt, origin);

  const sitemap =
    opts?.sitemaps === false
      ? null
      : await scanSitemaps(
          origin,
          declared,
          opts?.light ? { maxFiles: 2, maxUrls: 300, deadlineMs: 4000 } : undefined,
        ).catch(() => null);

  return {
    hasSitemap: Boolean(sitemap && sitemap.files.length > 0),
    hasRobots: robots.ok && !robots.html,
    robotsIsHtml,
    robotsStatus: robots.status,
    notFoundStatus: missing.status || undefined,
    notFoundProbe,
    ...(missing.status && landedPath !== notFoundProbe ? { notFoundLandedOn: missing.finalUrl } : {}),
    robotsDeclaresSitemap: declared.length > 0,
    robotsTxt,
    // SPAs often answer every path with index.html: that's not an llms.txt.
    hasLlmsTxt: llms.ok && !llms.html && llms.body.trim().length > 0,
    llmsTxt: llms.ok && !llms.html ? llms.body : "",
    sitemapUrls: sitemap?.urls ?? [],
    sitemapFiles: sitemap?.files ?? [],
    sitemapTruncated: sitemap?.truncated ?? false,
    tls,
    hostVariants,
  };
}

export interface CrawlOptions {
  maxPages?: number;
  /** Overall wall-clock budget. */
  deadlineMs?: number;
  /**
   * Ceiling for maxPages. Hosted routes keep the historic 24; the CLI, which
   * runs on the user's machine, raises it.
   */
  hardCap?: number;
  /** Parallel fetches (polite default 4, max 8). */
  concurrency?: number;
  /** robots.txt body: URLs it disallows for SeptuneBot are not fetched. */
  robotsTxt?: string;
  /**
   * Extra URLs crawled once the link frontier is exhausted: sitemap entries
   * (to find pages nothing links to) or previously known paths (monitoring).
   */
  seeds?: { url: string; via: "sitemap" | "seed" }[];
}

export interface CrawlResult {
  pages: CrawledPage[];
  /** Every internally linked page was crawled (no cap or deadline cut). */
  complete: boolean;
  /** Paths skipped because robots.txt disallows SeptuneBot there. */
  blockedByRobots: string[];
}

const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|avif|css|js|mjs|ico|pdf|zip|gz|xml|json|txt|woff2?|ttf|mp4|webm|mp3)$/i;

/** example.com and www.example.com are one site; example.org is not. */
function sameSite(a: string, b: string): boolean {
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return bare(a) === bare(b);
}

/**
 * Crawl a site from `startUrl`, breadth-first over same-origin internal links,
 * then over the seeds (sitemap entries…) the links did not reach. Fetches run
 * in a small worker pool; robots.txt rules for SeptuneBot are honoured when
 * the body is passed in.
 *
 * Click depth is recomputed by the link graph, so the depth recorded here is
 * only the discovery depth.
 */
export async function crawlSite(startUrl: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const cap = Math.max(1, opts.hardCap ?? 24);
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 12, cap));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  // Overall wall-clock budget so a site of slow pages can't run past a route's
  // maxDuration (each page can take up to FETCH_TIMEOUT_MS on its own).
  const deadline = Date.now() + Math.max(10_000, opts.deadlineMs ?? 90_000);
  const start = new URL(startUrl);
  let origin = start.origin;
  const robots = opts.robotsTxt ?? "";
  const allowed = (u: URL) => !robots || botAllowed(robots, "SeptuneBot", u.pathname + u.search);

  const blockedByRobots: string[] = [];
  if (!allowed(start)) return { pages: [], complete: true, blockedByRobots: [start.pathname] };

  type Job = { url: URL; depth: number; via: "link" | "sitemap" | "seed" };
  const seen = new Set<string>([start.pathname]);
  const queue: Job[] = [];
  const consider = (u: URL, depth: number, via: Job["via"]) => {
    if (u.origin !== origin || seen.has(u.pathname)) return;
    if (ASSET_RE.test(u.pathname)) return;
    seen.add(u.pathname);
    if (!allowed(u)) {
      blockedByRobots.push(u.pathname);
      return;
    }
    queue.push({ url: u, depth, via });
  };
  const enqueueLinks = (page: CrawledPage, depth: number) => {
    for (const l of page.links) {
      if (!l.internal) continue;
      try {
        consider(new URL(l.href, page.url || startUrl), depth + 1, "link");
      } catch {
        /* skip malformed */
      }
    }
  };

  const first = await fetchPage(startUrl);
  first.depth = 0;
  first.discoveredVia = "link";
  const pages = [first];
  try {
    const landed = new URL(first.url);
    seen.add(landed.pathname);
    // The bare domain redirected to www (or http to https): crawl where the
    // site actually lives, or every internal link looks off-site and the audit
    // stops at one page with a perfect score.
    if (landed.origin !== origin && sameSite(landed.hostname, start.hostname)) origin = landed.origin;
  } catch {
    /* keep */
  }
  enqueueLinks(first, 0);

  const seeds = opts.seeds ?? [];
  let seedIdx = 0;
  let frontierDone = false;
  const takeSeed = (): Job | undefined => {
    frontierDone = true;
    while (seedIdx < seeds.length) {
      const s = seeds[seedIdx++]!;
      let u: URL;
      try {
        u = new URL(s.url, startUrl);
      } catch {
        continue;
      }
      const before = queue.length;
      consider(u, -1, s.via);
      if (queue.length > before) return queue.shift();
    }
    return undefined;
  };

  let inFlight = 0;
  const worker = async () => {
    while (pages.length + inFlight < maxPages && Date.now() < deadline) {
      let job = queue.shift();
      if (!job) {
        // Other workers may still add links: only fall back to seeds once
        // the whole link frontier is drained, so seeds never starve links.
        if (inFlight > 0) {
          await new Promise((r) => setTimeout(r, 20));
          continue;
        }
        job = takeSeed();
        if (!job) break;
      }
      inFlight++;
      try {
        const page = await fetchPage(job.url.toString());
        page.depth = job.depth;
        page.discoveredVia = job.via;
        try {
          seen.add(new URL(page.url).pathname);
        } catch {
          /* keep */
        }
        if (pages.length < maxPages) {
          pages.push(page);
          enqueueLinks(page, Math.max(0, job.depth));
        }
      } catch {
        /* skip pages that fail to fetch */
      } finally {
        inFlight--;
      }
    }
  };
  if (maxPages > 1) await Promise.all(Array.from({ length: concurrency }, worker));

  // "Complete" = the link frontier drained before a cap or the deadline hit.
  const complete = queue.length === 0 && (frontierDone || maxPages === 1 || pages.length < maxPages);

  // Dedupe by FINAL pathname: two requested paths can land on the same page
  // via a redirect (e.g. /dashboard -> /login?next=/dashboard while /login is
  // also linked directly). The BFS already treats pathname as page identity
  // (query ignored), so the final dedupe follows the same rule: otherwise the
  // same page is reported twice in every finding.
  const keptByKey = new Map<string, CrawledPage>();
  const unique = pages.filter((p) => {
    let key = p.url;
    try {
      key = new URL(p.url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      /* keep raw url as key */
    }
    const kept = keptByKey.get(key);
    if (kept) {
      // Same landing page reached through a redirect: remember where from,
      // so sitemap/canonical/hreflang checks can still say "redirects".
      if (p.requestedUrl) (kept.redirectedFrom ??= []).push(p.requestedUrl);
      return false;
    }
    keptByKey.set(key, p);
    return true;
  });
  return { pages: unique, complete, blockedByRobots };
}

/**
 * Probe the site files, then crawl with them: robots.txt honoured (unless
 * `ignoreRobots`, for the owner's own site), sitemap entries nothing links
 * to crawled after the linked pages. Throws when robots.txt disallows the
 * start URL, so callers never audit an empty crawl.
 */
export async function scanSite(
  startUrl: string,
  opts: CrawlOptions & { light?: boolean; ignoreRobots?: boolean; sitemapSeeds?: number } = {},
): Promise<{ pages: CrawledPage[]; siteFiles: SiteFiles & { crawlComplete: boolean }; blockedByRobots: string[] }> {
  const siteFiles = await probeSiteFiles(startUrl, { light: opts.light });
  const seeds = [
    ...(opts.seeds ?? []),
    ...(siteFiles.sitemapUrls ?? []).slice(0, opts.sitemapSeeds ?? 1000).map((u) => ({ url: u, via: "sitemap" as const })),
  ];
  const res = await crawlSite(startUrl, {
    ...opts,
    robotsTxt: opts.ignoreRobots ? undefined : siteFiles.robotsTxt,
    seeds,
  });
  if (res.pages.length === 0 && res.blockedByRobots.length) {
    throw new Error("robots.txt disallows SeptuneBot on this URL. If it's your own site, audit it with robots.txt ignored.");
  }
  return { pages: res.pages, siteFiles: { ...siteFiles, crawlComplete: res.complete }, blockedByRobots: res.blockedByRobots };
}

/** Back-compatible wrapper: just the pages. */
export async function crawl(startUrl: string, opts?: CrawlOptions): Promise<CrawledPage[]> {
  return (await crawlSite(startUrl, opts)).pages;
}
