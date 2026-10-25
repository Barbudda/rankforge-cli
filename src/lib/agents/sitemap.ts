import { gunzipSync } from "node:zlib";
import { guardedFetch } from "@/lib/net/ssrf";

/**
 * Sitemap reader. Follows the sitemaps a site actually declares (robots.txt
 * `Sitemap:` lines, else /sitemap.xml then /sitemap_index.xml), walks sitemap
 * indexes, and returns the page URLs they list. Bounded on every axis — files,
 * URLs, bytes, time — because a sitemap is untrusted input.
 *
 * What the URLs are for: seeding the crawl so pages nobody links to (true
 * orphans) get audited, and checking sitemap hygiene (listed URLs that
 * redirect, error, are noindex or canonicalise elsewhere).
 */

const UA = "SeptuneBot/1.0 (+https://www.rank-forge.dev/docs/agent)";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface SitemapScan {
  /** Sitemap files that were read successfully. */
  files: string[];
  /** Page URLs listed (deduplicated, in file order). */
  urls: string[];
  /** True when a cap (files, URLs, bytes, time) cut the scan short. */
  truncated: boolean;
  /** Files that could not be read, with a short reason. */
  errors: { file: string; reason: string }[];
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Pure: tell a sitemap index from a urlset and extract its <loc> entries. */
export function parseSitemapXml(xml: string): { kind: "index" | "urlset" | "unknown"; locs: string[] } {
  const kind = /<sitemapindex\b/i.test(xml) ? "index" : /<urlset\b/i.test(xml) ? "urlset" : "unknown";
  const locs: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)) {
    const loc = decodeXml(m[1]!.trim());
    if (loc) locs.push(loc);
  }
  return { kind, locs };
}

/** `Sitemap:` directives of a robots.txt, resolved to absolute URLs. */
export function sitemapsFromRobots(robotsTxt: string, origin: string): string[] {
  const out: string[] = [];
  for (const line of robotsTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (!m) continue;
    try {
      out.push(new URL(m[1]!, origin).toString());
    } catch {
      /* skip malformed */
    }
  }
  return [...new Set(out)];
}

async function readFile(url: string, deadline: number): Promise<{ ok: true; text: string; capped: boolean } | { ok: false; reason: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, Math.min(10_000, deadline - Date.now())));
  try {
    const res = await guardedFetch(url, { signal: ctrl.signal, headers: { "user-agent": UA } });
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    // SPAs answer unknown paths with their index.html — not a sitemap.
    if (type.includes("text/html")) {
      res.body?.cancel().catch(() => {});
      return { ok: false, reason: "served as an HTML page, not XML" };
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let capped = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        bytes += value.byteLength;
        if (bytes >= MAX_FILE_BYTES) {
          capped = true;
          await reader.cancel().catch(() => {});
          break;
        }
      }
    }
    let buf = Buffer.concat(chunks);
    // A .xml.gz file served as-is (not via Content-Encoding) still starts with
    // the gzip magic bytes: inflate it ourselves.
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      try {
        buf = gunzipSync(buf, { maxOutputLength: MAX_FILE_BYTES * 4 });
      } catch {
        return { ok: false, reason: "gzip file could not be inflated" };
      }
    }
    return { ok: true, text: buf.toString("utf8"), capped };
  } catch {
    return { ok: false, reason: "could not be fetched" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the site's sitemaps. `declared` are the robots.txt `Sitemap:` URLs;
 * when there are none, the conventional locations are tried.
 */
export async function scanSitemaps(
  origin: string,
  declared: string[],
  opts?: { maxFiles?: number; maxUrls?: number; deadlineMs?: number },
): Promise<SitemapScan> {
  const maxFiles = opts?.maxFiles ?? 10;
  const maxUrls = opts?.maxUrls ?? 5000;
  const deadline = Date.now() + (opts?.deadlineMs ?? 12_000);
  const scan: SitemapScan = { files: [], urls: [], truncated: false, errors: [] };
  const seenFiles = new Set<string>();
  const seenUrls = new Set<string>();

  const queue = declared.length ? [...declared] : [`${origin}/sitemap.xml`];
  const fallback = declared.length ? [] : [`${origin}/sitemap_index.xml`];

  while (queue.length || fallback.length) {
    if (!queue.length) {
      // Conventional fallback only when nothing has been found yet.
      if (scan.files.length) break;
      queue.push(fallback.shift()!);
      // The first conventional miss is expected on sites without sitemaps.
      scan.errors = scan.errors.filter((e) => !e.file.endsWith("/sitemap.xml"));
    }
    const file = queue.shift()!;
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);
    if (scan.files.length >= maxFiles || Date.now() > deadline) {
      scan.truncated = true;
      break;
    }
    const res = await readFile(file, deadline);
    if (!res.ok) {
      scan.errors.push({ file, reason: res.reason });
      continue;
    }
    if (res.capped) scan.truncated = true;
    const parsed = parseSitemapXml(res.text);
    if (parsed.kind === "unknown" && parsed.locs.length === 0) {
      scan.errors.push({ file, reason: "not a sitemap (no <urlset> or <sitemapindex>)" });
      continue;
    }
    scan.files.push(file);
    if (parsed.kind === "index") {
      for (const loc of parsed.locs) {
        try {
          queue.push(new URL(loc, file).toString());
        } catch {
          /* skip */
        }
      }
      continue;
    }
    for (const loc of parsed.locs) {
      if (scan.urls.length >= maxUrls) {
        scan.truncated = true;
        break;
      }
      if (seenUrls.has(loc)) continue;
      seenUrls.add(loc);
      scan.urls.push(loc);
    }
  }
  return scan;
}
