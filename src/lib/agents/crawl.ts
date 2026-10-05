import type { CrawledPage } from "@/lib/audit/types";
import { guardedFetch, assertUrlAllowed, ssrfEnforced } from "@/lib/net/ssrf";

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
      headers: { "user-agent": "RankForgeBot/1.0 (+https://rankforge.dev)" },
    });
    // TTFB proxy: time until response headers arrive (before body streaming).
    const ttfb = Date.now() - started;
    // Only audit HTML documents; tag everything else as a fetch problem so
    // the engine treats it as an error page, not site content.
    const contentType = res.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html") || contentType === "";
    const finalUrl = res.url || url; // record the redirect target, not the request URL
    if (!res.ok || !isHtml) {
      const note = !res.ok
        ? `<!-- fetch-error: HTTP ${res.status} -->`
        : `<!-- fetch-error: non-HTML content-type ${contentType} -->`;
      return parse(finalUrl, res.status, note, Date.now() - started, ttfb);
    }
    const html = await readCapped(res);
    return parse(finalUrl, res.status, html, Date.now() - started, ttfb);
  } finally {
    clearTimeout(timer);
  }
}

export interface SiteFiles {
  /** /sitemap.xml returns 2xx. */
  hasSitemap: boolean;
  /** /robots.txt returns 2xx. */
  hasRobots: boolean;
  /** robots.txt contains a Sitemap: directive. */
  robotsDeclaresSitemap: boolean;
  /** Raw robots.txt body (≤ 8 KB), "" when absent — used by the GEO audit. */
  robotsTxt?: string;
  /** /llms.txt returns 2xx with non-HTML content. */
  hasLlmsTxt?: boolean;
}

/** Probe the two well-known SEO files directly (cheap, deterministic). */
export async function probeSiteFiles(startUrl: string): Promise<SiteFiles> {
  const origin = (() => {
    try {
      return new URL(startUrl).origin;
    } catch {
      return "";
    }
  })();
  if (!origin) return { hasSitemap: false, hasRobots: false, robotsDeclaresSitemap: false, robotsTxt: "", hasLlmsTxt: false };

  const get = async (path: string) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await guardedFetch(`${origin}${path}`, {
        signal: ctrl.signal,
        headers: { "user-agent": "RankForgeBot/1.0 (+https://rankforge.dev)" },
      });
      const body = res.ok ? (await res.text()).slice(0, 8000) : "";
      const html = (res.headers.get("content-type") ?? "").includes("text/html");
      return { ok: res.ok, body, html };
    } catch {
      return { ok: false, body: "", html: false };
    } finally {
      clearTimeout(timer);
    }
  };

  const [sitemap, robots, llms] = await Promise.all([
    get("/sitemap.xml"),
    get("/robots.txt"),
    get("/llms.txt"),
  ]);
  return {
    hasSitemap: sitemap.ok,
    hasRobots: robots.ok,
    robotsDeclaresSitemap: /(^|\n)\s*sitemap\s*:/i.test(robots.body),
    robotsTxt: robots.ok ? robots.body : "",
    // SPAs often answer every path with index.html — that's not an llms.txt.
    hasLlmsTxt: llms.ok && !llms.html && llms.body.trim().length > 0,
  };
}

/**
 * Crawl a site starting from `startUrl`, breadth-first over same-origin
 * internal links up to `maxPages`. Records the depth (clicks from the start
 * page) of every page reached, which the link-graph analysis reads.
 *
 * The deterministic engine has no per-page token cost, so we crawl deeper by
 * default (up to 24 pages) than the old LLM-only path did.
 */
export async function crawl(
  startUrl: string,
  opts?: { maxPages?: number; deadlineMs?: number },
): Promise<CrawledPage[]> {
  const maxPages = Math.max(1, Math.min(opts?.maxPages ?? 12, 24));
  // Overall wall-clock budget so a site of slow pages can't run past a route's
  // maxDuration (each page can take up to FETCH_TIMEOUT_MS on its own).
  const deadline = Date.now() + Math.max(10_000, opts?.deadlineMs ?? 90_000);
  const origin = new URL(startUrl).origin;
  const startPath = new URL(startUrl).pathname;

  const first = await fetchPage(startUrl);
  first.depth = 0;
  const pages = [first];
  if (maxPages === 1) return pages;

  const seen = new Set([startPath]);
  // BFS queue of {url, depth}; children inherit parent depth + 1.
  const queue: { url: URL; depth: number }[] = [];
  const enqueue = (page: CrawledPage, depth: number) => {
    for (const l of page.links) {
      if (!l.internal) continue;
      let u: URL;
      try {
        u = new URL(l.href, startUrl);
      } catch {
        continue;
      }
      if (u.origin !== origin || seen.has(u.pathname)) continue;
      // Skip obvious non-HTML assets by extension.
      if (/\.(png|jpe?g|gif|svg|webp|avif|css|js|ico|pdf|zip|xml|json|woff2?|ttf|mp4|webm)$/i.test(u.pathname)) continue;
      queue.push({ url: u, depth: depth + 1 });
    }
  };
  enqueue(first, 0);

  while (queue.length && pages.length < maxPages && Date.now() < deadline) {
    const next = queue.shift()!;
    if (seen.has(next.url.pathname)) continue;
    seen.add(next.url.pathname);
    try {
      const page = await fetchPage(next.url.toString());
      page.depth = next.depth;
      pages.push(page);
      enqueue(page, next.depth);
    } catch {
      /* skip pages that fail to fetch */
    }
  }

  // Dedupe by FINAL pathname: two requested paths can land on the same page
  // via a redirect (e.g. /dashboard → /login?next=/dashboard while /login is
  // also linked directly). The BFS already treats pathname as page identity
  // (query ignored), so the final dedupe follows the same rule — otherwise the
  // same page is reported twice in every finding.
  const seenFinal = new Set<string>();
  return pages.filter((p) => {
    let key = p.url;
    try {
      key = new URL(p.url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      /* keep raw url as key */
    }
    if (seenFinal.has(key)) return false;
    seenFinal.add(key);
    return true;
  });
}
