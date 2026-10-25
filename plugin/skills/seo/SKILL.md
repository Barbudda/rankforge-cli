---
description: Audit and fix the technical SEO and AI-search readiness of the site in this repository with Septune's deterministic engine (MCP tools audit_site, get_fix_template, geo_audit, generate_llms_txt). Use when the user asks to audit or fix SEO, indexing, robots.txt, sitemaps, canonicals, hreflang, structured data or internal links, to make the site visible to AI search (ChatGPT, Claude, Perplexity), or to generate an llms.txt.
---

# Technical SEO with Septune

Septune measures, you fix. Its tools crawl the real site and report each issue with
evidence and the affected URLs. Work from that evidence: don't add issues it didn't report,
and never promise rankings or citations, since nobody outside the search engines can.

## Workflow

1. **Pick the URL.** Prefer the local dev server: read `package.json` for the dev script
   and port, start it if it isn't running. Use production only if the user asks.
2. **Audit.** Call `audit_site` with the URL and the framework (`nextjs`, `nuxt`, `astro`,
   `sveltekit`, `remix`, `vite-react`, `mdx`, `static`). 25 pages is the default; raise
   `maxPages` for a larger site. If robots.txt blocks the crawl and it's the user's own
   site, pass `ignoreRobots: true`.
3. **Triage.** Start with critical and high impact. For each issue, tell the user in one
   sentence what's wrong, on which pages, and the evidence Septune gave.
4. **Fix in the repository.**
   - When an issue has `deterministicFixAvailable`, call `get_fix_template` with its
     `ruleId` and the framework, then adapt the patch to the actual files.
   - Otherwise fix it by hand, following the evidence and the affected URLs.
   - Keep changes small and on a branch. Don't push or merge without the user.
5. **Verify.** Re-run `audit_site` and check the issues are gone. Then run
   `compare_sites` with production as `baselineUrl` and the local URL as `candidateUrl`,
   and make sure nothing critical regressed.
6. **AI search.** Call `geo_audit`. If there is no llms.txt, `generate_llms_txt` and write
   the result to the static folder (`public/` for Next.js, Astro, Vite and Nuxt; `static/`
   for SvelteKit).

## Rules that matter

- Never block search crawlers (Googlebot, Bingbot, OAI-SearchBot, Claude-SearchBot,
  PerplexityBot) unless the user asks. Blocking training crawlers is the user's choice.
- Don't add FAQ or HowTo markup to win rich results: Google no longer shows them. Use
  structured data that describes what the page really is (Article, Product,
  SoftwareApplication, BreadcrumbList, Organization).
- Canonical URLs must be absolute and point at the final, indexable URL.
- hreflang clusters must be reciprocal and include the page itself.
- Core Web Vitals come from real Chrome users (`septune vitals <url>` with a
  `CRUX_API_KEY`). A site without enough traffic has no data: say so, don't estimate.
