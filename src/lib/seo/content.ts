/**
 * Shared content taxonomy for the marketing docs & framework pages.
 * Everything derives from the audit engine's rule catalog (SEO_RULES) so
 * the public docs and the detector can never drift apart — and the sitemap
 * imports from here so no page is ever missing from it.
 */
import { SEO_RULES } from "@/lib/audit/rules";
import type { SeoRule } from "@/lib/audit/types";

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
      "App Router metadata, generateMetadata on dynamic routes, sitemap.ts and robots.ts conventions — RankForge maps rendered issues back to the exact route file.",
    metaApi: "generateMetadata / metadata export",
  },
  {
    slug: "nuxt",
    name: "Nuxt",
    blurb:
      "useSeoMeta and useHead usage, server-rendered meta parity, and Nitro-generated sitemaps — issues map back to pages and composables.",
    metaApi: "useSeoMeta / useHead",
  },
  {
    slug: "astro",
    name: "Astro",
    blurb:
      "Frontmatter-driven meta, content-collection pages and Astro's static output — issues map back to .astro layouts and collections.",
    metaApi: "frontmatter + <head> in layouts",
  },
  {
    slug: "sveltekit",
    name: "SvelteKit",
    blurb:
      "svelte:head management, +page load metadata and prerendered routes — issues map back to +page.svelte and layout files.",
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
    q: "Does RankForge replace SEO experts?",
    a: "No. It removes the manual, mechanical part. Experts still set strategy and review the PRs; RankForge just turns those decisions into code in minutes instead of sprints.",
  },
  {
    q: "Which frameworks are supported?",
    a: "Next.js, Nuxt, Astro, SvelteKit, Remix, Vite + React, MDX and static sites. Next.js, Nuxt, Astro and MDX have the deepest framework-aware fixes today.",
  },
  {
    q: "Can it modify my main branch?",
    a: "Never directly. RankForge only ever pushes to its own branches and opens pull requests. Nothing reaches main without a human merge.",
  },
  {
    q: "Does it need write access?",
    a: "It is read-only by default. Write access is optional and scoped to RankForge's own branches. It can't touch protected branches or your secrets.",
  },
  {
    q: "Can I review every change?",
    a: "Yes. Every fix is a small, reviewable diff that comes with an explanation, the expected impact, and steps to validate it. You stay in control of every merge.",
  },
  {
    q: "What kinds of SEO issues does RankForge fix?",
    a: "Metadata (titles, descriptions, OpenGraph), indexing (canonicals, sitemaps, robots), page structure, image alt text, structured data and schema, internal linking, performance signals, and framework-specific fixes like generateMetadata usage.",
  },
  {
    q: "How is RankForge different from Screaming Frog or Ahrefs?",
    a: "Crawlers and audit suites report issues. RankForge maps each issue to the source file in your repository and opens the pull request that fixes it, so the finding and the fix arrive together.",
  },
  {
    q: "Does it work with GitLab or Bitbucket?",
    a: "GitHub only today, via the RankForge GitHub App. Repositories on other hosts can still be crawled and audited, but PR creation requires GitHub.",
  },
  {
    q: "Will this improve my Google rankings?",
    a: "No tool can honestly promise rankings, and RankForge doesn't. It fixes the technical layer so your pages can be crawled, rendered, and indexed correctly, which is the part of SEO a repository controls.",
  },
  {
    q: "Does it support agencies?",
    a: "The Agency plan adds multi-tenant client workspaces, per-client reporting and role-based access so you can manage many sites from one dashboard.",
  },
  {
    q: "Does it work with monorepos?",
    a: "Yes. You can point RankForge at the app within a monorepo, and it scopes its file mapping and PRs to the right package.",
  },
  {
    q: "What happens if a fix is risky?",
    a: "Every issue carries a risk score. Low-risk fixes arrive as ready-to-review PRs; higher-risk ones are opened as draft PRs or kept as suggestions. Either way, nothing merges without your approval.",
  },
  {
    q: "Can I try RankForge without an account?",
    a: "Yes. The free audit at /audit crawls 3 pages of any public URL and shows every measured issue with evidence, no signup. For unlimited audits (including localhost) use the open-source CLI: npx rankforge-cli audit <url>.",
  },
  {
    q: "Can I use RankForge from my editor?",
    a: "Yes. RankForge ships as an MCP server: connect it to Claude Code, Cursor, VS Code or any MCP-capable assistant and your coding agent can run the full deterministic audit against localhost or production, pull fix templates, and patch the repository it already has open. See the guide at /docs/agent.",
  },
];

/** Pricing-specific FAQ — rendered and marked up on /pricing only. */
export const PRICING_FAQS = [
  {
    q: "Is there a free tier?",
    a: "Your first audit is free on every plan and no credit card is required to run it. Paid plans start when RankForge begins opening pull requests for you on a schedule.",
  },
  {
    q: "What counts toward the monthly PR limit?",
    a: "Only pull requests RankForge actually opens. Audits, issue detection and fix previews are unlimited on every paid plan.",
  },
  {
    q: "What happens when I hit the crawl page limit?",
    a: "The audit completes on the pages already crawled and tells you what was skipped. Upgrade or narrow the crawl scope to cover larger sites.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Plans are monthly with no lock-in. Your connected repos and audit history stay readable after downgrade.",
  },
  {
    q: "Are these prices final?",
    a: "Prices are placeholders while RankForge is an MVP, as noted below the tiers. Early users will be grandfathered on their plan when pricing is finalized.",
  },
];

export type ChangelogEntry = { date: string; title: string; notes: string[] };

/** Newest first. Dates also drive sitemap lastModified for content routes. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-21",
    title: "Open-source CLI + free audit page",
    notes: [
      "npx rankforge-cli audit <url> — the deterministic engine as a zero-dependency terminal CLI, MIT licensed, with a GitHub Action for CI gates (--fail-under).",
      "A free, no-signup audit at /audit: 3 pages, every issue measured with evidence, nothing stored.",
      "Engine: crawled pages are deduplicated by final URL so a redirect target is never reported twice.",
    ],
  },
  {
    date: "2026-07-06",
    title: "The RankForge agent in your editor (MCP)",
    notes: [
      "RankForge now ships as an MCP server at /api/mcp — connect it to Claude Code, Cursor, VS Code or any MCP client.",
      "Your coding assistant runs the deterministic audit against localhost or production, gets fix templates, and patches the repo it already has open.",
      "Deterministic audit engine: measured image weights, real link statuses, internal link graph, content analysis — no LLM required.",
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
