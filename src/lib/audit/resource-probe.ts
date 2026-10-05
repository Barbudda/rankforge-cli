import type { CrawledPage } from "./types";
import { assertUrlAllowed } from "@/lib/net/ssrf";

/**
 * Real resource analysis — the audit stops guessing and starts measuring.
 * Fetches the actual images and links referenced across the crawled site to
 * find: broken links (real HTTP status), redirect chains, mixed content, and
 * oversized / legacy-format images. Pure HTTP, zero external API.
 *
 * Everything is bounded (max probes, concurrency, per-request timeout) and
 * best-effort: if a probe fails, the HTML-level rules still stand.
 */

export interface Probe {
  /** Resolved absolute URL probed. */
  url: string;
  /** Final HTTP status (after following redirects), or 0 on network error. */
  status: number;
  /** Redirect hops followed (0 = direct). */
  redirects: number;
  /** Final URL after redirects. */
  finalUrl: string;
  /** Content-Length in bytes when the server reports it, else null. */
  bytes: number | null;
  /** Content-Type (lowercased), else "". */
  contentType: string;
  /** True if an https page referenced an http:// resource (mixed content). */
  insecure: boolean;
}

export interface ResourceReport {
  /** Probe by resolved absolute image URL. */
  images: Map<string, Probe>;
  /** Probe by resolved absolute link URL. */
  links: Map<string, Probe>;
}

const DEFAULTS = {
  maxImages: 48,
  maxLinks: 64,
  concurrency: 8,
  timeoutMs: 7000,
  maxHops: 5,
};

/** Follow redirects manually so we can count hops and see each Location. */
async function probeUrl(
  rawUrl: string,
  fromHttps: boolean,
  timeoutMs: number,
  maxHops: number,
): Promise<Probe> {
  let current = rawUrl;
  let redirects = 0;
  let insecure = fromHttps && rawUrl.startsWith("http://");

  // One deadline for the ENTIRE redirect chain, not per hop — a slow chain of
  // redirects can't stall the audit past timeoutMs.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
  for (let hop = 0; hop <= maxHops; hop++) {
    try {
      // SSRF: validate this hop's host/resolved IPs before connecting (no-op
      // in local dev). A hostile crawled page can't make us probe internal IPs.
      await assertUrlAllowed(current);
      // HEAD first (cheap); some servers reject it → fall back to ranged GET.
      let res = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": "RankForgeBot/1.0 (+https://rankforge.dev)" },
      }).catch(() => null);
      if (!res || res.status === 405 || res.status === 501) {
        res = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            "user-agent": "RankForgeBot/1.0 (+https://rankforge.dev)",
            range: "bytes=0-0",
          },
        }).catch(() => null);
      }
      if (!res) return { url: rawUrl, status: 0, redirects, finalUrl: current, bytes: null, contentType: "", insecure };

      // We only need headers — release any body so sockets don't leak across
      // the ~100 probes per audit (undici keeps the connection open otherwise).
      res.body?.cancel().catch(() => {});

      // Redirect?
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || hop === maxHops) {
          return { url: rawUrl, status: res.status, redirects, finalUrl: current, bytes: null, contentType: "", insecure };
        }
        const next = new URL(loc, current).toString();
        if (next.startsWith("http://")) insecure = insecure || fromHttps;
        current = next;
        redirects++;
        continue;
      }

      // Size resolution: a ranged GET reports the true total in Content-Range
      // (`bytes 0-0/12345`); a HEAD reports it directly in Content-Length.
      const contentRange = res.headers.get("content-range");
      const contentLength = res.headers.get("content-length");
      let bytes: number | null = null;
      if (contentRange) {
        const m = contentRange.match(/\/(\d+)\s*$/);
        if (m) bytes = Number(m[1]);
      } else if (contentLength) {
        bytes = Number(contentLength);
      }
      return {
        url: rawUrl,
        status: res.status,
        redirects,
        finalUrl: current,
        bytes: Number.isFinite(bytes as number) ? bytes : null,
        contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
        insecure,
      };
    } catch {
      return { url: rawUrl, status: 0, redirects, finalUrl: current, bytes: null, contentType: "", insecure };
    }
  }
  return { url: rawUrl, status: 0, redirects, finalUrl: current, bytes: null, contentType: "", insecure };
  } finally {
    clearTimeout(timer);
  }
}

/** Concurrency-capped map. */
async function mapLimit<I, O>(items: I[], limit: number, fn: (item: I) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

function resolve(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * Probe the images and links across the crawled pages. Deduped and bounded.
 */
export async function probeResources(
  pages: CrawledPage[],
  startUrl: string,
  opts?: Partial<typeof DEFAULTS>,
): Promise<ResourceReport> {
  const cfg = { ...DEFAULTS, ...opts };
  const okPages = pages.filter((p) => p.statusCode >= 200 && p.statusCode < 300);
  const startHttps = startUrl.startsWith("https://");

  // Collect unique image URLs.
  const imgUrls = new Map<string, boolean>(); // url → fromHttps
  for (const p of okPages) {
    const fromHttps = p.url.startsWith("https://");
    for (const im of p.images) {
      if (im.src.startsWith("data:")) continue;
      const abs = resolve(im.src, p.url);
      if (abs && !imgUrls.has(abs)) imgUrls.set(abs, fromHttps);
      if (imgUrls.size >= cfg.maxImages) break;
    }
    if (imgUrls.size >= cfg.maxImages) break;
  }

  // Collect unique link URLs — external links + internal links NOT crawled
  // (those we didn't already resolve to a status).
  const crawledPaths = new Set(
    okPages.map((p) => {
      try {
        return new URL(p.url).pathname.replace(/\/+$/, "") || "/";
      } catch {
        return p.url;
      }
    }),
  );
  const linkUrls = new Map<string, boolean>();
  for (const p of okPages) {
    const fromHttps = p.url.startsWith("https://");
    for (const l of p.links) {
      const abs = resolve(l.href, p.url);
      if (!abs) continue;
      // Skip already-crawled internal paths (their status is known).
      if (l.internal) {
        try {
          const path = new URL(abs).pathname.replace(/\/+$/, "") || "/";
          if (crawledPaths.has(path)) continue;
        } catch {
          /* fall through */
        }
      }
      if (!linkUrls.has(abs)) linkUrls.set(abs, fromHttps);
      if (linkUrls.size >= cfg.maxLinks) break;
    }
    if (linkUrls.size >= cfg.maxLinks) break;
  }

  const imgEntries = [...imgUrls.entries()];
  const linkEntries = [...linkUrls.entries()];

  const [imgProbes, linkProbes] = await Promise.all([
    mapLimit(imgEntries, cfg.concurrency, ([url, fromHttps]) =>
      probeUrl(url, fromHttps, cfg.timeoutMs, cfg.maxHops),
    ),
    mapLimit(linkEntries, cfg.concurrency, ([url, fromHttps]) =>
      probeUrl(url, fromHttps, cfg.timeoutMs, cfg.maxHops),
    ),
  ]);

  const images = new Map<string, Probe>();
  imgEntries.forEach(([url], i) => images.set(url, imgProbes[i]!));
  const links = new Map<string, Probe>();
  linkEntries.forEach(([url], i) => links.set(url, linkProbes[i]!));

  return { images, links };
}
