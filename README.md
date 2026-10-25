# rankforge-cli

[![npm](https://img.shields.io/npm/v/rankforge-cli?color=34e0a1)](https://www.npmjs.com/package/rankforge-cli) [![CI](https://github.com/Barbudda/rankforge-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Barbudda/rankforge-cli/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![MCP](https://img.shields.io/badge/MCP-stdio%20server-708cff)](#2-in-your-ai-editor-the-agent)

**Ship fast. Stay indexed.** Technical SEO and AI-search readiness, measured, not guessed.
RankForge checks your site where SEO breaks: in your editor before you push (your `localhost` included), on every pull request (preview against production, with a comment and a failing check), and in production. No AI in the measurements, no API key, no account, nothing phones home.

```bash
npx rankforge-cli audit https://your-site.com
```

```
RankForge audit  https://your-site.com/
25 pages · 6.2s · deterministic, no AI, no external API
every linked page crawled · 31 sitemap URLs

Score  84/100
  metadata          ███████████░   93
  indexing          █████████░░░   71
  images            ████████████  100
  internal-linking  ██████████░░   86
  …
Issues (9)
  CRITICAL Pages set to noindex (1)
           → https://your-site.com/pricing
  HIGH     hreflang annotations Google will ignore (3)
  MEDIUM   Pages missing a canonical URL (2) · fix template
  …
AI search readiness  64/100  4 things to improve, run: rankforge geo https://your-site.com/
```

---

## Contents

1. [In your terminal](#1-in-your-terminal): audit, compare, watch
2. [In your AI editor (the agent)](#2-in-your-ai-editor-the-agent): Claude Code plugin, Cursor, VS Code, Windsurf, Claude Desktop
3. [In your CI](#3-in-your-ci-github-action): comment on the pull request, and fail it when it breaks SEO
4. [Hosted monitoring](#4-hosted-monitoring): RankForge checks production every day and alerts you
5. [What it checks](#what-it-checks) · [AI-search readiness (GEO)](#ai-search-readiness-geo) · [Commands](#commands) · [Troubleshooting](#troubleshooting)

Requires **Node.js 18+** (check with `node -v`). Works on macOS, Linux and Windows, and CI runs every commit on all three.

---

## 1. In your terminal

```bash
npx rankforge-cli audit https://your-site.com        # full audit
npx rankforge-cli audit http://localhost:3000        # your dev server, before you deploy
npx rankforge-cli diff https://your-site.com http://localhost:3000   # what your change breaks
npx rankforge-cli geo https://your-site.com          # can ChatGPT / Claude / Perplexity cite you?
npx rankforge-cli llms https://your-site.com --out public/llms.txt   # generate llms.txt
```

`npx` downloads and runs the latest version each time. Using it a lot? Install it once and drop the `npx`:

```bash
npm install -g rankforge-cli
rankforge audit https://your-site.com
```

**It crawls like a search engine.** Links first, breadth-first, then the URLs only your sitemap knows about (sitemap indexes and `.xml.gz` included). It honours robots.txt the way Googlebot reads it (RFC 9309: wildcards, longest match wins), reads `X-Robots-Tag` headers as well as meta tags, and checks your HTTPS certificate. 25 pages by default, up to 500 with `--pages`.

**Catch regressions before they ship.** Compare two versions of a site, page by page:

```bash
rankforge diff https://your-site.com https://preview.your-site.com
```

```
RankForge diff  https://your-site.com/ → https://preview.your-site.com/
1 critical change: /pricing became noindex (robots meta tag)

  CRITICAL /pricing became noindex (robots meta tag)
  WARNING  /docs canonical changed to /docs/v2

Fixed  Pages missing a meta description

3 differences come from the environment, not the code (preview headers, robots.txt, sitemap host…):
```

It exits `1` on critical changes: pages that start failing or redirecting, new `noindex`, robots.txt blocking Google, a broken sitemap, an expired certificate. What only comes from the environment (a preview's `noindex` header, canonicals pointing at production) is listed apart and never fails the check. `--fail-on new` also fails on any new issue.

**Watch a site over time.** Save a baseline, then compare each run against it:

```bash
rankforge watch https://your-site.com            # first run saves .rankforge/baseline.json
rankforge watch https://your-site.com            # later runs: exit 1 if something regressed
rankforge watch https://your-site.com --update   # accept the current state as the new baseline
```

`rankforge audit <url> --save snap.json` writes the same snapshot, and `diff` takes snapshots or live URLs on either side.

**Fix what it finds.** Mechanical issues come with a ready, framework-idiomatic patch:

```bash
rankforge fix framework-robots-missing --framework nextjs
rankforge fix indexing-canonical-missing --framework astro --url https://your-site.com
```

**Share it.** `--html report.html` writes a self-contained report. For a client, put your name on it: `--brand "Your Studio" --brand-url https://your.studio --brand-color "#0f766e"`. The branded report doesn't mention RankForge.

**Core Web Vitals of real users.** `rankforge vitals https://your-site.com` reads Google's Chrome UX Report: LCP, INP, CLS, FCP and TTFB at the 75th percentile, for the page or, when it has too few visits, the whole origin. It needs a free [CrUX API key](https://developer.chrome.com/docs/crux/api#APIKey) in `CRUX_API_KEY`, and it is the only command that sends anything to a third party (the URL, to Google). `--vitals` adds the same numbers to `audit`, `watch` and their snapshots.

---

## 2. In your AI editor (the agent)

This is where RankForge is most useful: your coding assistant gets RankForge's tools over **MCP**, audits your site (`localhost` included), and **edits the files in your repo** to fix what it finds. RankForge measures; your assistant reasons and writes the code.

It runs **locally**: no server, no account, no key.

### Claude Code: the plugin

```
/plugin marketplace add Barbudda/rankforge-cli
/plugin install rankforge@rankforge
```

You get the MCP tools and two skills: `/rankforge:seo` audits the site in this repo and fixes what it can, `/rankforge:check` compares your local or preview version with production before you ship. Claude also uses them on its own when you ask about SEO.

Prefer the bare MCP server?

```bash
claude mcp add rankforge -- npx -y rankforge-cli mcp
```

> **Windows (native, not WSL):** `claude mcp add rankforge -- cmd /c npx -y rankforge-cli mcp`

Check it: `claude mcp list` should show `rankforge … ✓ Connected`.

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (this project):

```json
{
  "mcpServers": {
    "rankforge": { "command": "npx", "args": ["-y", "rankforge-cli", "mcp"] }
  }
}
```

### VS Code (Copilot agent mode)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "rankforge": { "type": "stdio", "command": "npx", "args": ["-y", "rankforge-cli", "mcp"] }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "rankforge": { "command": "npx", "args": ["-y", "rankforge-cli", "mcp"] }
  }
}
```

### Claude Desktop

Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rankforge": { "command": "npx", "args": ["-y", "rankforge-cli", "mcp"] }
  }
}
```

> **Windows:** use `"command": "cmd", "args": ["/c", "npx", "-y", "rankforge-cli", "mcp"]`, then restart the app.

### Then just ask

> *"Use rankforge to audit http://localhost:3000 and fix everything you can."*
>
> *"Before I push: compare localhost:3000 with production and tell me if I broke anything."*
>
> *"Check whether AI search engines can cite my site, and fix what blocks them."*

### The tools your assistant gets

| Tool | What it does |
|---|---|
| `audit_site` | Full audit: scores, every issue with evidence and URLs, orphan pages, click depth, link suggestions |
| `compare_sites` | Production vs your local or preview version: what changed, new and fixed issues, score delta |
| `audit_page` | Fast check of one page while you iterate |
| `geo_audit` | AI-search readiness: AI crawler access, llms.txt, server-rendered text, citability |
| `generate_llms_txt` | Builds an llms.txt from your pages |
| `get_fix_template` | Idiomatic patch for a mechanical issue (robots, sitemap, viewport, canonical, schema…) |
| `seo_docs` | Explains an issue from the RankForge knowledge base |
| `list_rules` | The rule catalog, with the same `ruleId`s the audits return |

---

## 3. In your CI (GitHub Action)

Compare each pull request's preview deployment with production, post the result on the pull request, and fail the check when the change would remove pages from search:

```yaml
# .github/workflows/seo.yml
name: SEO
on: [pull_request]
permissions:
  contents: read
  pull-requests: write   # lets RankForge comment on the pull request
jobs:
  seo:
    runs-on: ubuntu-latest
    steps:
      # …your step that deploys the preview and outputs its URL…
      - uses: Barbudda/rankforge-cli@v0.3.0
        with:
          url: ${{ steps.deploy.outputs.preview-url }}   # the version to check
          baseline-url: https://your-site.com             # production
          fail-on: critical                               # or: new, none
          report: rankforge-report.html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: seo-report
          path: rankforge-report.html
```

RankForge posts one comment on the pull request and updates it on every push: what changed compared with production, the issues fixed, the audit's score and top issues. The same summary goes to the job page. Set `comment: false` to skip the comment; pull requests from forks get a read-only token, so they only get the job summary.

Without `baseline-url`, the Action audits the URL alone: add `fail-under: 80` (technical SEO) and `geo-fail-under: 60` (AI-search readiness) to gate on scores.

Without the Action, in any CI: `npx rankforge-cli diff "$PROD_URL" "$PREVIEW_URL"` exits `1` on a critical regression, and `--markdown summary.md` writes the summary as Markdown.

---

## 4. Hosted monitoring

Your next deploy can still break production when nobody runs the CLI. The hosted app at **[www.rank-forge.dev](https://www.rank-forge.dev)** runs the same engine on your production site on a schedule, compares each check with the previous one, and alerts you when something critical changes: pages that start failing, a new `noindex`, robots.txt blocking Google, the sitemap gone, the HTTPS certificate about to expire, Core Web Vitals getting worse.

- **Free**: 1 site, checked weekly, email alerts.
- **Pro**: 5 sites, checked daily, alerts by email, Slack, Discord or webhook.
- **Studio**: 25 sites for freelancers and agencies, with an alert address per client.

Billing isn't open yet: during the beta, Pro is free. [Pricing](https://www.rank-forge.dev/pricing).

The CLI, the editor agent and the GitHub Action stay free and open source.

**No install at all?** [www.rank-forge.dev/audit](https://www.rank-forge.dev/audit) runs the engine on a few pages of any public URL, free, no signup.

---

## What it checks

54 deterministic checks in 8 categories, plus 12 for AI search. Every finding cites evidence from the site; nothing is inferred by a model. `rankforge rules` lists them all with their `ruleId`.

- **Indexing**: `noindex` in meta tags and `X-Robots-Tag` headers, canonicals (missing, pointing elsewhere, or pointing at a page that redirects, fails or is noindexed), hreflang (invalid codes, missing self-reference, missing return links), soft 404s (error pages served with 200, and missing URLs that return 200), robots.txt (failing with 5xx, served as HTML, blocking Googlebot or important pages), sitemap hygiene (redirects, errors, noindexed or non-canonical URLs listed) and gaps, HTTPS certificate (expired, untrusted, expiring within 14 days), redirect chains, near-duplicate pages, `<html lang>`
- **Metadata**: missing or duplicate titles and descriptions, title length, OpenGraph image, title and H1 that don't match the content
- **Structure**: missing or multiple H1, skipped heading levels, thin pages, readability, keyword stuffing
- **Images**: alt text, dimensions (layout shift), lazy-loading, **real byte weights** and legacy formats (fetched, not guessed)
- **Structured data**: missing JSON-LD, and the properties Google requires for rich results (Product, Event, Recipe, JobPosting, VideoObject, LocalBusiness, Review, BreadcrumbList)
- **Internal linking**: orphan pages (including those only the sitemap lists), click depth, **broken links (real HTTP status)**, generic anchors, related pages that should link to each other
- **Performance**: server response time, render-blocking resources, oversized HTML and images, mixed content, mobile viewport, and Core Web Vitals of real users with `--vitals`
- **Framework**: robots.txt and sitemap presence and conventions for Next.js, Nuxt, Astro, SvelteKit, Remix, Vite, MDX and static sites

## AI-search readiness (GEO)

Answer engines (ChatGPT search, Claude, Perplexity, Gemini, Copilot) can only cite a page they're **allowed** to fetch, can **read** without running JavaScript, and can **extract a clear answer** from. `rankforge geo` checks all three:

| | Checks |
|---|---|
| **Access** | robots.txt rules for 21 crawlers, split into *search* bots (Googlebot, Bingbot, OAI-SearchBot, Claude-SearchBot, PerplexityBot…: needed to be cited) and *training* bots (GPTBot, ClaudeBot, Applebot-Extended, CCBot…: blocking those is a legitimate choice, shown but not scored) · `Content-Signal` declarations |
| **Readable** | `llms.txt` present and well formed · page text is in the server HTML, not only rendered by JavaScript |
| **Citable** | structured data describing the content · Organization/Person identity with `sameAs` · author · published/modified dates · question-style headings · concrete figures · page summaries |

Honest limits: this measures what **you** control. Whether an engine ends up citing you depends on the engine, and nobody outside them can measure or promise that. Google Search doesn't use `llms.txt`, and FAQ and HowTo markup no longer produce rich results in Google, so RankForge doesn't push them.

## Commands

| Command | What it does |
|---|---|
| `audit <url>` | Full technical-SEO audit + AI-search summary |
| `diff <a> <b>` | What changed between two snapshots or two live URLs. Exit `1` on regressions |
| `watch <url>` | Compare with a saved baseline (`--baseline`, default `.rankforge/baseline.json`; `--update`) |
| `vitals <url>` | Core Web Vitals of real users from Google CrUX (`CRUX_API_KEY`, `--device mobile\|desktop`) |
| `geo <url>` | AI-search readiness in detail |
| `llms <url>` | Generate an llms.txt (`--out public/llms.txt`) |
| `links <url>` | Internal-link suggestions, orphan pages, strongest pages |
| `fix <ruleId>` | Print a ready-to-apply patch (`--framework`, `--url`) |
| `rules` | The rule catalog |
| `mcp` | Run as a local MCP server (for editors) |

| Flag | |
|---|---|
| `--pages N` | Pages to crawl: linked pages first, then sitemap-only ones (default 25, max 500) |
| `--concurrency N` | Parallel requests (default 4, max 8) |
| `--ignore-robots` | Crawl paths robots.txt disallows for RankForgeBot (your own site only) |
| `--framework fw` | `nextjs` `nuxt` `astro` `sveltekit` `remix` `vite-react` `mdx` `static` |
| `--json` | Machine-readable output |
| `--fail-under N` | Exit `1` below this score (`audit` and `geo`) |
| `--fail-on gate` | `diff` and `watch`: `critical` (default), `new` (any new issue), `none` |
| `--save file` | Write a snapshot for `diff` and `watch` (`audit`) |
| `--markdown file` | `audit`, `diff` and `watch`: append a Markdown summary (e.g. `$GITHUB_STEP_SUMMARY`) |
| `--html file` | Self-contained HTML report (`audit`), white-label with `--brand`, `--brand-url`, `--brand-color` |
| `--vitals` | Add Core Web Vitals from CrUX (`--crux-key`, or `CRUX_API_KEY`) |
| `--no-probe` | Skip fetching images and links (faster) |
| `--no-color` | Plain output (or `NO_COLOR=1`) |

## Troubleshooting

- **`node: command not found` / version errors**: install Node 18+ from [nodejs.org](https://nodejs.org).
- **Windows: the editor says the MCP server failed to start**: use the `cmd /c npx …` form shown above; editors can't launch `npx` directly on Windows. The Claude Code plugin handles this for you.
- **"robots.txt disallows RankForgeBot on this URL"**: the site's robots.txt blocks crawlers on that path. If it's your own site, re-run with `--ignore-robots`.
- **"Couldn't reach that site"**: the URL must answer over http(s) from your machine. For local sites, start your dev server first.
- **CI can't audit `localhost`**: CI runners can't see your laptop. Audit a deployed preview or staging URL there.
- **`diff` flags a preview's `noindex`**: it shouldn't. Preview hosts like Vercel send `X-Robots-Tag: noindex` on purpose, and RankForge lists that under environment differences when the two URLs are on different hosts. If it still counts as a regression, please open an issue.
- **`vitals` says there's no data**: Google only publishes CrUX numbers for pages and origins with enough Chrome traffic. A small or new site has none, and RankForge says so rather than estimating.
- **It doesn't report backlinks / rankings / search volume**: that is by design. Those need data only search engines and paid indexes have; RankForge sticks to what can be measured from your site.
- **A finding is wrong on your site**: that's a bug, so please [open an issue](https://github.com/Barbudda/rankforge-cli/issues) with the URL.

## Develop

```bash
git clone https://github.com/Barbudda/rankforge-cli && cd rankforge-cli
npm install
npm test          # builds, then runs the end-to-end suite against local fixture sites
node dist/index.js audit https://example.com
```

The engine lives in `src/lib/audit` (rules, crawler checks, snapshots and diffs, GEO, fix templates); the CLI in `cli/src`; the Claude Code plugin in `plugin/`.

## License

MIT
