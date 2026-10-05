import type {
  Effort,
  Framework,
  Risk,
  SeoCategory,
  Severity,
} from "@/types";

export const CATEGORY_META: Record<
  SeoCategory,
  { label: string; short: string; description: string }
> = {
  metadata: {
    label: "Metadata",
    short: "Meta",
    description: "Titles, descriptions, OpenGraph & Twitter cards.",
  },
  indexing: {
    label: "Indexing",
    short: "Index",
    description: "Canonicals, robots, sitemaps & accidental noindex.",
  },
  structure: {
    label: "Page structure",
    short: "Structure",
    description: "Heading hierarchy, H1 usage & thin content.",
  },
  images: {
    label: "Images",
    short: "Images",
    description: "Alt text, dimensions, weight & lazy loading.",
  },
  schema: {
    label: "Schema.org",
    short: "Schema",
    description: "Structured data for rich results.",
  },
  "internal-linking": {
    label: "Internal linking",
    short: "Links",
    description: "Orphan pages, anchor quality & click depth.",
  },
  performance: {
    label: "Performance SEO",
    short: "Perf",
    description: "Core Web Vitals signals & render-blocking resources.",
  },
  framework: {
    label: "Framework-specific",
    short: "Framework",
    description: "Metadata API, generateMetadata, sitemaps & routing.",
  },
};

export const SEVERITY_META: Record<
  Severity,
  { label: string; color: string; bg: string; rank: number }
> = {
  critical: { label: "Critical", color: "var(--color-critical)", bg: "color-mix(in oklab, var(--color-critical) 14%, transparent)", rank: 4 },
  high: { label: "High", color: "var(--color-high)", bg: "color-mix(in oklab, var(--color-high) 14%, transparent)", rank: 3 },
  medium: { label: "Medium", color: "var(--color-medium)", bg: "color-mix(in oklab, var(--color-medium) 14%, transparent)", rank: 2 },
  low: { label: "Low", color: "var(--color-low)", bg: "color-mix(in oklab, var(--color-low) 14%, transparent)", rank: 1 },
};

export const EFFORT_LABEL: Record<Effort, string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
};

export const RISK_LABEL: Record<Risk, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

export const FRAMEWORK_META: Record<
  Framework,
  { label: string; color: string }
> = {
  nextjs: { label: "Next.js", color: "#ffffff" },
  nuxt: { label: "Nuxt", color: "#42e89f" },
  astro: { label: "Astro", color: "#ff7b54" },
  sveltekit: { label: "SvelteKit", color: "#ff5722" },
  remix: { label: "Remix", color: "#8fd6ff" },
  "vite-react": { label: "Vite + React", color: "#a779ff" },
  mdx: { label: "MDX", color: "#ffd66b" },
  static: { label: "Static", color: "#a7aec4" },
};

/** Weight of each category in the overall SEO score (sums to 1). */
export const CATEGORY_WEIGHTS: Record<SeoCategory, number> = {
  metadata: 0.2,
  indexing: 0.18,
  structure: 0.12,
  images: 0.1,
  schema: 0.12,
  "internal-linking": 0.1,
  performance: 0.13,
  framework: 0.05,
};
