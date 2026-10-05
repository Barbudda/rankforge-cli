import type { AgentMode } from "@/types";

/**
 * The modification-autonomy spectrum, ordered from least to most invasive.
 * The UI renders this ladder so a user can choose exactly how far RankForge
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
      "Detects issues and explains the fix in plain language. No code, no diffs, no GitHub access — just expert recommendations.",
    writes: false,
    risk: "none",
  },
  {
    id: "suggest",
    step: 2,
    label: "Suggest",
    short: "Suggested patches",
    description:
      "Generates a ready-to-copy diff for every issue, mapped to the exact files. Read-only — never touches GitHub.",
    writes: false,
    risk: "none",
  },
  {
    id: "draft_pr",
    step: 3,
    label: "Draft PRs",
    short: "Draft pull requests",
    description:
      "Opens draft pull requests on a dedicated branch for you to review and finish. Nothing merges without you.",
    writes: true,
    risk: "low",
  },
  {
    id: "auto_low_risk",
    step: 4,
    label: "Auto · low-risk",
    short: "Auto-ready PRs",
    description:
      "Automatically opens ready-to-merge PRs for low-risk fixes; higher-risk changes still arrive as drafts to review.",
    writes: true,
    risk: "medium",
  },
  {
    id: "autopilot",
    step: 5,
    label: "Autopilot",
    short: "Root · full autonomy",
    description:
      "Maximum autonomy across every category and path — keeps your site continuously optimized at the root. Reserve for repos you fully trust.",
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
