export interface StructuredSummary {
  metadata?: {
    title: string;
    date: string;
    tags: string[];
  };
  tldr?: string;
  participants?: {
    name: string;
    role: string;
    engagement_level: string;
  }[];
  metrics?: {
    label: string;
    value: string;
    trend: string;
  }[];
  key_decisions?: {
    decision: string;
    rationale: string;
    owner: string;
  }[];
  action_items?: {
    task: string;
    assignee: string;
    priority: "High" | "Medium" | "Low" | string;
    status: string;
    due_date: string;
  }[];
  summary_points?: string[];
}
