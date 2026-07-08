import type { StructuredSummary } from "@features/summary/types";

export interface CompactSummary {
  tldr: string;
  tags: string[];
  key_decisions: { decision: string; owner: string | null }[];
  action_items: { task: string; assignee: string | null; status: string; due_date: string | null }[];
  open_questions: string[];
  unresolved_topics: string[];
}

// Trims a structured summary to what the continuity analysis needs.
// Tolerant to meetings saved with older schema versions (missing fields).
export function compactSummaryForContinuity(summary: StructuredSummary): CompactSummary {
  return {
    tldr: (summary.tldr ?? "").slice(0, 400),
    tags: (summary.metadata?.tags ?? []).slice(0, 8),
    key_decisions: (summary.key_decisions ?? [])
      .filter((d) => d?.decision)
      .slice(0, 10)
      .map((d) => ({ decision: d.decision, owner: d.owner ?? null })),
    action_items: (summary.action_items ?? [])
      .filter((a) => a?.task)
      .slice(0, 15)
      .map((a) => ({
        task: a.task,
        assignee: a.assignee ?? null,
        status: a.status ?? "open",
        due_date: a.due_date ?? null,
      })),
    open_questions: (summary.open_questions ?? []).slice(0, 8),
    unresolved_topics: (summary.unresolved_topics ?? []).slice(0, 8),
  };
}
