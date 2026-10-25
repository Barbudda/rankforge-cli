/**
 * Shared content taxonomy for the marketing docs & framework pages.
 * Everything derives from the audit engine's rule catalog (SEO_RULES) so
 * the public docs and the detector can never drift apart — and the sitemap
 * imports from here so no page is ever missing from it.
 */
import { SEO_RULES } from "@/lib/audit/rules";
import type { SeoRule } from "@/lib/audit/types";
import { RULE_CATALOG } from "@/lib/audit/catalog";
import { BILLING_OPEN } from "@/lib/pricing";

/** URL slug for a rule: "meta.title.missing" → "meta-title-missing". */
export function ruleSlug(id: string): string {
  return id.replace(/\./g, "-");
}

export function getRuleBySlug(slug: string): SeoRule | undefined {
  return SEO_RULES.find((r) => ruleSlug(r.id) === slug);
}

export const DOC_RULES = SEO_RULES;

export type FrameworkPage = {
  slug: string;
  name: string;
  blurb: string;
  metaApi: string;
};

/** Framework landing pages — slugs match the footer links. */
export const FRAMEWORK_PAGES: FrameworkPage[] = [
  {
    slug: "nextjs",
    name: "Next.js",
    blurb:
      "App Router metadata, generateMetadata on dynamic routes, sitemap.ts and robots.ts conventions. Septune points each rendered issue at the route file most likely behind it.",
    metaApi: "generateMetadata / metadata export",
  },
  {
    slug: "nuxt",
    name: "Nuxt",
    blurb:
      "useSeoMeta and useHead usage, server-rendered meta parity, and Nitro-generated sitemaps, with each issue pointed at the page or composable most likely behind it.",
    metaApi: "useSeoMeta / useHead",
  },
  {
    slug: "astro",
    name: "Astro",
    blurb:
      "Frontmatter-driven meta, content-collection pages and Astro's static output. Each issue points at the .astro layout or collection most likely behind it.",
    metaApi: "frontmatter + <head> in layouts",
  },
  {
    slug: "sveltekit",
    name: "SvelteKit",
    blurb:
      "svelte:head management, +page load metadata and prerendered routes; each issue points at the +page.svelte or layout file most likely behind it.",
    metaApi: "<svelte:head> / load data",
  },
];

export function getFramework(slug: string): FrameworkPage | undefined {
  return FRAMEWORK_PAGES.find((f) => f.slug === slug);
}

/** Rules relevant to a framework (tagged rules + all untagged generic ones). */
export function rulesForFramework(slug: string): SeoRule[] {
  return SEO_RULES.filter(
    (r) => !r.frameworks || (r.frameworks as readonly string[]).includes(slug),
  );
}

/**
 * FAQ content — single source for the visible FAQ sections, the FAQPage
 * JSON-LD, and the support chatbot's RAG corpus. Pure data: safe to import
 * from server routes, pages and components alike.
 */
export const FAQS = [
  {
    q: "What does Septune actually do?",
    a: "It checks your site's technical SEO at the three moments it breaks: in your editor before you push (the CLI or the Claude Code plugin), on every pull request (a GitHub Action that compares the preview with production and comments the result), and in production (scheduled checks with alerts). The measurements are deterministic: no AI guesses, and every finding cites its evidence.",
  },
  {
    q: "Does Septune replace SEO experts?",
    a: "No. It catches the technical breakage that slips through code review: noindex, canonicals, robots.txt, sitemaps, structured data. Strategy, content and links stay with people.",
  },
  {
    q: "Which frameworks are supported?",
    a: "Any site that serves HTML can be audited. Ready patches are written for Next.js, Nuxt, Astro, SvelteKit, Remix, Vite + React, MDX and static sites, with the deepest support for Next.js.",
  },
  {
    q: "Can Septune change my code or my main branch?",
    a: "No. Septune never writes to your repository. It reads your rendered pages; fixes reach your code through your own pull requests, written by you or your AI editor.",
  },
  {
    q: "Does it need access to my repository?",
    a: "No. The CLI and the editor agent run on your machine, the GitHub Action runs in your own CI and uses the job's token only to comment on the pull request, and the hosted monitoring only fetches your public pages.",
  },
  {
    q: "How does the pull-request check work?",
    a: "Add the GitHub Action with your preview URL and your production URL. On every push it audits both, matches pages by path and comments the changes on the pull request. It fails the check when pages would leave search: a new noindex, pages that start failing, robots.txt blocking Google. Differences that only come from the preview environment, like its noindex header, are listed apart and never fail it.",
  },
  {
    q: "What does monitoring watch?",
    a: "noindex, robots.txt, canonicals, pages that start failing or redirecting, the sitemap, the HTTPS certificate and the Core Web Vitals of real users. Each check is compared with the previous one, and you're alerted by email, Slack, Discord or webhook when something critical changes.",
  },
  {
    q: "What kinds of SEO issues does Septune find?",
    a: `${RULE_CATALOG.length} checks: metadata (titles, descriptions, OpenGraph), indexing (noindex, canonicals, hreflang, soft 404s, robots.txt, sitemaps, HTTPS), page structure, images, structured data against Google's required properties, internal linking, performance and Core Web Vitals, plus 12 AI-search readiness checks.`,
  },
  {
    q: "How is Septune different from Screaming Frog or Ahrefs?",
    a: "Crawlers and SEO suites audit what is already live. Septune runs its checks before a change ships, on localhost and on the preview of every pull request compared with production, then keeps watching production. It doesn't do backlinks, rankings or keyword data, which need a search index Septune doesn't have.",
  },
  {
    q: "Does it work with GitLab or Bitbucket?",
    a: "The CLI works in any CI: npx septune diff <production> <preview> exits 1 on a critical regression and can write a Markdown summary. The pull-request comment is built for GitHub today.",
  },
  {
    q: "Will this improve my Google rankings?",
    a: "No tool can honestly promise rankings, and Septune doesn't. It keeps the technical layer working so your pages can be crawled, rendered and indexed correctly, which is the part of SEO your code controls.",
  },
  {
    q: "Does it support agencies?",
    a: "Yes, on the Studio plan: 25 monitored sites, an alert address and webhook per client, and white-label HTML reports with your name and colour. Scheduled client reports are on the roadmap.",
  },
  {
    q: "Does it work with monorepos?",
    a: "Yes. Septune audits URLs, not repositories: point it at the app's preview and production URLs wherever its code lives.",
  },
  {
    q: "Are the patches safe to apply?",
    a: "Mechanical patches (robots.txt, sitemap, canonical, viewport, lang, JSON-LD, OpenGraph) are written for your framework and come with notes on what to adapt. Apply them on a branch and let the pull-request check confirm the issue cleared and nothing else broke.",
  },
  {
    q: "Can I try Septune without an account?",
    a: "Yes. The free audit at /audit crawls 3 pages of any public URL and shows every measured issue with evidence, no signup. For unlimited audits (including localhost) use the open-source CLI: npx septune audit <url>.",
  },
  {
    q: "Can I use Septune from my editor?",
    a: "Yes. Install the Claude Code plugin, or connect the MCP server to Cursor, VS Code or any MCP-capable assistant. Your coding agent audits localhost or production, pulls fix templates, patches the repository it already has open, and compares the result with production. See the guide at /docs/agent.",
  },
];

/** Pricing-specific FAQ — rendered and marked up on /pricing only. */
export const PRICING_FAQS = [
  {
    q: "What do I pay for, exactly?",
    a: "For Septune watching your production sites on its own: a check every day, and an alert the moment a deploy makes a page noindex, blocks Google in robots.txt, breaks a canonical, takes a page down or lets the HTTPS certificate expire. Audits from the CLI and your editor are free and unlimited.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes, and it isn't a trial: the CLI, the editor agent, the CI regression gate and white-label reports are free for good, plus monitoring of one site every week.",
  },
  {
    q: "What happens when a site has more pages than my plan crawls?",
    a: "The check covers the pages it can reach within the limit, linked pages first, and says the crawl stopped at the limit so a result is never presented as complete when it isn't.",
  },
  {
    q: "Can I cancel anytime?",
    a: BILLING_OPEN
      ? "Yes. Plans are monthly with no lock-in: cancel from the billing portal and your plan runs until the end of the month you paid for. After a downgrade, your check history stays readable within the new plan's window (3 months on Free)."
      : "Yes. Plans will be monthly with no lock-in. After a downgrade, your check history stays readable within the new plan's window (3 months on Free).",
  },
  {
    q: "Is billing open?",
    a: BILLING_OPEN
      ? "Yes. Pro and Studio are paid monthly by card through Stripe, and Free stays free. Invoices and receipts are in the billing portal."
      : "Not yet. Pre-order Pro or Studio and we'll email you the day it opens; a pre-order is only an email address, and nothing is charged before you check out. The free plan works today.",
  },
];

export type ChangelogEntry = { date: string; title: string; notes: string[] };

/** Newest first. Dates also drive sitemap lastModified for content routes. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-10-25",
    title: "RankForge is now Septune",
    notes: [
      "Same product, new name. The CLI is now npx septune, the GitHub Action Barbudda/septune and the Claude Code plugin septune.",
      "The rankforge-cli package stays installable at 0.2.0 but won't get updates: switch to septune for everything since.",
    ],
  },
  {
    date: "2026-10-25",
    title: "Monitoring, regression gates and a crawler that reads sites like Google",
    notes: [
      "Monitoring: Septune checks your production site on a schedule and alerts you by email, Slack, Discord or webhook when a page starts failing, turns noindex, gets blocked by robots.txt, or when the sitemap or the HTTPS certificate breaks.",
      "septune diff and watch compare two versions of a site, page by page, and exit 1 on critical changes. The GitHub Action takes a baseline-url to gate pull requests: preview against production.",
      "Crawler: sitemap-seeded, up to 500 pages, robots.txt read the way Googlebot reads it, X-Robots-Tag headers, hreflang, canonical targets, soft 404s, sitemap hygiene and certificate checks.",
      "Core Web Vitals of real users from Google's Chrome UX Report, and 21 AI crawlers checked for AI-search access.",
      "A Claude Code plugin with the MCP tools and two skills, and a compare_sites tool for your editor.",
      "The GitHub Action comments the result on the pull request, in one comment updated on every push.",
    ],
  },
  {
    date: "2026-09-21",
    title: "Open-source CLI + free audit page",
    notes: [
      "npx rankforge-cli audit <url>: the deterministic engine as a zero-dependency terminal CLI, MIT licensed, with a GitHub Action for CI gates (--fail-under).",
      "A free, no-signup audit at /audit: 3 pages, every issue measured with evidence, nothing stored.",
      "Engine: crawled pages are deduplicated by final URL so a redirect target is never reported twice.",
    ],
  },
  {
    date: "2026-07-06",
    title: "The RankForge agent in your editor (MCP)",
    notes: [
      "RankForge now ships as an MCP server at /api/mcp. Connect it to Claude Code, Cursor, VS Code or any MCP client.",
      "Your coding assistant runs the deterministic audit against localhost or production, gets fix templates, and patches the repo it already has open.",
      "Deterministic audit engine: measured image weights, real link statuses, internal link graph and content analysis, with no LLM required.",
    ],
  },
  {
    date: "2026-07-04",
    title: "Site-wide review pass",
    notes: [
      "Docs pages for every audit rule, framework guides, and this changelog.",
      "Security hardening: stricter headers, safer redirects, server-side auth checks.",
      "Performance: lighter middleware, faster first paint on the landing page.",
    ],
  },
  {
    date: "2026-06-29",
    title: "Interactive dot systems",
    notes: [
      "Living crawler swarm, dotted flow-field currents and a symptom→cause web across the landing page.",
      "Full prefers-reduced-motion support with settled static compositions.",
    ],
  },
  {
    date: "2026-06-28",
    title: "Agent swarms + brain",
    notes: [
      "In-app audit and fix swarms powered by the Anthropic API.",
      "Self-contained semantic memory (local embeddings + Supabase) that grounds audits, fixes and chat.",
    ],
  },
  {
    date: "2026-06-27",
    title: "Supabase accounts",
    notes: [
      "Email + password auth, per-user data with row-level security, settings persistence.",
    ],
  },
];
