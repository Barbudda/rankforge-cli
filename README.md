# rankforge-cli

[![npm](https://img.shields.io/npm/v/rankforge-cli?color=34e0a1)](https://www.npmjs.com/package/rankforge-cli) [![CI](https://github.com/Barbudda/rankforge-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Barbudda/rankforge-cli/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![MCP](https://img.shields.io/badge/MCP-stdio%20server-708cff)](#2-in-your-ai-editor-the-agent)

**Technical SEO + AI-search readiness for your site — measured, not guessed.**
Run it in your terminal, let your AI editor use it as an agent, or gate your CI with it. No AI required, no API key, no account, nothing phones home.

```bash
npx rankforge-cli audit https://your-site.com
```

```
RankForge audit  https://your-site.com/
8 pages · 3.1s · deterministic — no AI, no external API

Score  87/100
  metadata          ███████████░   93
  indexing          █████████░░░   76
  images            ████████████  100
  internal-linking  ██████████░░   86
  …
Issues (8)
  CRITICAL Pages set to noindex (1)                     → /pricing
  MEDIUM   Pages missing a canonical URL (2) · fix template
  MEDIUM   Missing internal links between related pages (8)

AI search readiness  64/100  4 things to improve, run: rankforge geo https://your-site.com/
```

---

## Contents

1. [In your terminal](#1-in-your-terminal) — 30 seconds, nothing to install
2. [In your AI editor (the agent)](#2-in-your-ai-editor-the-agent) — Claude Code, Cursor, VS Code, Windsurf, Claude Desktop
3. [In your CI](#3-in-your-ci-github-action) — fail a PR when SEO regresses
4. [In your browser](#4-in-your-browser) — no install at all
5. [What it checks](#what-it-checks) · [AI-search readiness (GEO)](#ai-search-readiness-geo) · [Commands](#commands) · [Troubleshooting](#troubleshooting)

Requires **Node.js 18+** (check with `node -v`). Works on macOS, Linux and Windows — CI runs every commit on all three.

---

## 1. In your terminal

```bash
npx rankforge-cli audit https://your-site.com        # full audit
npx rankforge-cli audit http://localhost:3000        # your dev server, before you deploy
npx rankforge-cli geo https://your-site.com          # can ChatGPT / Claude / Perplexity cite you?
npx rankforge-cli llms https://your-site.com --out public/llms.txt   # generate llms.txt
npx rankforge-cli audit https://your-site.com --html report.html     # shareable report
```

`npx` downloads and runs the latest version each time. Using it a lot? Install it once and drop the `npx`:

```bash
npm install -g rankforge-cli
rankforge audit https://your-site.com
```

**Fix what it finds.** Mechanical issues come with a ready, framework-idiomatic patch:

```bash
rankforge fix framework-robots-missing --framework nextjs
rankforge fix indexing-canonical-missing --framework astro --url https://your-site.com
```

---

## 2. In your AI editor (the agent)

This is where RankForge is most useful: your coding assistant gets RankForge's tools over **MCP**, audits your site (including `localhost`), and **edits the files in your repo** to fix what it finds. RankForge measures; your assistant reasons and writes the code.

It runs **locally** — no server, no account, no key.

### Claude Code

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
> *"Check whether AI search engines can cite my site, and fix what blocks them."*
>
> *"Generate an llms.txt for my site and add it to the public folder."*

### The tools your assistant gets

| Tool | What it does |
|---|---|
| `audit_site` | Full audit: scores, every issue with evidence and URLs, orphan pages, click depth, link suggestions |
| `audit_page` | Fast check of one page while you iterate |
| `geo_audit` | AI-search readiness: AI crawler access, llms.txt, server-rendered text, citability |
| `generate_llms_txt` | Builds an llms.txt from your pages |
| `get_fix_template` | Idiomatic patch for a mechanical issue (robots, sitemap, viewport, canonical, schema…) |
| `seo_docs` | Explains an issue from the RankForge knowledge base |
| `list_rules` | The full rule catalog |

---

## 3. In your CI (GitHub Action)

Fail a pull request when the score drops, and keep the HTML report as an artifact:

```yaml
# .github/workflows/seo.yml
name: SEO
on: [pull_request]
jobs:
  seo:
    runs-on: ubuntu-latest
    steps:
      - uses: Barbudda/rankforge-cli@v0.2.0
        with:
          url: https://staging.your-site.com   # a deployed preview/staging URL
          fail-under: 80                       # technical SEO gate
          geo-fail-under: 60                   # AI-search readiness gate (optional)
          report: rankforge-report.html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: seo-report
          path: rankforge-report.html
```

Or without the Action, in any CI: `npx rankforge-cli audit "$URL" --fail-under 80` (exit code `1` below the threshold).

---

## 4. In your browser

No install: **[rank-forge-blue.vercel.app/audit](https://rank-forge-blue.vercel.app/audit)** runs the same engine on 3 pages of any public URL, free, no signup.

---

## What it checks

~35 deterministic checks in 8 categories. Every finding cites evidence from the page — nothing is inferred by a model.

- **Metadata** — missing/duplicate titles and descriptions, length, OpenGraph & Twitter cards
- **Indexing** — canonicals (missing or pointing elsewhere), accidental `noindex`, `<html lang>`, redirect chains, near-duplicate pages
- **Structure** — H1s, skipped heading levels, thin pages, readability, keyword stuffing, title ↔ content alignment
- **Images** — alt text, dimensions (layout shift), lazy-loading, **real byte weights** and legacy formats (fetched, not guessed)
- **Structured data** — missing JSON-LD, schema.org blocks missing required properties
- **Internal linking** — orphan pages, click depth, **broken links (real HTTP status)**, generic anchors, related pages that should link to each other
- **Performance** — server response time, render-blocking resources, oversized HTML, mixed content
- **Framework** — robots.txt / sitemap presence and conventions for Next.js, Nuxt, Astro, SvelteKit, Remix, Vite, MDX and static sites

## AI-search readiness (GEO)

Answer engines (ChatGPT search, Claude, Perplexity, Gemini, Copilot) can only cite a page they're **allowed** to fetch, can **read** without running JavaScript, and can **extract a clear answer** from. `rankforge geo` checks all three:

| | Checks |
|---|---|
| **Access** | robots.txt rules for 12 AI crawlers, split into *search* bots (needed to be cited) and *training* bots (blocking those is a legitimate choice, reported as info) |
| **Readable** | `llms.txt` present · page text is in the server HTML, not only rendered by JavaScript |
| **Citable** | FAQ/HowTo/Article/Product schema · Organization/Person identity with `sameAs` · author · published/modified dates · question-style headings · concrete figures · page summaries |

Honest limit: this measures what **you** control. Whether an engine ends up citing you depends on the engine — nobody outside them can measure or promise that.

## Commands

| Command | What it does |
|---|---|
| `audit <url>` | Full technical-SEO audit + AI-search summary |
| `geo <url>` | AI-search readiness in detail |
| `llms <url>` | Generate an llms.txt (`--out public/llms.txt`) |
| `links <url>` | Internal-link suggestions, orphan pages, strongest pages |
| `fix <ruleId>` | Print a ready-to-apply patch (`--framework`, `--url`) |
| `rules` | The rule catalog |
| `mcp` | Run as a local MCP server (for editors) |

| Flag | |
|---|---|
| `--pages N` | Pages to crawl, breadth-first (default 8, max 24) |
| `--framework fw` | `nextjs` `nuxt` `astro` `sveltekit` `remix` `vite-react` `mdx` `static` |
| `--json` | Machine-readable output |
| `--fail-under N` | Exit `1` below this score — `audit` and `geo` |
| `--html file` | Self-contained HTML report — `audit` |
| `--no-probe` | Skip fetching images/links (faster) |
| `--no-color` | Plain output (or `NO_COLOR=1`) |

## Troubleshooting

- **`node: command not found` / version errors** — install Node 18+ from [nodejs.org](https://nodejs.org).
- **Windows: the editor says the MCP server failed to start** — use the `cmd /c npx …` form shown above; editors can't launch `npx` directly on Windows.
- **"Couldn't reach that site"** — the URL must answer over http(s) from your machine. For local sites, start your dev server first.
- **CI can't audit `localhost`** — CI runners can't see your laptop. Audit a deployed preview or staging URL there.
- **It doesn't report backlinks / rankings / search volume** — by design. Those need data only search engines and paid indexes have; RankForge sticks to what can be measured from your site.
- **A finding is wrong on your site** — that's a bug: please [open an issue](https://github.com/Barbudda/rankforge-cli/issues) with the URL.

## Develop

```bash
git clone https://github.com/Barbudda/rankforge-cli && cd rankforge-cli
npm install
npm test          # builds, then runs the end-to-end suite against a local fixture site
node dist/index.js audit https://example.com
```

The engine lives in `src/lib/audit` (rules, link graph, content analysis, GEO, fix templates); the CLI in `cli/src`.

## License

MIT
