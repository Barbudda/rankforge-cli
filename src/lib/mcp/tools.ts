import type { Framework, Repository, SeoIssue } from "@/types";
import { crawl, probeSiteFiles } from "@/lib/agents/crawl";
import { runDeterministicAudit } from "@/lib/audit/engine";
import { probeResources } from "@/lib/audit/resource-probe";
import { generateDeterministicFix } from "@/lib/audit/deterministic-fix";
import { SEO_RULES } from "@/lib/audit/rules";
import { searchCorpus } from "@/lib/support/corpus";
import { ruleSlug } from "@/lib/seo/content";
import { runGeoAudit, buildLlmsTxt } from "@/lib/audit/geo";
import { config } from "@/lib/config";

/**
 * The RankForge agent's MCP toolbox — what an AI coding assistant (Claude
 * Code, Cursor, VS Code, Windsurf…) can call from the developer's editor.
 *
 * Design: the tools do the MEASURING (RankForge's deterministic engine — no
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

async function runEngine(url: string, framework: Framework, maxPages: number) {
  const repo = synthRepo(url, framework);
  // Keep the whole audit inside the route's 120s budget even for slow sites.
  const [pages, siteFiles] = await Promise.all([
    crawl(url, { maxPages, deadlineMs: 80_000 }),
    probeSiteFiles(url),
  ]);
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
      "Run RankForge's full deterministic technical-SEO audit on a site (crawls up to `maxPages` pages breadth-first, probes robots/sitemap, measures image weights and link statuses, builds the internal link graph). Returns category scores (0-100), every detected issue with evidence and affected URLs, plus site signals: orphan pages, click depth, near-duplicate content clusters, and semantic internal-link suggestions. Works on localhost dev servers. No LLM involved — results are measured, not guessed.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Start URL, e.g. http://localhost:3000/ or https://example.com/" },
        framework: { type: "string", enum: FRAMEWORKS, description: "Site framework (improves file hints). Default nextjs." },
        maxPages: { type: "integer", minimum: 1, maximum: 24, description: "Pages to crawl (default 8)." },
      },
    },
    async handler(args) {
      const url = asUrl(args.url);
      const framework = asFramework(args.framework);
      const maxPages = Math.max(1, Math.min(Number(args.maxPages) || 8, 24));
      const { engine, pages } = await runEngine(url, framework, maxPages);
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
      "Get RankForge's deterministic, framework-idiomatic patch (unified diff + PR title/description + validation steps) for a mechanical SEO issue. Use the ruleId from audit_site/audit_page results where deterministicFixAvailable=true. Adapt the diff to the actual files in this repository before applying.",
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
      "Search RankForge's technical-SEO knowledge base (the same corpus behind rankforge docs): what each issue class means, why it matters, and how RankForge fixes it. Grounded, local retrieval — cite the returned urls when explaining to the user.",
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
        maxPages: { type: "integer", minimum: 1, maximum: 24, description: "Pages to crawl (default 8)." },
      },
    },
    async handler(args) {
      const url = asUrl(args.url);
      const maxPages = Math.max(1, Math.min(Number(args.maxPages) || 8, 24));
      const [pages, siteFiles] = await Promise.all([
        crawl(url, { maxPages, deadlineMs: 80_000 }),
        probeSiteFiles(url),
      ]);
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
      const maxPages = Math.max(1, Math.min(Number(args.maxPages) || 12, 24));
      const pages = await crawl(url, { maxPages, deadlineMs: 80_000 });
      return buildLlmsTxt(pages, url);
    },
  },
  {
    name: "list_rules",
    description:
      "List RankForge's technical-SEO rule catalog: every issue class the audit detects, its category, default impact, whether a deterministic fix template exists, and its documentation URL.",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      return JSON.stringify(
        SEO_RULES.map((r) => ({
          id: r.id,
          category: r.category,
          title: r.title,
          impact: r.defaultImpact,
          canAutoFix: r.canAutoFix,
          docs: `${config.appUrl}/docs/issues/${ruleSlug(r.id)}`,
        })),
        null,
        1,
      );
    },
  },
];
