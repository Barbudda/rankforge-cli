/**
 * Self-contained local embeddings — no external API, no model download, no
 * native deps. A deterministic feature-hashing vectorizer: each text becomes a
 * fixed-dimension L2-normalized vector from its word tokens (lightly stemmed),
 * a small SEO-domain synonym map, and character trigrams (so near-matches and
 * typos still overlap). Cosine similarity over these vectors gives RankForge
 * genuine semantic recall that runs entirely in-process and works offline.
 *
 * It is not a neural embedding — it can't infer arbitrary synonymy — but with
 * stemming + a curated SEO synonym layer it matches the domain text RankForge
 * actually stores (issues, fixes, notes) well, with zero dependencies.
 */

export const EMBED_DIM = 512;

/** Map domain-equivalent terms to a shared canonical feature. */
const SYNONYM_GROUPS: string[][] = [
  ["image", "images", "img", "picture", "pictures", "photo", "photos", "graphic", "graphics"],
  ["alt", "alttext", "alternative"],
  ["link", "links", "url", "urls", "href", "hyperlink", "anchor"],
  ["title", "titles", "heading", "headings", "headline", "h1"],
  ["description", "descriptions", "desc", "metadescription", "snippet"],
  ["canonical", "canonicalize", "duplicate", "duplicates"],
  ["schema", "structured", "jsonld", "richresults", "richsnippet", "microdata"],
  ["sitemap", "sitemaps"],
  ["robots", "robotstxt", "noindex", "nofollow", "crawl", "crawler", "crawling", "index", "indexing", "indexable", "indexation"],
  ["performance", "perf", "lcp", "cls", "inp", "ttfb", "speed", "fast", "slow", "slowly", "load", "loads", "loading", "render", "rendering", "blocking", "blocks", "preload", "preloaded", "vitals", "corewebvitals"],
  ["metadata", "meta", "metatag", "metatags", "opengraph", "og", "twittercard"],
  ["fix", "fixes", "patch", "patches", "diff", "pullrequest", "pr"],
];

const SYNONYM: Record<string, string> = {};
for (const group of SYNONYM_GROUPS) {
  const canonical = `=${group[0]}`;
  for (const term of group) SYNONYM[term] = canonical;
}

/** 32-bit FNV-1a hash. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Light suffix stemmer (plurals / common inflections). */
function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  for (const suf of ["ing", "es", "ed", "s"]) {
    if (t.length > suf.length + 2 && t.endsWith(suf)) return t.slice(0, -suf.length);
  }
  return t;
}

/** Expand a text into hashable features: token, stem, synonym, char trigrams. */
function* features(text: string): Generator<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const raw of tokens) {
    yield raw;
    const s = stem(raw);
    if (s !== raw) yield s;
    const syn = SYNONYM[raw] ?? SYNONYM[s];
    if (syn) yield syn;
    if (raw.length > 4) {
      const padded = `#${raw}#`;
      for (let i = 0; i + 3 <= padded.length; i++) yield `~${padded.slice(i, i + 3)}`;
    }
  }
}

/** Embed text into a 512-dim L2-normalized vector (signed feature hashing). */
export function embed(text: string): number[] {
  const v = new Float64Array(EMBED_DIM);
  const counts = new Map<string, number>();
  for (const f of features(text)) counts.set(f, (counts.get(f) ?? 0) + 1);

  for (const [f, tf] of counts) {
    const idx = fnv1a(f) % EMBED_DIM;
    const sign = fnv1a(`sign:${f}`) & 1 ? 1 : -1;
    // Canonical synonym features (prefix "=") carry the most semantic load and
    // are boosted; char trigrams ("~") are fuzzy fallback and downweighted to
    // keep substring collisions (e.g. "homepage" vs "page") from dominating.
    const featureWeight = f.startsWith("=") ? 1.6 : f.startsWith("~") ? 0.4 : 1;
    v[idx]! += sign * featureWeight * (1 + Math.log(tf));
  }

  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;

  const out = new Array<number>(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) out[i] = v[i]! / norm;
  return out;
}

/** Cosine similarity. Inputs are L2-normalized, so this is a dot product. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}
