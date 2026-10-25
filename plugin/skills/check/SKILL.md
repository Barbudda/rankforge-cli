---
description: Before shipping, compare the local or preview version of the site with production using RankForge's compare_sites tool, and stop if the change breaks SEO (pages that start failing or redirecting, new noindex, robots.txt blocking Google, broken canonicals). Use when the user is about to push, merge or deploy, or asks whether a change broke SEO.
---

# Pre-ship SEO check

1. **Find both URLs.** Production: the site's homepage in `package.json`, the README, the
   deployment config, or ask the user once. Candidate: the running dev server, or the
   preview deployment URL if the user has one.
2. **Compare.** Call `compare_sites` with production as `baselineUrl` and the candidate as
   `candidateUrl`.
3. **Report.**
   - `level: "critical"`: say plainly that this change would remove pages from search,
     list each critical change, and fix them before shipping.
   - Warnings: list them briefly and let the user decide.
   - `environmentDifferences`: these come from the preview or dev environment (a preview's
     noindex header, its own robots.txt, canonicals pointing at production). They are not
     regressions; mention them only if the user asks.
4. **Offer the CI gate** so this runs on every pull request:

   ```yaml
   - uses: Barbudda/rankforge-cli@v0.3.0
     with:
       url: ${{ steps.deploy.outputs.preview-url }}
       baseline-url: https://your-site.com
   ```
