import type { CrawledPage } from "./types";

/**
 * Internal-link graph analysis — pure computation over the crawled page set,
 * zero external APIs. This is the part of SEO that a repository fully controls
 * and that most audit tools charge for: orphan detection, click depth, and an
 * internal PageRank that reveals which pages hoard vs. starve link equity.
 */

export interface LinkGraph {
  /** Normalized path per crawled page, in crawl order. */
  paths: string[];
  /** path → index. */
  index: Map<string, number>;
  /** Adjacency: outbound[i] = set of destination indices (deduped). */
  outbound: number[][];
  /** Inbound link count per page (from other crawled pages). */
  inboundCount: number[];
  /** Click depth from the start page (BFS), per page. */
  depth: number[];
  /** Internal PageRank (0–1, sums to ~1) per page. */
  pageRank: number[];
  /** Pages with zero internal inbound links (excluding the start page). */
  orphans: string[];
  /** Internal <a> hrefs that point to a crawled page returning ≥400. */
  brokenInternal: { from: string; href: string; status: number }[];
  /** Deepest click depth reached. */
  maxDepth: number;
}

/** Normalize a URL/path to a comparable pathname (no trailing slash, no hash). */
export function normalizePath(href: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  let p = u.pathname.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

export function buildLinkGraph(pages: CrawledPage[], startUrl: string): LinkGraph {
  const base = (() => {
    try {
      return new URL(startUrl).origin;
    } catch {
      return "";
    }
  })();
  const startPath = normalizePath(startUrl, startUrl) ?? "/";

  const paths = pages.map((p) => normalizePath(p.url, startUrl) ?? p.url);
  const index = new Map<string, number>();
  paths.forEach((p, i) => index.set(p, i));
  const statusByPath = new Map<string, number>();
  pages.forEach((p, i) => statusByPath.set(paths[i]!, p.statusCode));

  const outbound: number[][] = pages.map(() => []);
  const inboundCount = pages.map(() => 0);
  const brokenInternal: LinkGraph["brokenInternal"] = [];

  pages.forEach((page, i) => {
    const seenTargets = new Set<number>();
    for (const link of page.links) {
      if (!link.internal) continue;
      const target = normalizePath(link.href, base || startUrl);
      if (target === null) continue;
      const j = index.get(target);
      if (j === undefined) {
        // Link points somewhere we didn't crawl — only flag if we know it's a
        // crawled 4xx/5xx (handled via statusByPath below); otherwise skip.
        const status = statusByPath.get(target);
        if (status && status >= 400) {
          brokenInternal.push({ from: paths[i]!, href: target, status });
        }
        continue;
      }
      if (j === i || seenTargets.has(j)) continue;
      seenTargets.add(j);
      outbound[i]!.push(j);
      inboundCount[j]!++;
      const status = pages[j]!.statusCode;
      if (status >= 400) {
        brokenInternal.push({ from: paths[i]!, href: target, status });
      }
    }
  });

  // Depth: prefer the crawler-recorded BFS depth; fall back to a BFS here.
  const depth = pages.map((p) => (typeof p.depth === "number" ? p.depth : -1));
  if (depth.some((d) => d < 0)) {
    const startIdx = index.get(startPath) ?? 0;
    const q = [startIdx];
    depth[startIdx] = 0;
    while (q.length) {
      const i = q.shift()!;
      for (const j of outbound[i]!) {
        if (depth[j] === undefined || depth[j] < 0) {
          depth[j] = (depth[i] ?? 0) + 1;
          q.push(j);
        }
      }
    }
  }

  const orphans = paths.filter(
    (p, i) => p !== startPath && inboundCount[i] === 0,
  );

  const pageRank = computePageRank(outbound, pages.length);
  const maxDepth = depth.reduce((m, d) => (d > m ? d : m), 0);

  return {
    paths,
    index,
    outbound,
    inboundCount,
    depth,
    pageRank,
    orphans,
    brokenInternal,
    maxDepth,
  };
}

/** Standard PageRank via power iteration (damping 0.85, dangling handled). */
function computePageRank(outbound: number[][], n: number): number[] {
  if (n === 0) return [];
  const d = 0.85;
  let rank = new Array(n).fill(1 / n);
  for (let iter = 0; iter < 40; iter++) {
    const next = new Array(n).fill((1 - d) / n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      const outs = outbound[i]!;
      if (outs.length === 0) {
        dangling += rank[i];
        continue;
      }
      const share = (d * rank[i]) / outs.length;
      for (const j of outs) next[j] += share;
    }
    // Redistribute dangling-node mass evenly.
    const spread = (d * dangling) / n;
    for (let i = 0; i < n; i++) next[i] += spread;
    rank = next;
  }
  return rank;
}
