import type { Plan } from "@/types";

export interface PricingTier {
  id: Plan;
  name: string;
  priceMonthly: number | null; // null = custom
  tagline: string;
  highlight?: boolean;
  cta: string;
  /** Optional CTA destination override (e.g. mailto: for Enterprise). */
  ctaHref?: string;
  features: string[];
  limits: { repos: string; audits: string; prs: string };
}

/**
 * Placeholder pricing. Centralized so prices/limits are trivial to
 * change — the landing pricing section, the standalone /pricing page
 * and the billing screen all read from here.
 */
export const PRICING_TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    priceMonthly: 29,
    tagline: "For indie hackers and solo devs.",
    cta: "Start free audit",
    limits: { repos: "1 repo", audits: "Weekly audit", prs: "5 PRs / month" },
    features: [
      "1 repository",
      "Rendered-site crawl up to 200 pages",
      "All SEO categories",
      "Suggest-only & draft PRs",
      "Plain-English explanation of every fix",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceMonthly: 99,
    tagline: "For startups shipping fast.",
    highlight: true,
    cta: "Start free audit",
    limits: { repos: "5 repos", audits: "Daily audits", prs: "30 PRs / month" },
    features: [
      "Up to 5 repositories",
      "Crawl up to 2,000 pages",
      "Auto-create low-risk PRs",
      "Priority queue & scoring",
      "Slack & email notifications",
      "Audit history & trends",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    priceMonthly: 299,
    tagline: "For agencies managing many sites.",
    cta: "Start free audit",
    limits: { repos: "25 repos", audits: "Daily audits", prs: "150 PRs / month" },
    features: [
      "Up to 25 repositories",
      "Multi-tenant client workspaces",
      "Monorepo support",
      "Per-client reporting",
      "Role-based access",
      "Bulk scheduling & exports",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceMonthly: null,
    tagline: "For teams that need SSO, self-hosting and an audit trail.",
    cta: "Talk to us",
    ctaHref: "mailto:hugopoene74@gmail.com",
    limits: { repos: "Unlimited", audits: "Custom cadence", prs: "Custom" },
    features: [
      "Unlimited repositories",
      "Self-hosted option",
      "SSO / SAML",
      "Advanced audit trail",
      "Custom SEO rules",
      "Custom integrations",
    ],
  },
];
