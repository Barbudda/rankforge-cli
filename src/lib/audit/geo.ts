import type { CrawledPage } from "./types";

/**
 * GEO — "generative engine optimization" readiness, measured deterministically.
 *
 * Answer engines (ChatGPT search, Claude, Perplexity, Gemini, Copilot) can only
 * cite a page they are allowed to fetch, can read without running JavaScript,
 * and can extract a clear, attributable answer from. All three are checkable
 * from the outside — no LLM, no API, no guessing:
 *
 *   1. Access   — which AI crawlers robots.txt lets in (search vs. training)
 *   2. Readable — real server-rendered text, an llms.txt index
 *   3. Citable  — answer-shaped structure, schema, author, dates, hard facts
 *
 * What this does NOT claim: that any engine *will* cite you. That depends on
 * the engines; nobody outside them can measure it honestly. This measures the
 * part you control.
 */

export type GeoStatus = "pass" | "warn" | "fail";

export interface GeoCheck {
  id: string;
  group: "access" | "readable" | "citable";
  title: string;
  status: GeoStatus;
  detail: string;
  fix?: string;
  pages?: string[];
}

export interface AiBotAccess {
  bot: string;
  owner: string;
  /** "search" bots fetch pages to cite them in answers; "training" bots collect data for model training. */
  purpose: "search" | "training" | "both";
  allowed: boolean;
}

export interface GeoReport {
  score: number;
  checks: GeoCheck[];
  bots: AiBotAccess[];
}

export const AI_BOTS: Omit<AiBotAccess, "allowed">[] = [
  { bot: "OAI-SearchBot", owner: "OpenAI (ChatGPT search)", purpose: "search" },
  { bot: "ChatGPT-User", owner: "OpenAI (user-triggered browsing)", purpose: "search" },
  { bot: "GPTBot", owner: "OpenAI (training)", purpose: "training" },
  { bot: "Claude-SearchBot", owner: "Anthropic (Claude search)", purpose: "search" },
  { bot: "Claude-User", owner: "Anthropic (user-triggered fetch)", purpose: "search" },
  { bot: "ClaudeBot", owner: "Anthropic (training)", purpose: "training" },
  { bot: "PerplexityBot", owner: "Perplexity", purpose: "search" },
  { bot: "Perplexity-User", owner: "Perplexity (user-triggered)", purpose: "search" },
  { bot: "Google-Extended", owner: "Google (Gemini grounding & training)", purpose: "both" },
  { bot: "Bingbot", owner: "Microsoft (Bing + Copilot)", purpose: "both" },
  { bot: "Applebot-Extended", owner: "Apple Intelligence", purpose: "training" },
  { bot: "CCBot", owner: "Common Crawl (feeds many models)", purpose: "training" },
];

// ── robots.txt ───────────────────────────────────────────────────────
interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

function parseRobots(txt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (key === "disallow") current.rules.push({ allow: false, path: value });
      else if (key === "allow") current.rules.push({ allow: true, path: value });
    }
  }
  return groups;
}

/** Is `bot` allowed to fetch the site root under robots.txt (RFC 9309 semantics)? */
export function botAllowed(robotsTxt: string, bot: string, path = "/"): boolean {
  if (!robotsTxt.trim()) return true;
  const groups = parseRobots(robotsTxt);
  const name = bot.toLowerCase();
  // Most specific matching group: an exact/substring agent match beats "*".
  let group = groups.find((g) => g.agents.some((a) => a !== "*" && name.includes(a)));
  group ??= groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  // Longest matching rule wins; Allow wins ties. Empty Disallow allows all.
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.rules) {
    if (!r.path) continue;
    const pattern = r.path.replace(/\*/g, "").replace(/\$$/, "");
    if (path.startsWith(pattern)) {
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

// ── helpers ──────────────────────────────────────────────────────────
function jsonLdTypes(page: CrawledPage): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") out.push(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.push(x));
    if (Array.isArray(o["@graph"])) walk(o["@graph"]);
    for (const k of ["mainEntity", "author", "publisher"]) if (o[k]) walk(o[k]);
  };
  page.jsonLd.forEach(walk);
  return out;
}

function jsonLdHas(page: CrawledPage, key: string): boolean {
  return JSON.stringify(page.jsonLd).includes(`"${key}"`);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

const QUESTION_RE = /\?\s*$|^(how|what|why|when|where|which|who|can|does|is|are|should|do)\b/i;

// ── the audit ────────────────────────────────────────────────────────
export function runGeoAudit(
  pages: CrawledPage[],
  site: { robotsTxt?: string; hasLlmsTxt?: boolean },
): GeoReport {
  // Content checks only consider pages meant to be found: a noindex login or
  // checkout page isn't a citation candidate, so it must not drag the score.
  const ok = pages.filter(
    (p) => p.statusCode >= 200 && p.statusCode < 300 && !p.metaRobots?.includes("noindex"),
  );
  const checks: GeoCheck[] = [];
  const robots = site.robotsTxt ?? "";

  // 1) Access ────────────────────────────────────────────────────────
  const bots: AiBotAccess[] = AI_BOTS.map((b) => ({ ...b, allowed: botAllowed(robots, b.bot) }));
  const blockedSearch = bots.filter((b) => !b.allowed && b.purpose !== "training");
  const blockedTraining = bots.filter((b) => !b.allowed && b.purpose === "training");
  checks.push({
    id: "geo-ai-search-bots",
    group: "access",
    title: "AI search crawlers can reach your site",
    status: blockedSearch.length === 0 ? "pass" : "fail",
    detail:
      blockedSearch.length === 0
        ? "No AI search crawler is blocked by robots.txt."
        : `robots.txt blocks ${blockedSearch.map((b) => b.bot).join(", ")} — these engines can't fetch your pages to cite them.`,
    fix:
      blockedSearch.length === 0
        ? undefined
        : `Allow the search crawlers explicitly, e.g.:\n${blockedSearch.map((b) => `User-agent: ${b.bot}\nAllow: /`).join("\n\n")}`,
  });
  checks.push({
    id: "geo-ai-training-bots",
    group: "access",
    title: "AI training crawlers",
    // Blocking training is a legitimate choice — informational, never a fail.
    status: blockedTraining.length === 0 ? "pass" : "warn",
    detail:
      blockedTraining.length === 0
        ? "Training crawlers are allowed (your content can inform future models)."
        : `You block ${blockedTraining.map((b) => b.bot).join(", ")}. That's a valid choice; it only affects future model training, not live AI search citations.`,
  });

  // 2) Readable ──────────────────────────────────────────────────────
  checks.push({
    id: "geo-llms-txt",
    group: "readable",
    title: "llms.txt index",
    status: site.hasLlmsTxt ? "pass" : "warn",
    detail: site.hasLlmsTxt
      ? "/llms.txt is present."
      : "No /llms.txt. It's an emerging convention giving AI tools a clean map of your most important pages.",
    fix: site.hasLlmsTxt ? undefined : "Generate one: npx rankforge-cli llms <url> > public/llms.txt",
  });

  // AI crawlers mostly don't run JavaScript: a big HTML shell with almost no
  // text is invisible to them.
  const jsOnly = ok.filter((p) => p.wordCount < 80 && p.htmlBytes > 15_000);
  checks.push({
    id: "geo-server-rendered",
    group: "readable",
    title: "Content is in the HTML (no JavaScript needed)",
    status: jsOnly.length === 0 ? "pass" : jsOnly.length >= Math.ceil(ok.length / 2) ? "fail" : "warn",
    detail:
      jsOnly.length === 0
        ? "Every crawled page carries its text in the server HTML."
        : `${jsOnly.length} page(s) ship a large HTML shell with under 80 words of text — most AI crawlers don't execute JavaScript and see them as empty.`,
    fix: jsOnly.length ? "Server-render or prerender these routes (SSR/SSG) so the text is in the initial HTML." : undefined,
    pages: jsOnly.map((p) => pathOf(p.url)),
  });

  // 3) Citable ───────────────────────────────────────────────────────
  const types = ok.map((p) => ({ p, t: jsonLdTypes(p) }));
  const answerSchema = types.filter(({ t }) =>
    t.some((x) => /^(FAQPage|QAPage|HowTo|Article|BlogPosting|NewsArticle|TechArticle|Product|Recipe)$/.test(x)),
  );
  checks.push({
    id: "geo-answer-schema",
    group: "citable",
    title: "Answer-shaped structured data",
    status: answerSchema.length > 0 ? "pass" : "warn",
    detail:
      answerSchema.length > 0
        ? `${answerSchema.length}/${ok.length} page(s) declare FAQ/HowTo/Article/Product-type schema.`
        : "No page declares FAQ, HowTo, Article or Product schema — the types answer engines lean on to extract and attribute answers.",
    fix: answerSchema.length ? undefined : "Add FAQPage or Article JSON-LD to your key pages (rankforge fix schema-missing prints a starter).",
  });

  const orgPage = types.find(({ t }) => t.some((x) => x === "Organization" || x === "Person"));
  const hasSameAs = ok.some((p) => jsonLdHas(p, "sameAs"));
  checks.push({
    id: "geo-entity",
    group: "citable",
    title: "Clear entity identity (who is behind the site)",
    status: orgPage && hasSameAs ? "pass" : orgPage ? "warn" : "fail",
    detail: !orgPage
      ? "No Organization or Person schema — engines can't tie your content to a known entity."
      : hasSameAs
        ? "Organization/Person schema with sameAs links to your other profiles."
        : "Organization/Person schema found, but no sameAs links to your profiles (GitHub, LinkedIn, X…).",
    fix: orgPage && hasSameAs ? undefined : 'Add Organization JSON-LD with name, url, logo and "sameAs": [your profile URLs].',
  });

  const authored = ok.filter(
    (p) => jsonLdHas(p, "author") || /<meta[^>]+name=["']author["']/i.test(p.html) || /rel=["']author["']/i.test(p.html),
  );
  checks.push({
    id: "geo-authorship",
    group: "citable",
    title: "Authorship signals",
    status: authored.length > 0 ? "pass" : "warn",
    detail:
      authored.length > 0
        ? `${authored.length}/${ok.length} page(s) name an author.`
        : "No page names an author. Attributable content is easier for engines to trust and cite.",
    fix: authored.length ? undefined : 'Add "author" to your Article JSON-LD or a <meta name="author"> tag.',
  });

  const dated = ok.filter(
    (p) =>
      jsonLdHas(p, "dateModified") ||
      jsonLdHas(p, "datePublished") ||
      /article:(modified|published)_time/i.test(p.html) ||
      /<time[^>]+datetime=/i.test(p.html),
  );
  checks.push({
    id: "geo-freshness",
    group: "citable",
    title: "Freshness dates",
    status: dated.length > 0 ? "pass" : "warn",
    detail:
      dated.length > 0
        ? `${dated.length}/${ok.length} page(s) expose a published/modified date.`
        : "No machine-readable dates. Answer engines favour content they can tell is current.",
    fix: dated.length ? undefined : "Expose datePublished/dateModified in JSON-LD or a <time datetime> element.",
  });

  const headings = ok.flatMap((p) => p.headings.filter((h) => h.level >= 2 && h.level <= 3));
  const questions = headings.filter((h) => QUESTION_RE.test(h.text));
  checks.push({
    id: "geo-question-headings",
    group: "citable",
    title: "Question-style headings",
    status: questions.length >= 2 ? "pass" : "warn",
    detail:
      questions.length >= 2
        ? `${questions.length} headings are phrased the way people ask (how/what/why…).`
        : "Few or no headings match how people phrase questions to AI assistants.",
    fix: questions.length >= 2 ? undefined : "Phrase key H2/H3s as the questions your audience asks, each answered in the first sentence below it.",
  });

  const factPages = ok.filter((p) => (p.textContent.match(/\b\d+(?:[.,]\d+)?\s?(%|percent|x\b|ms\b|kb\b|€|\$|users|customers)/gi) ?? []).length >= 2);
  checks.push({
    id: "geo-facts",
    group: "citable",
    title: "Concrete, quotable facts",
    status: factPages.length > 0 ? "pass" : "warn",
    detail:
      factPages.length > 0
        ? `${factPages.length}/${ok.length} page(s) contain specific figures (percentages, amounts, measurements).`
        : "Little hard data in the text. Specific numbers are what engines quote.",
    fix: factPages.length ? undefined : "Back key claims with specific numbers, benchmarks or dated statistics.",
  });

  const described = ok.filter((p) => (p.metaDescription?.trim().length ?? 0) >= 50);
  checks.push({
    id: "geo-summaries",
    group: "citable",
    title: "Self-contained page summaries",
    status: described.length === ok.length && ok.length > 0 ? "pass" : described.length > 0 ? "warn" : "fail",
    detail: `${described.length}/${ok.length} page(s) have a meta description of 50+ characters — the one-line summary engines often reuse.`,
    pages: ok.filter((p) => !described.includes(p)).map((p) => pathOf(p.url)),
  });

  // Score: fail = 0, warn = 0.5, pass = 1; access counts double (no access, no citation).
  let total = 0;
  let got = 0;
  for (const c of checks) {
    const w = c.group === "access" && c.id === "geo-ai-search-bots" ? 3 : c.id === "geo-server-rendered" ? 2 : 1;
    total += w;
    got += w * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0);
  }
  return { score: Math.round((got / total) * 100), checks, bots };
}

// ── llms.txt generator ───────────────────────────────────────────────
/**
 * Build an llms.txt (https://llmstxt.org) from crawled pages: H1 site name,
 * a blockquote summary, then a link list of the pages with their descriptions.
 */
export function buildLlmsTxt(pages: CrawledPage[], startUrl: string): string {
  const ok = pages.filter((p) => p.statusCode >= 200 && p.statusCode < 300);
  const home = ok.find((p) => pathOf(p.url) === "/") ?? ok[0];
  let host = startUrl;
  try {
    host = new URL(startUrl).hostname;
  } catch {
    /* keep raw */
  }
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  // Site name: og:site_name, else the title suffix most pages share
  // ("Pricing | Acme", "Blog | Acme" → "Acme"), else the home title's head.
  const SEP = /\s[|·—–-]\s/;
  const suffixCount = new Map<string, number>();
  for (const p of ok) {
    const parts = clean(p.title).split(SEP);
    if (parts.length > 1) {
      const last = parts[parts.length - 1]!;
      suffixCount.set(last, (suffixCount.get(last) ?? 0) + 1);
    }
  }
  const shared = [...suffixCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const siteName =
    clean(home?.og?.["og:site_name"]) ||
    (shared && shared[1] >= 2 ? shared[0] : "") ||
    clean(home?.title?.split(SEP)[0]) ||
    host;
  const summary = clean(home?.metaDescription) || clean(home?.textContent?.slice(0, 200));

  const lines = [`# ${siteName}`, ""];
  if (summary) lines.push(`> ${summary}`, "");
  lines.push("## Pages", "");
  const seen = new Set<string>();
  for (const p of ok) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    if (p.metaRobots?.includes("noindex")) continue;
    // Drop the repeated " · Site" / " | Site" / " — Site" suffix.
    const raw = clean(p.title);
    const parts = raw.split(SEP);
    const title =
      (parts.length > 1 && parts[parts.length - 1]!.toLowerCase() === siteName.toLowerCase()
        ? parts.slice(0, -1).join(" — ")
        : raw) || pathOf(p.url);
    const desc = clean(p.metaDescription);
    lines.push(`- [${title}](${p.url})${desc ? `: ${desc}` : ""}`);
  }
  lines.push("");
  return lines.join("\n");
}
