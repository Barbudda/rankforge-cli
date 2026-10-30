/**
 * RAG corpus for the support chatbot — Septune has no human support, so
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
import { RULE_PAGES } from "@/lib/audit/rule-docs";
import { FIXABLE_RULE_IDS } from "@/lib/audit/deterministic-fix";
import { AUTONOMY_LEVELS } from "@/lib/agent";
import { BILLING_NOTE, PRICING_TIERS, ROADMAP } from "@/lib/pricing";
import {
  CHANGELOG,
  FAQS,
  FRAMEWORK_PAGES,
  PRICING_FAQS,
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
      title: "What Septune does",
      text: "Septune checks a site's technical SEO at the three moments it breaks: in your editor before you push (the open-source CLI or the Claude Code plugin), on every pull request (a GitHub Action that compares the preview with production, comments the result and fails the check when pages would leave search), and in production (scheduled checks with email, Slack, Discord or webhook alerts). Measurements are deterministic and every finding cites its evidence. Septune never writes to your repository and never promises Google rankings.",
      url: "/",
    },
    {
      id: "how-it-works",
      title: "How it works (three checkpoints)",
      text: "1) Before you push: run npx septune audit http://localhost:3000, or install the Claude Code plugin (/plugin marketplace add Barbudda/septune, then /plugin install septune@septune) so your assistant audits and fixes. 2) In the pull request: add the GitHub Action Barbudda/septune with your preview URL and baseline-url set to production; it comments the changes on the pull request and fails it on critical regressions. 3) In production: sign up, add your site and turn on monitoring. 4) Fix from the evidence: every finding lists the affected URLs and likely files, and mechanical ones have a ready patch (septune fix <ruleId>).",
      url: "/#how-it-works",
    },
    {
      id: "security",
      title: "Security model",
      text: "Septune only reads rendered pages, like any crawler, and honours robots.txt. It never writes to your repository: fixes reach your code through your own pull requests. The CLI and the editor agent run on your machine and send nothing to Septune; the GitHub Action uses the job's token only to comment on the pull request; hosted monitoring fetches your public pages. It never reads your source code or environment secrets, and every monitoring check is kept with what changed.",
      url: "/#security",
    },
    {
      id: "contact",
      title: "Contact & account deletion",
      text: `Septune support is self-serve through this assistant. For anything it can't answer, such as account deletion, GDPR requests (access, rectification, erasure), billing questions or enterprise/self-host discussions, email ${CONTACT} from your account address.`,
      url: "/privacy",
    },
    {
      id: "privacy",
      title: "Privacy (what is stored)",
      text: "Septune stores: your email and a password hash (via Supabase Auth; the plain password is never seen); for each site, its name, the production URL you provide and the audits and issues generated for it; and with monitoring on, the alert address, the webhook URL and a record of each check, kept 3, 12 or 24 months depending on the plan. Processors: Supabase (database, sign-in), Vercel (hosting), Stripe (payments; it holds card details, Septune keeps only the customer id and subscription status), Resend (alert emails), Anthropic (optional analysis), Google (the site URL, only when Core Web Vitals are on). No ad trackers, no data resale. Row-level security means each account only reads its own rows. Deletion on request by email.",
      url: "/privacy",
    },
    {
      id: "terms",
      title: "Terms (short version)",
      text: "Use Septune on sites you are authorized to audit. It reads public pages and never writes to your repositories; any change to your code is yours to make and merge. The product is early-stage: paid plans can only be pre-ordered until payments open, features may change, monitoring alerts are best effort, and you remain responsible for reviewing every change. No search-ranking outcomes are promised.",
      url: "/terms",
    },
  );

  // ── Autonomy / modification levels ─────────────────────────────
  chunks.push({
    id: "autonomy",
    title: "Modification levels",
    text:
      "In the hosted app, each repository has a modification level that sets how far Septune prepares a fix: " +
      AUTONOMY_LEVELS.map((l) => `${l.step}. ${l.label}: ${l.description}`).join(" ") +
      " Prepared pull requests stay in Septune for review: nothing is pushed to GitHub yet. To apply a fix today, use the patch or your AI editor.",
    url: "/#security",
  });

  // ── Every check of the engine (one docs page each) ─────────────
  for (const rule of RULE_PAGES) {
    chunks.push({
      id: `rule:${rule.id}`,
      title: rule.title,
      text: `${rule.title} (ruleId ${rule.id}, category: ${rule.category}, impact: ${rule.impact}). ${rule.summary} What Septune measures: ${rule.measured} Fix: ${rule.fix} ${
        FIXABLE_RULE_IDS.includes(rule.id)
          ? "Septune generates a patch for this check (septune fix or the get_fix_template tool); you or your AI editor apply it."
          : "This check is reported with the affected pages and the evidence; the fix needs a human decision."
      }`,
      url: `/docs/issues/${rule.id}`,
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
      text: `${t.name} plan. ${t.tagline} Price: €${t.priceMonthly}/month. Monitoring: ${t.limits.sites} site${t.limits.sites > 1 ? "s" : ""}, checked ${t.limits.frequency}, up to ${t.limits.pages} pages per check, ${t.limits.webhooks ? "email, Slack, Discord or webhook alerts" : "email alerts"}, ${t.limits.historyMonths} months of history. Includes: ${t.features.join("; ")}. ${BILLING_NOTE}`,
      url: "/pricing",
    });
  }
  chunks.push({
    id: "tier:roadmap",
    title: "What's not available yet",
    text: `Planned, not built yet: ${ROADMAP.join("; ")}. Septune doesn't offer SSO, self-hosting or team seats today.`,
    url: "/pricing",
  });

  // ── Framework guides ───────────────────────────────────────────
  for (const fw of FRAMEWORK_PAGES) {
    chunks.push({
      id: `fw:${fw.slug}`,
      title: `Technical SEO for ${fw.name}`,
      text: `${fw.name} support: ${fw.blurb} Metadata is handled through ${fw.metaApi}. Mechanical fixes come as ready patches written for ${fw.name}.`,
      url: `/frameworks/${fw.slug}`,
    });
  }

  // ── Changelog (freshness questions: "what's new?") ─────────────
  chunks.push({
    id: "changelog",
    title: "What's new (changelog)",
    text:
      "What's new in Septune: the latest release notes, recent updates and shipped features, newest first. " +
      CHANGELOG.map((e) => `${e.date}, ${e.title}: ${e.notes.join(" ")}`).join(" | "),
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
