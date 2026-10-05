/**
 * RAG corpus for the support chatbot — RankForge has no human support, so
 * this assistant must be able to answer "plein de choses" accurately.
 *
 * The corpus is assembled from the SAME single sources of truth as the site
 * itself (rules catalog, FAQs, pricing tiers, autonomy ladder, framework
 * pages, changelog, security/legal copy), so the bot can never drift from
 * the product. Chunks are embedded once per server process with the brain's
 * local vectorizer (no API, no model download) and retrieved by cosine
 * similarity. Server-only: never import from client components.
 */
import { embed, cosine } from "@/lib/brain/embed";
import { SEO_RULES } from "@/lib/audit/rules";
import { AUTONOMY_LEVELS } from "@/lib/agent";
import { PRICING_TIERS } from "@/lib/pricing";
import {
  CHANGELOG,
  FAQS,
  FRAMEWORK_PAGES,
  PRICING_FAQS,
  ruleSlug,
} from "@/lib/seo/content";

export interface CorpusChunk {
  id: string;
  /** Short human title (shown as the source label in the widget). */
  title: string;
  /** The text the bot grounds on / answers with. */
  text: string;
  /** Where to read more (internal path). */
  url: string;
}

export interface RetrievedChunk extends CorpusChunk {
  score: number;
}

const CONTACT = "hugopoene74@gmail.com";

function buildChunks(): CorpusChunk[] {
  const chunks: CorpusChunk[] = [];

  // ── Product basics ─────────────────────────────────────────────
  chunks.push(
    {
      id: "about",
      title: "What RankForge does",
      text: "RankForge is a technical-SEO agent for GitHub repositories. It crawls your rendered site like a browser, detects technical SEO issues, maps each one back to the source file that causes it, and opens small, reviewable pull requests that fix it. It never commits to your main branch and never promises Google rankings — it fixes the technical layer your repository controls.",
      url: "/",
    },
    {
      id: "how-it-works",
      title: "How it works (5 steps)",
      text: "1) Install the GitHub App — read-only by default, you pick the repos. 2) Add a production or staging URL; RankForge crawls the rendered output. 3) Run an audit — each issue is scored by impact, effort and risk, then prioritized. 4) Review the diffs: every issue links to the files it touches and a ready patch. 5) Merge the pull requests — you stay in control of every merge.",
      url: "/#how-it-works",
    },
    {
      id: "security",
      title: "Security model",
      text: "Read-only by default. Write access is optional and scoped to RankForge's own branches — it can never touch protected branches. Never a direct commit or merge to main: every change arrives as a pull request a human reviews. RankForge reads your source and rendered HTML, never your environment secrets. Every action is logged and you can disable the agent at any time. Enterprise adds self-hosting and SSO/SAML.",
      url: "/#security",
    },
    {
      id: "contact",
      title: "Contact & account deletion",
      text: `RankForge support is self-serve through this assistant. For anything it can't answer — account deletion, GDPR requests (access, rectification, erasure), billing questions or enterprise/self-host discussions — email ${CONTACT} from your account address.`,
      url: "/privacy",
    },
    {
      id: "privacy",
      title: "Privacy (what is stored)",
      text: "RankForge stores: your email and a password hash (via Supabase Auth — the plain password is never seen), and for each connected repository its name, the production URL you provide, plus the audits, issues and pull-request metadata generated for it. No ad trackers, no data resale. Data lives in Postgres with row-level security so each account only reads its own rows. Deletion on request by email.",
      url: "/privacy",
    },
    {
      id: "terms",
      title: "Terms (short version)",
      text: "Use RankForge on sites and repositories you are authorized to audit. Fixes only ever arrive as pull requests on RankForge's own branches; merging is always your decision. The product is an MVP: pricing shown is a placeholder, features may change, and you remain responsible for reviewing every PR before merging. No search-ranking outcomes are promised.",
      url: "/terms",
    },
  );

  // ── Autonomy / modification levels ─────────────────────────────
  chunks.push({
    id: "autonomy",
    title: "Modification levels",
    text:
      "RankForge's autonomy is a 5-step ladder you set per repository (it overrides the workspace default): " +
      AUTONOMY_LEVELS.map((l) => `${l.step}. ${l.label} — ${l.description}`).join(" ") +
      " Even at Autopilot, changes still arrive as pull requests you review — RankForge never force-pushes to your default branch.",
    url: "/#security",
  });

  // ── Every detected issue class (15 docs pages) ─────────────────
  for (const rule of SEO_RULES) {
    chunks.push({
      id: `rule:${rule.id}`,
      title: rule.title,
      text: `${rule.title} (category: ${rule.category}). ${rule.description} Default impact: ${rule.defaultImpact}, effort: ${rule.defaultEffort}, risk: ${rule.defaultRisk}. ${
        rule.canAutoFix
          ? "RankForge can fix this automatically: it opens a small, reviewable pull request with the patch, its expected impact and a validation checklist."
          : "This class of issue is reported with affected pages and concrete guidance — it needs a human decision rather than an automatic patch."
      }${rule.frameworks?.length ? ` Tailored fixes exist for: ${rule.frameworks.join(", ")}.` : ""}`,
      url: `/docs/issues/${ruleSlug(rule.id)}`,
    });
  }

  // ── FAQs (general + pricing) ───────────────────────────────────
  for (const [i, f] of FAQS.entries()) {
    chunks.push({ id: `faq:${i}`, title: f.q, text: `${f.q} ${f.a}`, url: "/#faq" });
  }
  for (const [i, f] of PRICING_FAQS.entries()) {
    chunks.push({ id: `pfaq:${i}`, title: f.q, text: `${f.q} ${f.a}`, url: "/pricing" });
  }

  // ── Pricing tiers ──────────────────────────────────────────────
  for (const t of PRICING_TIERS) {
    chunks.push({
      id: `tier:${t.id}`,
      title: `${t.name} plan`,
      text: `${t.name} plan — ${t.tagline} Price: ${
        t.priceMonthly === null ? "custom (contact us)" : `€${t.priceMonthly}/month`
      }. Limits: ${t.limits.repos}, ${t.limits.audits}, ${t.limits.prs}. Includes: ${t.features.join(", ")}. Note: prices are placeholders while RankForge is an MVP; the first audit is free on every plan, no credit card required.`,
      url: "/pricing",
    });
  }

  // ── Framework guides ───────────────────────────────────────────
  for (const fw of FRAMEWORK_PAGES) {
    chunks.push({
      id: `fw:${fw.slug}`,
      title: `Technical SEO for ${fw.name}`,
      text: `${fw.name} support: ${fw.blurb} Metadata is handled through ${fw.metaApi}. RankForge maps rendered issues back to the exact file and opens pull requests with framework-idiomatic fixes.`,
      url: `/frameworks/${fw.slug}`,
    });
  }

  // ── Changelog (freshness questions: "what's new?") ─────────────
  chunks.push({
    id: "changelog",
    title: "What's new (changelog)",
    text:
      "What's new in RankForge — the latest release notes, recent updates and shipped features, newest first: " +
      CHANGELOG.map((e) => `${e.date} — ${e.title}: ${e.notes.join(" ")}`).join(" | "),
    url: "/changelog",
  });

  return chunks;
}

// Embeddings computed once per server process (a few dozen chunks, local
// vectorizer — milliseconds). Lazy so cold paths never pay for it.
let indexed: { chunk: CorpusChunk; vec: number[] }[] | null = null;

function getIndex() {
  indexed ??= buildChunks().map((chunk) => ({
    chunk,
    vec: embed(`${chunk.title}\n${chunk.text}`),
  }));
  return indexed;
}

/** Retrieve the most relevant corpus chunks for a user question. */
export function searchCorpus(
  query: string,
  opts?: { limit?: number; minScore?: number },
): RetrievedChunk[] {
  const q = query.trim();
  if (!q) return [];
  const limit = opts?.limit ?? 4;
  const minScore = opts?.minScore ?? 0.18;
  const qVec = embed(q);
  return getIndex()
    .map(({ chunk, vec }) => ({ ...chunk, score: cosine(qVec, vec) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
