from typing import Literal

from pydantic import BaseModel, Field


SCHEMA_VERSION = 2


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


class MeetingIntelligence(BaseModel):
    schema_version: int = SCHEMA_VERSION
    tldr: str
    decisions: list[Decision] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    summary_points: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    unresolved_topics: list[str] = Field(default_factory=list)
