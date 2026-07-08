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

export interface MeetingChapter {
  title: string;
  summary: string;
  start_segment_id: string;
  start_ms: number;
  end_ms: number;
}

export interface SpeakerParticipation {
  speaker_id: string;
  speaker_label: string;
  turns: number;
  talk_time_ms: number;
  word_count: number;
  percentage: number;
}

export interface EmailDraft {
  subject: string;
  body: string;
  generated_at?: string;
}

export interface RelatedMeeting {
  meeting_id: number;
  title: string;
  date: string;
  reason: string;
}

export interface ChangedDecision {
  current: string;
  previous: string;
  previous_meeting_id: number | null;
  note: string;
}

export interface RecurringAction {
  task: string;
  first_seen_meeting_id: number | null;
  occurrences: number;
  note: string;
}

export interface ContinuityReport {
  related_meetings: RelatedMeeting[];
  reverted_or_changed_decisions: ChangedDecision[];
  recurring_open_actions: RecurringAction[];
  recurring_topics: string[];
  summary: string;
  generated_at?: string;
}

export interface StructuredSummary {
  schema_version?: number;
  metadata?: {
    title: string;
    date: string;
    tags: string[];
    language?: string;
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
  summary_generation_warning?: string;
  risks?: string[];
  open_questions?: string[];
  unresolved_topics?: string[];
  chapters?: MeetingChapter[];
  participation?: SpeakerParticipation[];
  email_draft?: EmailDraft;
  continuity?: ContinuityReport;
}
