import type { AgentMode } from "@/types";

/**
 * The modification-autonomy spectrum, ordered from least to most invasive.
 * The UI renders this ladder so a user can choose exactly how far Septune
 * is allowed to go on their site — from plain advice to full root autonomy.
 */
export interface AutonomyLevel {
  id: AgentMode;
  step: number; // 1..5
  label: string;
  short: string;
  description: string;
  /** Does this level write to GitHub at all? */
  writes: boolean;
  /** Risk posture, drives the color accent. */
  risk: "none" | "low" | "medium" | "high";
}

export const AUTONOMY_LEVELS: AutonomyLevel[] = [
  {
    id: "advisor",
    step: 1,
    label: "Advisor",
    short: "Advice only",
    description:
      "Detects issues and explains the fix in plain language. Recommendations only: no code, no diffs.",
    writes: false,
    risk: "none",
  },
  {
    id: "suggest",
    step: 2,
    label: "Suggest",
    short: "Suggested patches",
    description:
      "Generates a ready-to-copy diff for every issue, pointed at the files most likely behind it.",
    writes: false,
    risk: "none",
  },
  {
    id: "draft_pr",
    step: 3,
    label: "Draft PRs",
    short: "Draft pull requests",
    description:
      "Prepares a draft pull request in Septune for each fix, for you to review and apply. Pushing to GitHub comes with the GitHub App, on the roadmap.",
    writes: true,
    risk: "low",
  },
  {
    id: "auto_low_risk",
    step: 4,
    label: "Auto · low-risk",
    short: "Auto-ready PRs",
    description:
      "Prepares ready pull requests for low-risk fixes and drafts for the rest, in Septune. Pushing to GitHub comes with the GitHub App.",
    writes: true,
    risk: "medium",
  },
  {
    id: "autopilot",
    step: 5,
    label: "Autopilot",
    short: "Root · full autonomy",
    description:
      "Prepares fixes across every category and path as soon as they're found. Pushing to GitHub comes with the GitHub App.",
    writes: true,
    risk: "high",
  },
];

export function getAutonomyLevel(id: AgentMode): AutonomyLevel {
  return AUTONOMY_LEVELS.find((l) => l.id === id) ?? AUTONOMY_LEVELS[0]!;
}

export const RISK_ACCENT: Record<AutonomyLevel["risk"], string> = {
  none: "var(--color-signal)",
  low: "var(--color-cyan)",
  medium: "var(--color-amber)",
  high: "var(--color-danger)",
};
