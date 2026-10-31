import type { Framework } from "@/types";

/**
 * Guides that answer one framework problem each, served at
 * /frameworks/<framework>/<slug> and linked from their framework page.
 *
 * Each one targets a query developers actually type (Google autocomplete,
 * vault note "10 - Registre de requêtes") where the results were tickets and
 * forum threads on 2026-10-31. Every fact comes from a source listed with the
 * date it was read; framework behaviour checked in code says which version.
 *
 * Text format: `code` spans and [links](/path) inline, nothing else.
 */

export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; label: string; code: string };

export interface GuideSection {
  heading: string;
  blocks: GuideBlock[];
}

export interface Guide {
  framework: Framework;
  slug: string;
  /** <title> before the " · Septune" suffix: 55 characters at most. */
  title: string;
  h1: string;
  /** Meta description, 155 characters at most. */
  description: string;
  /** The direct answer under the h1, 40 to 70 words. */
  answer: string;
  sections: GuideSection[];
  /** Septune rules that detect the problem, linked to their pages. */
  rules: string[];
  sources: { label: string; url: string; read: string }[];
  published: string;
  updated: string;
}

const READ = "2026-10-31";
const NEXT_METADATA = "https://nextjs.org/docs/app/api-reference/functions/generate-metadata";

export const GUIDES: Guide[] = [
  {
    framework: "nextjs",
    slug: "metadatabase-not-set",
    title: "metadataBase is not set: the Next.js warning, fixed",
    h1: "Next.js: “metadataBase property in metadata export is not set”",
    description:
      "What the Next.js metadataBase warning means, why outside Vercel it ships og:image URLs on localhost, and the line in app/layout.tsx that fixes it.",
    answer:
      "Next.js prints this warning when a relative Open Graph or Twitter image has no metadataBase to resolve against. Outside Vercel it then writes the image URL on http://localhost:3000, so shared links show no picture. Set `metadataBase: new URL(\"https://your-domain\")` in the root layout's metadata and rebuild.",
    sections: [
      {
        heading: "The full message",
        blocks: [
          {
            kind: "code",
            label: "next build",
            code: 'metadataBase property in metadata export is not set for resolving social open graph or twitter images, using "http://localhost:3000". See https://nextjs.org/docs/app/api-reference/functions/generate-metadata#metadatabase',
          },
          {
            kind: "p",
            text: "It comes from the Open Graph resolver of Next.js (version 16.2.9, `dist/lib/metadata/resolvers/resolve-opengraph.js`). Three conditions trigger it: an image with a relative URL, no `metadataBase` in the metadata, and a build that doesn't run with Vercel's system environment variables. In development it also fires for images declared in the metadata object; image files such as `app/opengraph-image.png` only trigger it in production builds.",
          },
        ],
      },
      {
        heading: "The origin Next.js uses instead",
        blocks: [
          {
            kind: "list",
            items: [
              "In development: `http://localhost`, on the port from `PORT`, else 3000.",
              "On a Vercel preview deployment: the branch URL (`VERCEL_BRANCH_URL`, else `VERCEL_URL`).",
              "On Vercel in production: `VERCEL_PROJECT_PRODUCTION_URL`.",
              "Anywhere else (Docker, a VPS, another host): `http://localhost:3000`, in the HTML your visitors receive.",
            ],
          },
          {
            kind: "p",
            text: "The last case is the costly one. The warning scrolls past in the build log, and every page ships an `og:image` that points at the build machine. Share crawlers from Facebook, LinkedIn, Slack or X fetch the image from their own servers, find nothing there, and the card goes out without a picture. On Vercel the warning stays silent because the fallback is a real URL, but a preview's images then point at the preview domain.",
          },
        ],
      },
      {
        heading: "The fix",
        blocks: [
          {
            kind: "code",
            label: "app/layout.tsx",
            code: 'import type { Metadata } from "next";\n\nexport const metadata: Metadata = {\n  metadataBase: new URL("https://www.example.com"),\n  openGraph: { images: "/og.png" },\n};',
          },
          {
            kind: "p",
            text: "Every route inherits the root layout's metadata, so this one line covers the site. Relative `openGraph.images`, `twitter.images` and `alternates.canonical` now resolve against it, and a field that already holds an absolute URL ignores it. If you read the domain from an environment variable, it has to exist when `next build` runs, since static pages are rendered at build time.",
          },
        ],
      },
      {
        heading: "The docs and the code disagree",
        blocks: [
          {
            kind: "p",
            text: "The Next.js documentation says a relative URL in a URL-based field without `metadataBase` causes a build error. In next 16.2.9 we found no such error: images get the warning and the localhost fallback, and a relative canonical such as `/about` is printed as written. If you count on the build failing to catch this, check with your own version first.",
          },
        ],
      },
      {
        heading: "Check a deployed site",
        blocks: [
          {
            kind: "code",
            label: "terminal",
            code: "curl -s https://www.example.com/ | grep -io '<meta[^>]*og:image[^>]*>'",
          },
          {
            kind: "p",
            text: "The value should start with `https://` on your own domain. Septune runs this check on every page it crawls, and its Next.js patch for it is the `metadataBase` line above. A missing canonical has the same root cause, covered in [canonical URLs in Next.js](/frameworks/nextjs/canonical-url).",
          },
        ],
      },
    ],
    rules: ["meta-og-image-url", "meta-og-image-missing", "indexing-canonical-missing"],
    sources: [
      { label: "Next.js 16.2.9, resolve-opengraph.js (the warning and when it prints)", url: "https://app.unpkg.com/next@16.2.9/files/dist/lib/metadata/resolvers/resolve-opengraph.js", read: READ },
      { label: "Next.js 16.2.9, resolve-url.js (the fallback origin)", url: "https://app.unpkg.com/next@16.2.9/files/dist/lib/metadata/resolvers/resolve-url.js", read: READ },
      { label: "Next.js docs, generateMetadata: metadataBase", url: `${NEXT_METADATA}#metadatabase`, read: READ },
    ],
    published: READ,
    updated: READ,
  },
  {
    framework: "nextjs",
    slug: "og-image-not-working",
    title: "Next.js og:image not showing? Five causes to check",
    h1: "Next.js og:image not working: five causes, in the order to check them",
    description:
      "Why a Next.js Open Graph image doesn't show when a link is shared: localhost URLs, a page replacing the layout's openGraph, image limits, logins, caches.",
    answer:
      "Read the og:image tag in the page source first. If it points at localhost or has no domain, set metadataBase. If one page has no tag, its own openGraph object replaced the layout's. If the tag is right, open the image URL logged out, then ask the platform to fetch the card again.",
    sections: [
      {
        heading: "1. The URL points at localhost or has no domain",
        blocks: [
          {
            kind: "p",
            text: "Without `metadataBase`, a build outside Vercel writes relative images on `http://localhost:3000`. The fix is one line in the root layout, explained in [the metadataBase warning](/frameworks/nextjs/metadatabase-not-set).",
          },
        ],
      },
      {
        heading: "2. One page's openGraph replaced the layout's",
        blocks: [
          {
            kind: "p",
            text: "Next.js merges metadata from layouts and pages shallowly: in its own words, nested fields such as `openGraph` and `robots` defined in an earlier segment are overwritten by the last segment to define them. A page that sets `openGraph: { title: \"Pricing\" }` therefore drops the images the layout declared. Export the shared fields once, from a module such as `app/shared-metadata.ts`, and spread them:",
          },
          {
            kind: "code",
            label: "app/pricing/page.tsx",
            code: 'import { openGraphBase } from "../shared-metadata";\n\nexport const metadata = {\n  openGraph: { ...openGraphBase, title: "Pricing" },\n};',
          },
        ],
      },
      {
        heading: "3. The generated image fails",
        blocks: [
          {
            kind: "p",
            text: "Open the URL from the `og:image` tag in a browser. An error there means the image itself fails. The documented limits: an `opengraph-image` file over 8 MB (5 MB for `twitter-image`) fails the build, and `ImageResponse` supports flexbox and a subset of CSS only, a 500 KB bundle at most, and fonts in ttf, otf or woff.",
          },
        ],
      },
      {
        heading: "4. The image needs a login",
        blocks: [
          {
            kind: "p",
            text: "Share crawlers fetch the image without your cookies. A preview deployment behind a password or single sign-on, or an image route that checks the session, answers 401 or redirects to a sign-in page, and the card has no picture. Load the image URL in a private window to see what they get.",
          },
        ],
      },
      {
        heading: "5. The platform kept an old card",
        blocks: [
          {
            kind: "p",
            text: "Platforms keep the card they built the first time a link was shared. After a fix, ask them to fetch it again with their own tools, such as Facebook's Sharing Debugger or LinkedIn's Post Inspector.",
          },
        ],
      },
      {
        heading: "What Septune measures here",
        blocks: [
          {
            kind: "p",
            text: "Septune reads the `og:image` of every page it crawls: a missing tag and a relative or localhost URL are two separate checks, each with a Next.js patch. It doesn't download the image or read a platform's cached card, so causes 3 to 5 stay manual checks.",
          },
        ],
      },
    ],
    rules: ["meta-og-image-url", "meta-og-image-missing"],
    sources: [
      { label: "Next.js docs, generateMetadata: merging", url: `${NEXT_METADATA}#merging`, read: READ },
      { label: "Next.js docs, opengraph-image and twitter-image", url: "https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image", read: READ },
      { label: "Next.js docs, ImageResponse", url: "https://nextjs.org/docs/app/api-reference/functions/image-response", read: READ },
      { label: "The Open Graph protocol", url: "https://ogp.me/", read: READ },
    ],
    published: READ,
    updated: READ,
  },
  {
    framework: "nextjs",
    slug: "noindex",
    title: "Next.js noindex: metadata robots, layouts and 404s",
    h1: "How to noindex a page in Next.js, and keep it off the pages you want found",
    description:
      "Set noindex with the Next.js metadata robots field, see how a layout passes it to every page below, and when Next.js adds noindex on its own.",
    answer:
      "Export metadata with `robots: { index: false }` from the page. Next.js prints `<meta name=\"robots\" content=\"noindex\">`. Set it in a layout instead and every page under that layout inherits it, until one of them defines its own robots object. Next.js also adds the tag by itself to pages that answer 404.",
    sections: [
      {
        heading: "One page",
        blocks: [
          {
            kind: "code",
            label: "app/thank-you/page.tsx",
            code: 'import type { Metadata } from "next";\n\nexport const metadata: Metadata = {\n  robots: { index: false, follow: true },\n};',
          },
          {
            kind: "p",
            text: "This prints `<meta name=\"robots\" content=\"noindex, follow\">`, and Google keeps the page out of its results. For a page whose content depends on the request, return the same field from `generateMetadata`.",
          },
        ],
      },
      {
        heading: "A layout passes it down",
        blocks: [
          {
            kind: "p",
            text: "Metadata from layouts and pages is merged shallowly, and a page inherits every field it leaves unset. A `robots` object in `app/blog/layout.tsx` applies to every post. A post that sets its own `robots` replaces the layout's whole object, not one key of it.",
          },
          {
            kind: "p",
            text: "That is how a noindex added to a layout during a test can take a whole section out of search after the next deploy. Keep `robots` on the pages that need it, or in a layout that holds only pages you mean to hide.",
          },
        ],
      },
      {
        heading: "Pages Next.js marks noindex on its own",
        blocks: [
          {
            kind: "list",
            items: [
              "Pages that answer 404, `global-not-found.js` included: the docs say Next.js injects the noindex tag automatically.",
              "A not-found page in a streamed response answers 200, and the same tag keeps it out of the index.",
              "In the source of next 16.2.9, any response with a status above 400 gets the tag as well.",
            ],
          },
        ],
      },
      {
        heading: "With a header instead of a tag",
        blocks: [
          {
            kind: "code",
            label: "next.config.mjs",
            code: 'export default {\n  async headers() {\n    return [\n      { source: "/drafts/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },\n    ];\n  },\n};',
          },
          {
            kind: "p",
            text: "Google obeys `X-Robots-Tag` like the meta tag, and it also works on PDFs and images. It is easier to forget, though, because it never shows in the page source.",
          },
        ],
      },
      {
        heading: "Before you ship",
        blocks: [
          {
            kind: "p",
            text: "Septune lists every page with a noindex, says whether it came from the tag or the header, and raises it when the page is in your sitemap or is the start page. Sign-in, account and cart pages are reported apart, as a notice. The pull-request check fails when a change adds noindex to a page that didn't have it.",
          },
        ],
      },
    ],
    rules: ["indexing-noindex", "indexing-noindex-utility", "indexing-soft-404"],
    sources: [
      { label: "Next.js docs, generateMetadata: robots and merging", url: `${NEXT_METADATA}#robots`, read: READ },
      { label: "Next.js docs, not-found", url: "https://nextjs.org/docs/app/api-reference/file-conventions/not-found", read: READ },
      { label: "Next.js docs, headers in next.config.js", url: "https://nextjs.org/docs/app/api-reference/config/next-config-js/headers", read: READ },
      { label: "Google Search Central, robots meta tag and X-Robots-Tag", url: "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag", read: READ },
    ],
    published: READ,
    updated: READ,
  },
  {
    framework: "nextjs",
    slug: "canonical-url",
    title: "Canonical URLs in Next.js: the root layout trap",
    h1: "Set the canonical URL in Next.js without pointing every page at the homepage",
    description:
      "Set alternates.canonical in Next.js safely: why \"/\" in the root layout sends every page's canonical to the homepage, why \"./\" doesn't, and metadataBase.",
    answer:
      "Set `metadataBase` and `alternates: { canonical: \"./\" }` in the root layout. Next.js resolves `./` against each route, so every page names itself. Writing `/` there gives every page a canonical that points at the homepage. Override it from `generateMetadata` on the routes whose preferred URL differs from the one requested.",
    sections: [
      {
        heading: "The safe default",
        blocks: [
          {
            kind: "code",
            label: "app/layout.tsx",
            code: 'export const metadata: Metadata = {\n  metadataBase: new URL("https://www.example.com"),\n  alternates: { canonical: "./" },\n};',
          },
          {
            kind: "p",
            text: "On `/blog/launch` this prints `<link rel=\"canonical\" href=\"https://www.example.com/blog/launch\">`, without the query string.",
          },
        ],
      },
      {
        heading: "Why \"/\" breaks every page",
        blocks: [
          {
            kind: "p",
            text: "A page that doesn't set `alternates` inherits the root layout's. The value `/` resolves to the homepage whatever the route, so every page tells Google it is a copy of the homepage, and Google may drop them in its favour. The value `./` follows the route.",
          },
          {
            kind: "p",
            text: "We made this mistake ourselves: the canonical patch of an early version of our CLI (0.2.0, then called rankforge-cli) used `/`. It now uses `./`, and a test keeps it that way.",
          },
        ],
      },
      {
        heading: "Without metadataBase",
        blocks: [
          {
            kind: "p",
            text: "In next 16.2.9 a relative canonical without `metadataBase` is printed as written, for example `href=\"/about\"`. Google recommends absolute URLs in `rel=\"canonical\"`, so set `metadataBase` once in the root layout; it also fixes [og:image URLs on localhost](/frameworks/nextjs/metadatabase-not-set).",
          },
        ],
      },
      {
        heading: "Dynamic routes",
        blocks: [
          {
            kind: "code",
            label: "app/products/[slug]/page.tsx",
            code: 'export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {\n  const { slug } = await params;\n  return { alternates: { canonical: `/products/${slug}` } };\n}',
          },
          {
            kind: "p",
            text: "Use it when the preferred URL differs from the requested one, for instance a product reachable under several categories. A page that sets `alternates` replaces the layout's whole object, `languages` included, so repeat the hreflang entries there if you have any.",
          },
        ],
      },
      {
        heading: "What Septune checks",
        blocks: [
          {
            kind: "p",
            text: "Pages without a canonical, canonicals that point at another page, at a page that can't be indexed, or that appear twice on one page. The pull-request check compares the preview with production, so a layout change that rewrites every canonical shows up in its comment before the merge.",
          },
        ],
      },
    ],
    rules: ["indexing-canonical-missing", "indexing-canonical-mismatch", "indexing-canonical-target-invalid", "indexing-canonical-multiple"],
    sources: [
      { label: "Next.js docs, generateMetadata: alternates and URL composition", url: `${NEXT_METADATA}#alternates`, read: READ },
      { label: "Google Search Central, how to specify a canonical URL", url: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls", read: READ },
    ],
    published: READ,
    updated: READ,
  },
  {
    framework: "astro",
    slug: "sitemap-not-working",
    title: "Astro sitemap not working? Four things to check",
    h1: "Astro sitemap not working: four things to check",
    description:
      "@astrojs/sitemap writes sitemap-index.xml, needs the site option and skips routes rendered on demand. How to find which one is breaking yours.",
    answer:
      "Most often the file exists under another name: @astrojs/sitemap writes `sitemap-index.xml` and `sitemap-0.xml`, never `sitemap.xml`. If neither is in the build output, `site` is missing from astro.config.mjs. Dynamic routes rendered on demand are left out, and search engines learn where the index is from robots.txt.",
    sections: [
      {
        heading: "1. You're opening /sitemap.xml",
        blocks: [
          {
            kind: "p",
            text: "The integration writes `sitemap-index.xml`, which links to numbered files: `sitemap-0.xml`, then `sitemap-1.xml` for larger sites. Requesting `/sitemap.xml` returns a 404 or your host's fallback page. Some audit tools only look for that name. Septune also tries `/sitemap-index.xml` when robots.txt names no sitemap.",
          },
        ],
      },
      {
        heading: "2. The site option is missing",
        blocks: [
          {
            kind: "code",
            label: "astro.config.mjs",
            code: 'import { defineConfig } from "astro/config";\nimport sitemap from "@astrojs/sitemap";\n\nexport default defineConfig({\n  site: "https://www.example.com",\n  integrations: [sitemap()],\n});',
          },
          {
            kind: "p",
            text: "The Astro docs are direct about it: the integration needs to know the deployed URL, and `site` must begin with `http://` or `https://`. After a build, check that `dist/` contains `sitemap-index.xml`.",
          },
        ],
      },
      {
        heading: "3. Pages rendered on demand are missing",
        blocks: [
          {
            kind: "p",
            text: "The integration can't list dynamic routes in SSR mode. Routes built with `getStaticPaths()` are included. For pages it can't see, pass their full URLs in `customPages`:",
          },
          {
            kind: "code",
            label: "astro.config.mjs",
            code: 'sitemap({\n  customPages: ["https://www.example.com/products/blue-mug"],\n}),',
          },
        ],
      },
      {
        heading: "4. Nothing tells crawlers where it is",
        blocks: [
          {
            kind: "code",
            label: "public/robots.txt",
            code: "User-agent: *\nAllow: /\n\nSitemap: https://www.example.com/sitemap-index.xml",
          },
          {
            kind: "p",
            text: "The docs also suggest `<link rel=\"sitemap\" href=\"/sitemap-index.xml\">` in the head. In Search Console, submit the index file in the Sitemaps report.",
          },
        ],
      },
      {
        heading: "Dates per page",
        blocks: [
          {
            kind: "p",
            text: "The integration doesn't read a page's source, so `lastmod`, `changefreq` and `priority` are site-wide options. To set a date per page, return it from `serialize()`, which runs on each entry just before the file is written.",
          },
        ],
      },
    ],
    rules: ["framework-sitemap-missing", "framework-robots-no-sitemap"],
    sources: [
      { label: "Astro docs, @astrojs/sitemap (integration 3.7.4)", url: "https://docs.astro.build/en/guides/integrations-guide/sitemap/", read: READ },
      { label: "Google Search Central, build and submit a sitemap", url: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap", read: READ },
    ],
    published: READ,
    updated: READ,
  },
  {
    framework: "vite-react",
    slug: "lovable-seo",
    title: "Lovable SEO in 2026: what crawlers actually get",
    h1: "Lovable SEO in 2026: what crawlers actually receive",
    description:
      "How Lovable sites reach Google and AI crawlers in 2026, from Lovable's own docs: TanStack Start apps, pre-rendered React + Vite apps, and exported apps.",
    answer:
      "It depends on when the app was created and where it's hosted. Apps created since May 13, 2026 use TanStack Start and send server-rendered HTML. Older React + Vite apps hosted by Lovable are pre-rendered, for verified crawlers only. An older app exported and hosted elsewhere is a plain single-page app.",
    sections: [
      {
        heading: "Three cases, according to Lovable",
        blocks: [
          {
            kind: "list",
            items: [
              "Created on or after May 13, 2026 (June 22 for Enterprise workspaces): TanStack Start, which renders every page on the server, for people, crawlers and scanners alike.",
              "Created before and published on Lovable: React + Vite, rendered in the browser. When a verified crawler asks for a page, Lovable renders it on the fly and returns the HTML. Lovable names Google, Bing, the AI search crawlers of ChatGPT, Perplexity, Claude and Gemini, social-preview bots and verified SEO tools.",
              "Created before, exported and hosted elsewhere: the static build has no pre-rendering, so a crawler that doesn't run JavaScript gets the empty app.",
            ],
          },
          {
            kind: "p",
            text: "Lovable adds two details: content that loads late may be missing from the pre-rendered page, and any client that asks for Markdown gets a Markdown version, on both stacks. Several of the articles that come up for this search were written before these changes.",
          },
        ],
      },
      {
        heading: "Why an SEO tool can show your pages as empty",
        blocks: [
          {
            kind: "p",
            text: "Lovable's hosting docs warn that third-party SEO scanners aren't verified crawlers, so they may report pages as empty while Google and AI search engines see the content. Septune is one of those scanners. On an older app hosted by Lovable it gets the same empty page as any unverified bot, and its check for JavaScript-only content fires. There, trust Search Console's URL Inspection, which shows what Googlebot received.",
          },
        ],
      },
      {
        heading: "When the empty page is real",
        blocks: [
          {
            kind: "p",
            text: "On an exported older app, the empty page is what every crawler gets before JavaScript runs. When Vercel and MERJ measured it in December 2024, none of the major AI crawlers rendered JavaScript, OpenAI's crawlers, ClaudeBot and PerplexityBot included. Googlebot renders it after a stay in a rendering queue. The fixes are those of any Vite + React app: [prerender the public routes](/frameworks/vite-react).",
          },
        ],
      },
      {
        heading: "What rendering doesn't fix",
        blocks: [
          {
            kind: "p",
            text: "Pre-rendering and server rendering show crawlers what the app produces. They can't add a title, a description or a canonical the app never sets, and they don't repair broken links or a missing sitemap. Lovable's docs say the same: page quality still matters, from metadata to internal links.",
          },
          {
            kind: "p",
            text: "On apps created since May 2026 Septune reads the full HTML, so it audits them like any site. On exported older apps its JavaScript check is accurate. On older apps still hosted by Lovable it only sees robots.txt, the sitemap and the empty page.",
          },
        ],
      },
    ],
    rules: ["framework-js-only-content", "meta-title-duplicate", "framework-sitemap-missing"],
    sources: [
      { label: "Lovable docs, SEO and AEO (how Lovable handles crawlability)", url: "https://docs.lovable.dev/features/seo-aeo", read: READ },
      { label: "Lovable docs, how Lovable hosts your app", url: "https://docs.lovable.dev/features/hosting", read: READ },
      { label: "Lovable docs, FAQ (the two stacks)", url: "https://docs.lovable.dev/introduction/faq", read: READ },
      { label: "Vercel, The rise of the AI crawler (December 17, 2024)", url: "https://vercel.com/blog/the-rise-of-the-ai-crawler", read: READ },
      { label: "Google Search Central, JavaScript SEO basics", url: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics", read: READ },
    ],
    published: READ,
    updated: READ,
  },
];

export function guidesFor(framework: Framework): Guide[] {
  return GUIDES.filter((g) => g.framework === framework);
}

export function getGuide(framework: string, slug: string): Guide | undefined {
  return GUIDES.find((g) => g.framework === framework && g.slug === slug);
}
