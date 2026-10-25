# Changelog

## 0.3.0

**rankforge-cli is now `septune`.** Same tool, new name: `npx septune audit <url>`, the GitHub Action `Barbudda/septune`, the Claude Code plugin `septune`. `rankforge-cli` stays installable at 0.2.0 but gets no updates.

**Catch regressions before they ship**
- **`septune diff <a> <b>`** compares two snapshots or two live URLs (production vs your preview or `localhost`), page by page: pages that start failing or redirecting, new `noindex`, canonical changes, lost H1s and descriptions, robots.txt, sitemap, HTTPS certificate, Core Web Vitals, new and worsened issues. Exits `1` on critical changes (`--fail-on critical|new|none`). Differences that only come from the environment, like a preview's `X-Robots-Tag: noindex`, are listed apart and never fail the check.
- **`septune watch <url>`** saves a baseline on the first run and compares each later run with it (`--baseline`, `--update`). `audit --save` writes the same snapshot.
- `--markdown file` appends the diff as Markdown, e.g. to `$GITHUB_STEP_SUMMARY`.
- GitHub Action: `baseline-url` turns it into a regression gate for preview deployments. **It comments the result on the pull request**, in one comment updated on every push (`comment`, `github-token`), and writes the same summary to the job page. A failed check no longer skips the audit and the HTML report.
- `audit --markdown file` writes the audit's score and top issues as Markdown.

**A crawler that reads sites like Google**
- Sitemap-seeded crawl: linked pages first, then the URLs only the sitemap knows (sitemap indexes and `.xml.gz` included). Default 25 pages, up to 500 with `--pages`, parallel requests with `--concurrency`.
- robots.txt read like Googlebot (RFC 9309: wildcards, `$`, longest match wins, merged groups), honoured during the crawl. `--ignore-robots` for your own site.
- New indexing checks: `X-Robots-Tag` headers, canonicals pointing at pages that redirect, fail or are noindexed, hreflang (invalid language and region codes, missing self-reference and return links), soft 404s, robots.txt failing with 5xx or served as HTML or blocking Googlebot, sitemap hygiene and gaps, HTTPS certificate expired, untrusted or expiring within 14 days.
- Structured data checks follow Google's current rich-result requirements (Product, Event, Recipe, JobPosting, VideoObject, LocalBusiness, Review, BreadcrumbList). FAQ and HowTo markup are no longer recommended: Google stopped showing those rich results.
- Orphan detection counts pages only the sitemap lists.

**Real-user data**
- **`septune vitals <url>`** and `--vitals`: Core Web Vitals (LCP, INP, CLS, FCP, TTFB, p75) from Google's Chrome UX Report, for the page or the whole origin. Needs a free `CRUX_API_KEY`. It is the only call Septune makes to a third party, and only when you ask for it.

**AI search**
- 21 crawlers checked (was 12), including Googlebot (it feeds AI Overviews), Claude-SearchBot, Claude-User, Perplexity-User, meta-webindexer, Amzn-SearchBot, MistralAI-Index and DuckAssistBot.
- `llms.txt` format is validated, `Content-Signal` declarations are reported.
- Blocking training crawlers is now shown without lowering the score: it's a choice, not a defect.

**Editors and reports**
- **Claude Code plugin**: `/plugin marketplace add Barbudda/septune`, then `/plugin install septune@septune`. Adds the MCP tools and the `/septune:seo` and `/septune:check` skills.
- New MCP tool **`compare_sites`**: production vs local or preview, from your editor. `audit_site` takes `ignoreRobots`, and the local server crawls up to 200 pages.
- `septune rules` and `list_rules` now list the 54 checks under the same `ruleId`s audits return (the old catalog used different ids). A test keeps the catalog in sync with the engine.
- White-label HTML reports: `--brand`, `--brand-url`, `--brand-color`. A branded report doesn't mention Septune.
- `septune fix` prints the patch's notes (what to adapt per page) under the diff.

**Fixes**
- **The canonical patch (`fix indexing-canonical-missing`) put one fixed canonical in the shared layout**, the homepage on most frameworks: every page using that layout would have pointed at the homepage. The patches now build each page's own URL (Next.js `alternates.canonical: "./"`, `Astro.url`, SvelteKit `page.url`, Remix `useLocation`, Nuxt `useRoute`). If you applied the old patch, run `septune audit`: affected pages show up as "Canonical points to a different page".
- Nuxt patches edit `app.head` in `nuxt.config.ts` instead of inserting HTML into it.
- The `geo_audit` MCP tool documented its old page limit.

## 0.2.0

- **`rankforge geo`** checks AI-search (GEO) readiness: robots.txt access for 12 AI crawlers (search vs. training), llms.txt, server-rendered text, and citability signals (answer schema, entity identity, author, dates, question headings, concrete figures).
- **`rankforge llms`** generates an llms.txt from your pages.
- **`rankforge links`**: internal-link suggestions, orphan pages, strongest pages (internal PageRank).
- **`rankforge mcp`** runs a local MCP server over stdio, so Claude Code, Cursor, VS Code, Windsurf and Claude Desktop can use RankForge as an agent, including on localhost. New tools: `geo_audit`, `generate_llms_txt`.
- **`--html report.html`** writes a self-contained, shareable report.
- `audit` now includes an AI-search readiness summary, and the overall score is category-weighted.
- GitHub Action: `geo-fail-under` gate and `report` output.
- Fixes: HTML numeric entities (`&#x27;`) are decoded; `--fail-under` exits cleanly with `1` on Windows; a redirected page is never counted twice.
- End-to-end test suite, run on macOS, Linux and Windows × Node 18/20/22.

## 0.1.0

- First release: `audit`, `fix`, `rules`, `--json`, `--fail-under`, GitHub Action.
