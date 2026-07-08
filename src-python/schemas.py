from typing import Literal

from pydantic import BaseModel, Field


SCHEMA_VERSION = 3


class TranscriptWord(BaseModel):
    text: str
    start_ms: int | None = None
    end_ms: int | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)


class TranscriptSegment(BaseModel):
    segment_id: str
    speaker_id: str | None = None
    speaker_name: str | None = None
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    words: list[TranscriptWord] = Field(default_factory=list)


class EvidenceClaim(BaseModel):
    evidence_segment_ids: list[str] = Field(default_factory=list)
    evidence_quote: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    inference: bool = False


class Decision(EvidenceClaim):
    decision: str
    rationale: str | None = None
    owner: str | None = None


class ActionItem(EvidenceClaim):
    task: str
    assignee: str | None = None
    due_date: str | None = None
    priority: Literal["High", "Medium", "Low"] | None = None
    status: Literal["open", "completed", "cancelled"] = "open"


# ---------------------------------------------------------
# Native structured-output schemas (one per LLM pipeline node)
# ---------------------------------------------------------
class EntitySpeaker(BaseModel):
    name: str
    role_hint: str | None = None
    first_mention_idx: int | None = None


class EntityNumber(BaseModel):
    value: str
    context: str
    category: str


class EntityDate(BaseModel):
    raw: str
    iso: str | None = None
    context: str


class EntityAcronym(BaseModel):
    term: str
    expansion: str | None = None


class ExtractedEntities(BaseModel):
    speakers: list[EntitySpeaker] = Field(default_factory=list)
    numbers: list[EntityNumber] = Field(default_factory=list)
    dates: list[EntityDate] = Field(default_factory=list)
    projects: list[str] = Field(default_factory=list)
    acronyms: list[EntityAcronym] = Field(default_factory=list)


class DecisionCandidate(BaseModel):
    """Raw decision claim from the LLM, before evidence validation."""
    decision: str
    rationale: str | None = None
    owner: str | None = None
    evidence_segment_ids: list[str] = Field(default_factory=list)
    evidence_quote: str | None = None
    confidence: float | None = None
    inference: bool = False


class ActionCandidate(BaseModel):
    """Raw action-item claim from the LLM, before evidence validation."""
    task: str
    assignee: str | None = None
    due_date: str | None = None
    priority: str | None = None
    status: str = "open"
    evidence_segment_ids: list[str] = Field(default_factory=list)
    evidence_quote: str | None = None
    confidence: float | None = None
    inference: bool = False


class ClaimExtraction(BaseModel):
    decisions: list[DecisionCandidate] = Field(default_factory=list)
    actions: list[ActionCandidate] = Field(default_factory=list)


class ChapterCandidate(BaseModel):
    """Raw chapter from the LLM, before segment-id validation."""
    title: str
    start_segment_id: str
    summary: str = ""


class ChapterExtraction(BaseModel):
    chapters: list[ChapterCandidate] = Field(default_factory=list)


class MeetingChapter(BaseModel):
    """Final chapter shape merged into the structured summary.

    Timestamps are derived deterministically from the transcript segments,
    never taken from the LLM.
    """
    title: str
    summary: str = ""
    start_segment_id: str
    start_ms: int = 0
    end_ms: int = 0


class SpeakerParticipation(BaseModel):
    """Deterministic per-speaker stats computed from diarized segments."""
    speaker_id: str
    speaker_label: str
    turns: int = 0
    talk_time_ms: int = 0
    word_count: int = 0
    percentage: float = 0.0


class FollowUpEmail(BaseModel):
    subject: str = ""
    body: str = ""


class ChangedDecision(BaseModel):
    current: str
    previous: str = ""
    previous_meeting_id: int | None = None
    note: str = ""


class RecurringAction(BaseModel):
    task: str
    first_seen_meeting_id: int | None = None
    occurrences: int = 1
    note: str = ""


class ContinuityAnalysis(BaseModel):
    """LLM output for the cross-meeting continuity diff.

    related_meetings is deliberately NOT part of this schema: it is built
    deterministically from the RAG selection so meeting ids/titles/dates
    can never be hallucinated.
    """
    reverted_or_changed_decisions: list[ChangedDecision] = Field(default_factory=list)
    recurring_open_actions: list[RecurringAction] = Field(default_factory=list)
    recurring_topics: list[str] = Field(default_factory=list)
    summary: str = ""


class SummaryMetadata(BaseModel):
    title: str = "Meeting Summary"
    date: str = ""
    tags: list[str] = Field(default_factory=list)


class SummaryParticipant(BaseModel):
    name: str
    role: str = ""
    engagement_level: str = ""


class SummaryMetric(BaseModel):
    label: str
    value: str
    trend: str = ""


class StructuredMeetingSummary(BaseModel):
    """Node 4 output. Decisions/actions are merged in later from verified claims."""
    metadata: SummaryMetadata = Field(default_factory=SummaryMetadata)
    tldr: str = ""
    participants: list[SummaryParticipant] = Field(default_factory=list)
    metrics: list[SummaryMetric] = Field(default_factory=list)
    summary_points: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    unresolved_topics: list[str] = Field(default_factory=list)


class MeetingIntelligence(BaseModel):
    schema_version: int = SCHEMA_VERSION
    tldr: str
    decisions: list[Decision] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    summary_points: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    unresolved_topics: list[str] = Field(default_factory=list)
