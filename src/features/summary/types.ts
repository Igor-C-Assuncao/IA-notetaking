export interface TranscriptWord {
  text: string;
  start_ms: number | null;
  end_ms: number | null;
  confidence: number | null;
}

export interface TranscriptSegment {
  segment_id: string;
  speaker_id: string | null;
  speaker_name: string | null;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
  words: TranscriptWord[];
}

export interface EvidenceMetadata {
  evidence_segment_ids?: string[];
  evidence_quote?: string | null;
  confidence?: number;
  inference?: boolean;
}

export interface StructuredSummary {
  schema_version?: number;
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
  key_decisions?: (EvidenceMetadata & {
    decision: string;
    rationale: string | null;
    owner: string | null;
  })[];
  action_items?: (EvidenceMetadata & {
    task: string;
    assignee: string | null;
    priority: "High" | "Medium" | "Low" | string | null;
    status: string;
    due_date: string | null;
  })[];
  summary_points?: string[];
  risks?: string[];
  open_questions?: string[];
  unresolved_topics?: string[];
}
