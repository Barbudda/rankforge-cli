# Changelog

## 0.2.0

- **`rankforge geo`** — AI-search (GEO) readiness: robots.txt access for 12 AI crawlers (search vs. training), llms.txt, server-rendered text, and citability signals (answer schema, entity identity, author, dates, question headings, concrete figures).
- **`rankforge llms`** — generates an llms.txt from your pages.
- **`rankforge links`** — internal-link suggestions, orphan pages, strongest pages (internal PageRank).
- **`rankforge mcp`** — local MCP server over stdio: Claude Code, Cursor, VS Code, Windsurf and Claude Desktop can use RankForge as an agent, including on localhost. New tools: `geo_audit`, `generate_llms_txt`.
- **`--html report.html`** — self-contained, shareable report.
- `audit` now includes an AI-search readiness summary, and the overall score is category-weighted.
- GitHub Action: `geo-fail-under` gate and `report` output.
- Fixes: HTML numeric entities (`&#x27;`) are decoded; `--fail-under` exits cleanly with `1` on Windows; a redirected page is never counted twice.
- End-to-end test suite, run on macOS, Linux and Windows × Node 18/20/22.

## 0.1.0

- First release: `audit`, `fix`, `rules`, `--json`, `--fail-under`, GitHub Action.
