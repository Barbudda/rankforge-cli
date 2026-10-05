import type { CrawledPage } from "./types";
import { normalizePath } from "./link-graph";

/**
 * In-build content intelligence — real on-page SEO analysis with pure NLP,
 * zero external API:
 *  - TF-IDF over the crawled corpus → each page's ACTUAL topic terms.
 *  - Title/H1 ↔ content alignment (is the page about what it says it's about?).
 *  - Readability (Flesch Reading Ease).
 *  - Keyword stuffing detection (over-dense terms).
 */

const STOPWORDS = new Set(
  ("a an the and or but if then else for to of in on at by with without from as is are was were be been being this that these those it its it's you your yours we our us they them their he she his her i me my mine do does did done have has had having will would can could should may might must not no yes so than too very just also more most some any all each every other into out up down over under again once here there when where why how what which who whom whose about above below between through during before after get got make made use used using new one two three per via etc into onto off out").split(
    /\s+/,
  ),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 24 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** Rough syllable count for Flesch (vowel-group heuristic). */
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/e$/, "")
    .match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch Reading Ease over a text blob. Higher = easier (60–70 = plain). */
function fleschScore(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 20) return 100; // too short to judge → treat as fine
  // Sentence terminators are lost when nav/lists/specs are tag-stripped, which
  // inflates words-per-sentence. Floor sentences at words/25 so structured
  // (list/heading-heavy) pages aren't falsely scored as unreadable.
  const punct = (text.match(/[.!?]+/g) ?? []).length;
  const sentences = Math.max(1, punct, Math.round(words.length / 25));
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  const wps = words.length / sentences;
  const spw = syl / words.length;
  return Math.round(206.835 - 1.015 * wps - 84.6 * spw);
}

export interface PageIntel {
  path: string;
  /** The page's real topic terms, strongest first. */
  topTerms: { term: string; tfidf: number }[];
  /** Flesch Reading Ease. */
  readability: number;
  /** Over-dense terms (likely keyword stuffing). */
  stuffed: { term: string; density: number }[];
  wordCount: number;
  titleAndH1: string;
}

export interface ContentIntel {
  perPage: Map<string, PageIntel>;
}

/**
 * Compute TF-IDF topics, readability and stuffing per page over the corpus.
 */
export function analyzeContentIntel(pages: CrawledPage[], startUrl: string): ContentIntel {
  const ok = pages.filter((p) => p.statusCode >= 200 && p.statusCode < 300 && p.wordCount > 0);
  const perPage = new Map<string, PageIntel>();
  if (ok.length === 0) return { perPage };

  // Document frequency across the corpus.
  const tokensByPage = ok.map((p) => tokenize(p.textContent));
  const df = new Map<string, number>();
  tokensByPage.forEach((toks) => {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  });
  const N = ok.length;

  ok.forEach((p, i) => {
    const toks = tokensByPage[i]!;
    const total = toks.length || 1;
    // Density MUST use the raw visible word count, not the stopword-filtered
    // token count (which is ~half), otherwise "% of the text" is inflated ~2×
    // and short focused pages get false stuffing flags.
    const rawWords = Math.max(total, p.wordCount);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);

    // TF-IDF top terms (uses filtered tokens for relevance — that's correct).
    const scored = [...tf.entries()].map(([term, count]) => {
      const idf = Math.log((N + 1) / ((df.get(term) ?? 0) + 1)) + 1;
      return { term, tfidf: (count / total) * idf, count };
    });
    scored.sort((a, b) => b.tfidf - a.tfidf);
    const topTerms = scored.slice(0, 8).map(({ term, tfidf }) => ({ term, tfidf: Math.round(tfidf * 1000) / 1000 }));

    // Keyword stuffing: single term at very high density of the REAL text.
    // Conservative (>6% of raw words, ≥6 occurrences, page ≥300 words) so
    // short/brand-focused pages aren't flagged.
    const stuffed =
      p.wordCount >= 300
        ? scored
            .filter(({ count }) => count >= 6 && count / rawWords > 0.06)
            .map(({ term, count }) => ({ term, density: Math.round((count / rawWords) * 1000) / 10 }))
            .slice(0, 5)
        : [];

    const path = normalizePath(p.url, startUrl) ?? p.url;
    perPage.set(path, {
      path,
      topTerms,
      readability: fleschScore(p.textContent),
      stuffed,
      wordCount: p.wordCount,
      titleAndH1: `${p.title ?? ""} ${p.h1s.join(" ")}`.toLowerCase(),
    });
  });

  return { perPage };
}
