#!/usr/bin/env node
// Posts RankForge's result on the pull request as ONE comment, updated in
// place on every push (found again by a hidden marker), the way coverage and
// Lighthouse bots do. Run by action.yml; zero dependencies, Node 18+.
//
//   node pr-comment.mjs <markdown-file>
//
// Reads GITHUB_EVENT_PATH (must be a pull_request event), GITHUB_REPOSITORY
// and the token in RF_GITHUB_TOKEN (needs `pull-requests: write`). Anything
// missing or refused ends with a warning and exit 0: a comment that can't be
// posted must never fail the SEO check itself.
import { existsSync, readFileSync } from "node:fs";

const MARKER = "<!-- rankforge-check -->";
// GitHub rejects comment bodies over 65,536 characters.
const MAX_BODY = 60_000;
const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

function warn(message) {
  console.log(`::warning title=RankForge::${message}`);
  process.exit(0);
}

const file = process.argv[2];
if (!file || !existsSync(file)) warn("Nothing to comment: no report was written.");
let report = readFileSync(file, "utf8").trim();
if (!report) warn("Nothing to comment: the report is empty.");
if (report.length > MAX_BODY) report = `${report.slice(0, MAX_BODY)}\n\n…report cut to fit a GitHub comment.`;

let pr = null;
try {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
  pr = event.pull_request?.number ?? null;
} catch {
  // No event file: not running in GitHub Actions.
}
if (!pr) {
  console.log("RankForge: not a pull request, so no comment.");
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.RF_GITHUB_TOKEN;
if (!repo || !token) warn("Can't comment: GITHUB_REPOSITORY or the token is missing.");

const headers = {
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "content-type": "application/json",
  "user-agent": "rankforge-action",
};

async function call(method, path, payload) {
  let res;
  try {
    res = await fetch(`${api}${path}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  } catch (e) {
    warn(`Couldn't reach the GitHub API (${e instanceof Error ? e.message : e}).`);
  }
  if (res.status === 403 || res.status === 404) {
    // A job without the permission gets 403; a pull request from a fork gets
    // a read-only token whatever the workflow asks for.
    warn(
      `GitHub refused the comment (HTTP ${res.status}). Give the job "permissions: pull-requests: write"; pull requests from forks can't be commented on.`,
    );
  }
  if (!res.ok) warn(`GitHub answered HTTP ${res.status} to ${method} ${path}.`);
  return res.json();
}

const body = [
  MARKER,
  report,
  "",
  "<sub>Measured by [RankForge](https://github.com/Barbudda/rankforge-cli): deterministic, no AI, never writes to your repository. Reproduce it locally with <code>npx rankforge-cli</code>.</sub>",
].join("\n");

// The comment from an earlier push, if any (newest pull requests rarely pass
// a few hundred comments, so ten pages is plenty).
let existing = null;
for (let page = 1; page <= 10 && !existing; page++) {
  const list = await call("GET", `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`);
  if (!Array.isArray(list) || list.length === 0) break;
  existing = list.find((c) => typeof c.body === "string" && c.body.startsWith(MARKER)) ?? null;
  if (list.length < 100) break;
}

if (existing) await call("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body });
else await call("POST", `/repos/${repo}/issues/${pr}/comments`, { body });
console.log(`RankForge: ${existing ? "updated" : "posted"} the pull-request comment.`);
