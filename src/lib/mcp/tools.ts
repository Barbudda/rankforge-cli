import type { Framework, Repository, SeoIssue } from "@/types";
import { scanSite } from "@/lib/agents/crawl";
import { runDeterministicAudit } from "@/lib/audit/engine";
import { probeResources } from "@/lib/audit/resource-probe";
import { generateDeterministicFix } from "@/lib/audit/deterministic-fix";
import { RULE_CATALOG } from "@/lib/audit/catalog";
import { searchCorpus } from "@/lib/support/corpus";
import { runGeoAudit, buildLlmsTxt } from "@/lib/audit/geo";
import { config } from "@/lib/config";
import { buildSnapshot, diffSnapshots } from "@/lib/audit/snapshot";
import { computeOverallScore } from "@/lib/scoring";
import { CATEGORY_WEIGHTS } from "@/lib/seo/constants";
import type { CategoryScore, SeoCategory } from "@/types";

/**
 * The Septune agent's MCP toolbox — what an AI coding assistant (Claude
 * Code, Cursor, VS Code, Windsurf…) can call from the developer's editor.
 *
 * Design: the tools do the MEASURING (Septune's deterministic engine — no
 * LLM, no external API); the host agent does the REASONING and edits the repo
 * it already has open. That split is why this works so well: the assistant
 * gets ground truth about the rendered site, and fixes code in place.
 */

const FRAMEWORKS: Framework[] = [
  "nextjs",
  "nuxt",
  "astro",
  "sveltekit",
  "remix",
  "vite-react",
  "mdx",
  "static",
];

/** Fixable rule ids — the deterministic patch builders' registry keys. */
const FIXABLE_RULES = [
  "framework-robots-missing",
  "framework-robots-no-sitemap",
  "framework-sitemap-missing",
  "perf-viewport-missing",
  "indexing-html-lang-missing",
  "indexing-canonical-missing",
  "schema-missing",
  "schema-website-missing",
  "meta-og-image-missing",
] as const;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>): Promise<string>;
}

function synthRepo(url: string, framework: Framework): Repository {
  return {
    id: "mcp",
    framework,
    productionUrl: url,
    fullName: "local/site",
    defaultBranch: "main",
    score: 0,
  } as unknown as Repository;
}

function asFramework(v: unknown): Framework {
  return FRAMEWORKS.includes(v as Framework) ? (v as Framework) : "nextjs";
}

function asUrl(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new Error("`url` is required.");
  const u = new URL(v); // throws on malformed input
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http/https URLs can be audited.");
  }
  // SSRF is enforced robustly at the network layer (src/lib/net/ssrf.ts):
  // resolved-IP validation on every request and redirect hop. It blocks
  // private/internal hosts on hosted deployments and is a no-op in local dev.
  return u.toString();
}

// The local stdio server (septune mcp) runs on the user's machine and can
// crawl more; the hosted route keeps the historic 24-page ceiling.
// Read at call time: the CLI sets RANKFORGE_ALLOW_LOCAL after imports run.
const pageCap = () => (process.env.RANKFORGE_ALLOW_LOCAL === "1" ? 200 : 24);
const pagesArg = (v: unknown, def: number) => Math.max(1, Math.min(Number(v) || def, pageCap()));

async function runEngine(url: string, framework: Framework, maxPages: number, ignoreRobots = false) {
  const repo = synthRepo(url, framework);
  // Keep the whole audit inside the route's 120s budget even for slow sites.
  const { pages, siteFiles } = await scanSite(url, { maxPages, hardCap: pageCap(), deadlineMs: 80_000, ignoreRobots });
  const resources =
    maxPages > 1 ? await probeResources(pages, url).catch(() => undefined) : undefined;
  return { engine: runDeterministicAudit(repo, pages, siteFiles, resources), pages, siteFiles };
}

/** Compact issue view — bounded so responses stay editor-friendly. */
function compactIssues(engine: ReturnType<typeof runDeterministicAudit>) {
  return engine.issues.map((i) => ({
    ruleId: i.ruleId,
    category: i.category,
    impact: i.impact,
    title: i.title,
    evidence: i.evidence,
    affectedUrls: i.affectedUrls.slice(0, 10),
    affectedCount: i.affectedUrls.length,
    likelyFiles: i.files.map((f) => f.path),
    deterministicFixAvailable: (FIXABLE_RULES as readonly string[]).includes(i.ruleId),
  }));
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "audit_site",
    description:
      "Run Septune's full deterministic technical-SEO audit on a site (crawls up to `maxPages` pages breadth-first, probes robots/sitemap, measures image weights and link statuses, builds the internal link graph). Returns category scores (0-100), every detected issue with evidence and affected URLs, plus site signals: orphan pages, click depth, near-duplicate content clusters, and semantic internal-link suggestions. Works on localhost dev servers. No LLM involved — results are measured, not guessed.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Start URL, e.g. http://localhost:3000/ or https://example.com/" },
        framework: { type: "string", enum: FRAMEWORKS, description: "Site framework (improves file hints). Default nextjs." },
        maxPages: { type: "integer", minimum: 1, maximum: 200, description: "Pages to crawl (default 25; the hosted server caps at 24)." },
        ignoreRobots: { type: "boolean", description: "Crawl paths robots.txt disallows for SeptuneBot. Only for your own site." },
      },
    },
    async handler(args) {
      const url = asUrl(args.url);
      const framework = asFramework(args.framework);
      const maxPages = pagesArg(args.maxPages, 25);
      const { engine, pages } = await runEngine(url, framework, maxPages, args.ignoreRobots === true);
      return JSON.stringify(
        {
          pagesCrawled: pages.length,
          categoryScores: engine.categoryScores,
          issues: compactIssues(engine),
          siteSignals: {
            maxClickDepth: engine.siteSignals.maxDepth,
            orphanPages: engine.siteSignals.orphanPages,
            brokenInternalLinks: engine.siteSignals.brokenInternalLinks.slice(0, 20),
            duplicateContentClusters: engine.siteSignals.duplicateClusters,
            internalLinkSuggestions: engine.siteSignals.linkSuggestions.slice(0, 15),
            topPagesByInternalPageRank: engine.siteSignals.authorityRanking.slice(0, 8),
          },
          nextSteps:
            "Fix issues directly in this repository. For issues with deterministicFixAvailable=true, call get_fix_template for an idiomatic starting patch. Re-run audit_site afterwards to verify.",
        },
        null,
        1,
      );
    },
  },
  {
    name: "compare_sites",
    description:
      "Compare two versions of a site and report SEO regressions: typically production (baseline) against your local dev server or a preview deployment (candidate). Pages are matched by path. Returns what changed (pages that now fail or redirect, new noindex, canonical changes, lost H1/description, robots.txt, sitemap, HTTPS certificate), new, worsened and fixed issues, and the score delta. Differences that only come from the environment (a preview's noindex header, its robots.txt, canonicals pointing at production) are listed separately and never counted as regressions. Run it before pushing to check a change didn't break SEO.",
    inputSchema: {
      type: "object",
      required: ["baselineUrl", "candidateUrl"],
      properties: {
        baselineUrl: { type: "string", description: "The reference version, usually production, e.g. https://example.com/" },
        candidateUrl: { type: "string", description: "The version to check, e.g. http://localhost:3000/ or a preview URL" },
        maxPages: { type: "integer", minimum: 1, maximum: 200, description: "Pages to crawl on each side (default 25)." },
      },
    },
    async handler(args) {
      const baselineUrl = asUrl(args.baselineUrl);
      const candidateUrl = asUrl(args.candidateUrl);
      const maxPages = pagesArg(args.maxPages, 25);
      const snapshotOf = async (url: string) => {
        const { pages, siteFiles } = await scanSite(url, { maxPages, hardCap: pageCap(), deadlineMs: 50_000 });
        const engine = runDeterministicAudit(synthRepo(url, "nextjs"), pages, siteFiles);
        const list: CategoryScore[] = (Object.entries(engine.categoryScores) as [SeoCategory, number][]).map(
          ([category, score]) => ({ category, score, issues: 0, weight: CATEGORY_WEIGHTS[category] }),
        );
        const geo = runGeoAudit(pages, siteFiles);
        return buildSnapshot({ url, pages, engine, overall: computeOverallScore(list), geo, siteFiles });
      };
      const before = await snapshotOf(baselineUrl);
      const after = await snapshotOf(candidateUrl);
      const d = diffSnapshots(before, after);
      const brief = (i: { ruleId: string; impact: string; title: string; paths: string[] }) => ({
        ruleId: i.ruleId,
        impact: i.impact,
        title: i.title,
        paths: i.paths.slice(0, 10),
      });
      return JSON.stringify(
        {
          summary: d.summary,
          level: d.level,
          crossOrigin: d.crossOrigin,
          score: { baseline: d.from.overall, candidate: d.to.overall, delta: d.overallDelta },
          changes: d.changes.slice(0, 40),
          newIssues: d.newIssues.map(brief),
          worsenedIssues: d.worsenedIssues.map(brief),
          fixedIssues: d.resolvedIssues.map((i) => i.title),
          environmentDifferences: d.environment.slice(0, 20),
          nextSteps:
            d.level === "critical"
              ? "Fix the critical changes before shipping: they remove pages from search (noindex, errors, robots.txt)."
              : "No critical regression. Review warnings, then ship.",
        },
        null,
        1,
      );
    },
  },
  {
    name: "audit_page",
    description:
      "Quick single-page technical-SEO check (no site crawl): fetches ONE URL and runs the rule engine on it — metadata, canonical, robots meta, headings, images, structured data, render-blocking resources, viewport, lang. Fast; ideal while iterating on one page.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "The page URL, e.g. http://localhost:3000/pricing" },
        framework: { type: "string", enum: FRAMEWORKS, description: "Site framework. Default nextjs." },
      },
    },
    async handler(args) {
      const url = asUrl(args.url);
      const framework = asFramework(args.framework);
      const { engine, pages } = await runEngine(url, framework, 1);
      const page = pages[0];
      return JSON.stringify(
        {
          url: page?.url,
          status: page?.statusCode,
          title: page?.title,
          metaDescription: page?.metaDescription,
          canonical: page?.canonical,
          wordCount: page?.wordCount,
          categoryScores: engine.categoryScores,
          issues: compactIssues(engine),
        },
        null,
        1,
      );
    },
  },
  {
    name: "get_fix_template",
    description:
      "Get Septune's deterministic, framework-idiomatic patch (unified diff + PR title/description + validation steps) for a mechanical SEO issue. Use the ruleId from audit_site/audit_page results where deterministicFixAvailable=true. Adapt the diff to the actual files in this repository before applying.",
    inputSchema: {
      type: "object",
      required: ["ruleId"],
      properties: {
        ruleId: { type: "string", enum: [...FIXABLE_RULES], description: "The mechanical rule to fix." },
        framework: { type: "string", enum: FRAMEWORKS, description: "Target framework. Default nextjs." },
        url: { type: "string", description: "The site's production/dev URL (used inside generated files). Default https://example.com/" },
      },
    },
    async handler(args) {
      const ruleId = String(args.ruleId ?? "");
      if (!(FIXABLE_RULES as readonly string[]).includes(ruleId)) {
        throw new Error(`Unknown ruleId. Fixable rules: ${FIXABLE_RULES.join(", ")}`);
      }
      const framework = asFramework(args.framework);
      const url = typeof args.url === "string" && args.url ? asUrl(args.url) : "https://example.com/";
      const repo = synthRepo(url, framework);
      const issue = {
        id: `iss_mcp:${ruleId}`,
        repoId: "mcp",
        title: ruleId,
        description: "",
        category: "framework",
        impact: "medium",
        effort: "low",
        risk: "low",
        confidence: 90,
        status: "open",
        affectedUrls: [{ url }],
        evidence: "",
        canAutoFix: true,
        files: [],
      } as unknown as SeoIssue;
      const fix = generateDeterministicFix(issue, repo);
      if (!fix) throw new Error("No deterministic template for this rule.");
      return JSON.stringify(fix, null, 1);
    },
  },
  {
    name: "seo_docs",
    description:
      "Search Septune's technical-SEO knowledge base (the same corpus behind septune docs): what each issue class means, why it matters, and how Septune fixes it. Grounded, local retrieval — cite the returned urls when explaining to the user.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: {
        question: { type: "string", description: "e.g. 'why do canonical URLs matter?' or 'how to fix missing alt text'" },
      },
    },
    async handler(args) {
      const q = String(args.question ?? "").slice(0, 500);
      if (!q.trim()) throw new Error("`question` is required.");
      const chunks = searchCorpus(q, { limit: 4 });
      return JSON.stringify(
        chunks.map((c) => ({ title: c.title, url: `${config.appUrl}${c.url}`, text: c.text })),
        null,
        1,
      );
    },
  },
  {
    name: "geo_audit",
    description:
      "AI-search (GEO) readiness audit: which AI crawlers robots.txt lets in (OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended…, split search vs. training), whether an llms.txt exists, whether page text is server-rendered (AI crawlers mostly don't run JS), and citability signals (answer-shaped schema, entity identity with sameAs, authorship, dates, question headings, concrete facts). Deterministic; measures readiness, not whether an engine will cite you.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Site URL, e.g. http://localhost:3000/ or https://example.com/" },
        maxPages: { type: "integer", minimum: 1, maximum: 200, description: "Pages to crawl (default 12; the hosted server caps at 24)." },
      },
    },
    async handler(args) {
      const url = asUrl(args.url);
      const { pages, siteFiles } = await scanSite(url, { maxPages: pagesArg(args.maxPages, 12), hardCap: pageCap(), deadlineMs: 80_000 });
      return JSON.stringify(runGeoAudit(pages, siteFiles), null, 1);
    },
  },
  {
    name: "generate_llms_txt",
    description:
      "Generate an llms.txt file (llmstxt.org) for a site from a crawl: site name, one-line summary, and a link list of its pages with descriptions. Write the result to public/llms.txt (or the framework's static folder).",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Site URL." },
        maxPages: { type: "integer", minimum: 1, maximum: 24, description: "Pages to include (default 12)." },
      },
    },
    async handler(args) {
      const url = asUrl(args.url);
      const { pages } = await scanSite(url, { maxPages: pagesArg(args.maxPages, 25), hardCap: pageCap(), deadlineMs: 80_000 });
      return buildLlmsTxt(pages, url);
    },
  },
  {
    name: "list_rules",
    description:
      "List Septune's technical-SEO rule catalog: every issue the audit can report, under the same ruleId audit_site returns, with its category, default impact, whether get_fix_template has a patch for it, and its documentation page.",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      return JSON.stringify(
        RULE_CATALOG.map((r) => ({
          id: r.id,
          category: r.category,
          impact: r.impact,
          title: r.title,
          deterministicFixAvailable: (FIXABLE_RULES as readonly string[]).includes(r.id),
          docs: `${config.appUrl}/docs/issues/${r.id}`,
        })),
        null,
        1,
      );
    },
  },
];
