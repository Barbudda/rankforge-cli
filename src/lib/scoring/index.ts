import type {
  CategoryScore,
  Effort,
  Risk,
  SeoIssue,
  Severity,
} from "@/types";
import { CATEGORY_WEIGHTS, SEVERITY_META } from "@/lib/seo/constants";

/** Local clamp keeps the scoring (and the CLI that bundles it) free of UI deps. */
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Pure scoring helpers. Deliberately simple but credible: a weighted
 * blend of per-category health, plus a prioritization score that
 * balances impact against effort and risk.
 */

const IMPACT_POINTS: Record<Severity, number> = {
  critical: 12,
  high: 7,
  medium: 4,
  low: 2,
};

const EFFORT_FACTOR: Record<Effort, number> = {
  low: 1,
  medium: 0.7,
  high: 0.45,
};

const RISK_FACTOR: Record<Risk, number> = {
  low: 1,
  medium: 0.8,
  high: 0.55,
};

/** Weighted overall score from per-category scores. */
export function computeOverallScore(categories: CategoryScore[]): number {
  if (categories.length === 0) return 0;
  let total = 0;
  let weightSum = 0;
  for (const c of categories) {
    const weight = c.weight || CATEGORY_WEIGHTS[c.category] || 0;
    total += c.score * weight;
    weightSum += weight;
  }
  return Math.round(clamp(weightSum ? total / weightSum : 0, 0, 100));
}

/**
 * Priority score (0–100) for an issue. Higher = fix first.
 * High impact, low effort, low risk and high confidence float to the top.
 */
export function priorityScore(issue: SeoIssue): number {
  const impact = IMPACT_POINTS[issue.impact];
  const effort = EFFORT_FACTOR[issue.effort];
  const risk = RISK_FACTOR[issue.risk];
  const confidence = issue.confidence / 100;
  const raw = impact * effort * risk * confidence;
  // Normalize against the theoretical max (critical · low · low · 100%).
  const max = IMPACT_POINTS.critical * EFFORT_FACTOR.low * RISK_FACTOR.low;
  return Math.round(clamp((raw / max) * 100, 0, 100));
}

/** Sort issues by priority (descending), then by impact rank. */
export function sortByPriority(issues: SeoIssue[]): SeoIssue[] {
  return [...issues].sort((a, b) => {
    const p = priorityScore(b) - priorityScore(a);
    if (p !== 0) return p;
    return SEVERITY_META[b.impact].rank - SEVERITY_META[a.impact].rank;
  });
}

/** "Impact points" resolved — used for the dashboard "impact fixed" stat. */
export function impactPoints(issue: SeoIssue): number {
  return IMPACT_POINTS[issue.impact];
}

/** A→F letter grade for a numeric score. */
export function scoreGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  if (score >= 50) return "E";
  return "F";
}

/** Tailwind-friendly color token for a score band. */
export function scoreColor(score: number): string {
  if (score >= 80) return "var(--color-signal)";
  if (score >= 65) return "var(--color-cyan)";
  if (score >= 50) return "var(--color-medium)";
  return "var(--color-critical)";
}
