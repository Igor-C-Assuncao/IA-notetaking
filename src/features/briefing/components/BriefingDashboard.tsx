// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { useState } from "react";
import {
  ArrowsClockwiseIcon,
  BookOpenIcon,
  ChartBarIcon,
  CircleDashedIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  QuestionIcon,
  WarningIcon,
} from "@phosphor-icons/react";

import { FollowUpColumn } from "@features/summary/components/SummaryDashboard";
import { formatSegmentTime } from "@shared/lib/formatSegmentTime";
import type { StructuredSummary } from "@features/summary/types";

interface BriefingDashboardProps {
  summary: StructuredSummary;
  onViewEvidence?: (segmentId: string) => void;
  onGenerateFollowUp?: () => void;
  isGeneratingFollowUp?: boolean;
  canGenerateFollowUp?: boolean;
  onAnalyzeContinuity?: () => void;
  isAnalyzingContinuity?: boolean;
  canAnalyzeContinuity?: boolean;
  onOpenMeeting?: (meetingId: number) => void;
  onCopy?: (text: string) => Promise<boolean>;
}

function prettySpeakerLabel(label: string) {
  // Diarization labels arrive as SPEAKER_00; show "Speaker 1" instead
  const match = label.match(/^SPEAKER_(\d+)$/);
  if (!match) return label;
  return `Speaker ${parseInt(match[1], 10) + 1}`;
}

export function BriefingDashboard({
  summary,
  onViewEvidence,
  onGenerateFollowUp,
  isGeneratingFollowUp = false,
  canGenerateFollowUp = true,
  onAnalyzeContinuity,
  isAnalyzingContinuity = false,
  canAnalyzeContinuity = true,
  onOpenMeeting,
  onCopy,
}: BriefingDashboardProps) {
  const [copiedEmail, setCopiedEmail] = useState(false);

  const chapters = summary.chapters ?? [];
  const participation = summary.participation ?? [];
  const emailDraft = summary.email_draft;
  const hasFollowUps =
    (summary.risks?.length ?? 0) > 0 ||
    (summary.open_questions?.length ?? 0) > 0 ||
    (summary.unresolved_topics?.length ?? 0) > 0;
  const hasTimestamps = chapters.some((chapter) => chapter.end_ms > 0);
  const participationByWords = participation.every((entry) => entry.talk_time_ms === 0);

  const handleCopyEmail = async () => {
    if (!emailDraft || !onCopy) return;
    const success = await onCopy(`${emailDraft.subject}\n\n${emailDraft.body}`);
    if (success) {
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  const hasBriefingData = chapters.length > 0 || participation.length > 0 || hasFollowUps;
  const continuity = summary.continuity;

  if (!hasBriefingData && !emailDraft && !continuity && !onGenerateFollowUp && !onAnalyzeContinuity) {
    return (
      <div className="empty-state">
        <span>
          No briefing data for this meeting yet. Use "Reprocess" to regenerate the
          summary with chapters and participation stats.
        </span>
      </div>
    );
  }

  return (
    <div className="summary-dashboard">
      {!hasBriefingData && (
        <p className="summary-item-muted">
          No chapters or participation stats for this meeting yet — use "Reprocess" to
          regenerate the summary with them.
        </p>
      )}
      {chapters.length > 0 && (
        <section className="summary-column">
          <h3 className="summary-column-title">
            <BookOpenIcon className="summary-icon accent" />
            Chapters
          </h3>
          <div className="briefing-chapter-list">
            {chapters.map((chapter) => (
              <button
                key={chapter.start_segment_id}
                type="button"
                className="briefing-chapter"
                onClick={() => onViewEvidence?.(chapter.start_segment_id)}
                title="Jump to this chapter in the transcript"
              >
                <div className="briefing-chapter-header">
                  <span className="briefing-chapter-title">{chapter.title}</span>
                  {hasTimestamps && (
                    <span className="briefing-chapter-time">
                      {formatSegmentTime(chapter.start_ms)}–{formatSegmentTime(chapter.end_ms)}
                    </span>
                  )}
                </div>
                {chapter.summary && <p className="briefing-chapter-summary">{chapter.summary}</p>}
              </button>
            ))}
          </div>
        </section>
      )}

      {participation.length > 0 && (
        <section className="summary-column">
          <h3 className="summary-column-title">
            <ChartBarIcon className="summary-icon accent" />
            Participation
          </h3>
          <div className="participation-list">
            {participation.map((entry) => (
              <div key={entry.speaker_id} className="participation-row">
                <div className="participation-meta">
                  <span className="participation-speaker">{prettySpeakerLabel(entry.speaker_label)}</span>
                  <span className="participation-detail">
                    {entry.percentage}% · {entry.turns} {entry.turns === 1 ? "turn" : "turns"}
                    {entry.talk_time_ms > 0 ? ` · ${formatSegmentTime(entry.talk_time_ms)}` : ""}
                  </span>
                </div>
                <div className="participation-track">
                  <div className="participation-fill" style={{ width: `${entry.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
          {participationByWords && (
            <p className="summary-item-muted">Estimated by words spoken (no timestamps available).</p>
          )}
        </section>
      )}

      {hasFollowUps && (
        <section className="summary-two-column">
          <FollowUpColumn
            title="Risks"
            icon={<WarningIcon className="summary-icon warning" />}
            items={summary.risks}
          />
          <FollowUpColumn
            title="Open Questions"
            icon={<QuestionIcon className="summary-icon accent" />}
            items={summary.open_questions}
          />
          <FollowUpColumn
            title="Unresolved Topics"
            icon={<CircleDashedIcon className="summary-icon muted" />}
            items={summary.unresolved_topics}
          />
        </section>
      )}

      <section className="summary-column">
        <h3 className="summary-column-title">
          <EnvelopeSimpleIcon className="summary-icon accent" />
          Follow-up Email
        </h3>
        {emailDraft ? (
          <div className="briefing-email-card">
            <p className="briefing-email-subject">{emailDraft.subject}</p>
            <pre className="briefing-email-body">{emailDraft.body}</pre>
            <div className="briefing-email-actions">
              <button className="chip-btn" onClick={handleCopyEmail}>
                <CopyIcon size={13} /> {copiedEmail ? "✓ Copied!" : "Copy"}
              </button>
              {onGenerateFollowUp && (
                <button
                  className="chip-btn"
                  onClick={onGenerateFollowUp}
                  disabled={isGeneratingFollowUp || !canGenerateFollowUp}
                >
                  <ArrowsClockwiseIcon size={13} />
                  {isGeneratingFollowUp ? "Generating…" : "Regenerate"}
                </button>
              )}
            </div>
          </div>
        ) : onGenerateFollowUp ? (
          <div className="briefing-email-empty">
            <button
              className="chip-btn"
              onClick={onGenerateFollowUp}
              disabled={isGeneratingFollowUp || !canGenerateFollowUp}
              title={canGenerateFollowUp ? undefined : "Save the meeting first to generate a follow-up"}
            >
              <EnvelopeSimpleIcon size={13} />
              {isGeneratingFollowUp ? "Generating…" : "Generate follow-up email"}
            </button>
            {!canGenerateFollowUp && (
              <p className="summary-item-muted">Available once the meeting is saved.</p>
            )}
          </div>
        ) : null}
      </section>

      {(continuity || onAnalyzeContinuity) && (
        <section className="summary-column">
          <h3 className="summary-column-title">
            <ClockCounterClockwiseIcon className="summary-icon accent" />
            Continuity
          </h3>
          {continuity ? (
            continuity.related_meetings.length === 0 ? (
              <>
                <p className="summary-item-muted">
                  No previous meetings to compare — this looks like the first meeting on this topic.
                </p>
                {onAnalyzeContinuity && (
                  <div className="briefing-email-actions">
                    <button
                      className="chip-btn"
                      onClick={onAnalyzeContinuity}
                      disabled={isAnalyzingContinuity || !canAnalyzeContinuity}
                    >
                      <ArrowsClockwiseIcon size={13} />
                      {isAnalyzingContinuity ? "Analyzing…" : "Re-analyze"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="briefing-email-card">
                <div className="continuity-chip-row">
                  {continuity.related_meetings.map((rm) => (
                    <button
                      key={rm.meeting_id}
                      type="button"
                      className="continuity-chip"
                      title={`${rm.reason} — open this meeting`}
                      onClick={() => onOpenMeeting?.(rm.meeting_id)}
                    >
                      {rm.title} · {rm.date.split(" ")[0]}
                    </button>
                  ))}
                </div>
                {continuity.summary && <p className="continuity-summary">{continuity.summary}</p>}

                {continuity.reverted_or_changed_decisions.length > 0 && (
                  <div className="continuity-group">
                    <h4 className="continuity-group-title">Changed / reverted decisions</h4>
                    {continuity.reverted_or_changed_decisions.map((item, i) => (
                      <div key={i} className="continuity-diff-item">
                        {item.previous && <p className="continuity-previous">{item.previous}</p>}
                        <p className="continuity-current">{item.current}</p>
                        {item.note && <p className="summary-item-muted">{item.note}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {continuity.recurring_open_actions.length > 0 && (
                  <div className="continuity-group">
                    <h4 className="continuity-group-title">Recurring open actions</h4>
                    <ul className="summary-followup-list">
                      {continuity.recurring_open_actions.map((item, i) => (
                        <li key={i}>
                          {item.task}{" "}
                          <span className="continuity-occurrences-badge">×{item.occurrences}</span>
                          {item.note && <span className="summary-item-muted"> — {item.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {continuity.recurring_topics.length > 0 && (
                  <div className="continuity-group">
                    <h4 className="continuity-group-title">Recurring topics</h4>
                    <div className="continuity-chip-row">
                      {continuity.recurring_topics.map((topic) => (
                        <span key={topic} className="continuity-chip static">{topic}</span>
                      ))}
                    </div>
                  </div>
                )}

                {onAnalyzeContinuity && (
                  <div className="briefing-email-actions">
                    <button
                      className="chip-btn"
                      onClick={onAnalyzeContinuity}
                      disabled={isAnalyzingContinuity || !canAnalyzeContinuity}
                    >
                      <ArrowsClockwiseIcon size={13} />
                      {isAnalyzingContinuity ? "Analyzing…" : "Re-analyze"}
                    </button>
                  </div>
                )}
              </div>
            )
          ) : onAnalyzeContinuity ? (
            <div className="briefing-email-empty">
              <button
                className="chip-btn"
                onClick={onAnalyzeContinuity}
                disabled={isAnalyzingContinuity || !canAnalyzeContinuity}
                title={canAnalyzeContinuity ? undefined : "Save the meeting first to analyze continuity"}
              >
                <ClockCounterClockwiseIcon size={13} />
                {isAnalyzingContinuity ? "Analyzing…" : "Analyze continuity"}
              </button>
              {!canAnalyzeContinuity && (
                <p className="summary-item-muted">Available once the meeting is saved.</p>
              )}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
