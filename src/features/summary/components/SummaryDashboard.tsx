// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import {
  CalendarIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  FlagIcon,
  HashIcon,
  ListBulletsIcon,
  QuestionIcon,
  QuotesIcon,
  UsersIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { StructuredSummary } from "../types";

interface SummaryDashboardProps {
  summary: StructuredSummary;
  onViewEvidence?: (segmentId: string) => void;
}

function confidenceLabel(confidence?: number) {
  if (confidence === undefined) return null;
  if (confidence >= 0.85) return "High confidence";
  if (confidence >= 0.6) return "Medium confidence";
  return "Low confidence";
}

function EvidenceDetails({
  evidenceQuote,
  evidenceSegmentIds,
  confidence,
  inference,
  onViewEvidence,
}: {
  evidenceQuote?: string | null;
  evidenceSegmentIds?: string[];
  confidence?: number;
  inference?: boolean;
  onViewEvidence?: (segmentId: string) => void;
}) {
  const label = confidenceLabel(confidence);
  const firstSegmentId = evidenceSegmentIds?.[0];

  if (!evidenceQuote && !label && !inference) return null;

  return (
    <div className="summary-evidence">
      <div className="summary-evidence-badges">
        {label && (
          <span className="summary-badge neutral">
            {label}
            {confidence !== undefined ? ` - ${Math.round(confidence * 100)}%` : ""}
          </span>
        )}
        {inference && <span className="summary-badge warning">Inferred</span>}
      </div>
      {evidenceQuote && (
        <div className="summary-evidence-card">
          <div className="summary-evidence-label">
            <QuotesIcon />
            Transcript evidence
          </div>
          <p>{evidenceQuote}</p>
          {firstSegmentId && onViewEvidence && (
            <button
              type="button"
              className="summary-evidence-link"
              onClick={() => onViewEvidence(firstSegmentId)}
            >
              View in transcript
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FollowUpColumn({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items?: string[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="summary-column">
      <h3 className="summary-column-title">
        {icon}
        {title}
      </h3>
      <ul className="summary-followup-list">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function SummaryDashboard({ summary, onViewEvidence }: SummaryDashboardProps) {
  const hasFollowUps =
    (summary.risks?.length ?? 0) > 0 ||
    (summary.open_questions?.length ?? 0) > 0 ||
    (summary.unresolved_topics?.length ?? 0) > 0;

  return (
    <div className="summary-dashboard">
      <section className="summary-hero">
        <h2 className="summary-section-title">
          <FlagIcon weight="bold" />
          The Bottom Line
        </h2>
        <p className="summary-hero-text">
          {summary.tldr || "No summary generated."}
        </p>

        {summary.metadata?.tags && summary.metadata.tags.length > 0 && (
          <div className="summary-tags">
            {summary.metadata.tags.map(tag => (
              <span key={tag} className="summary-tag">
                <HashIcon />
                {tag}
              </span>
            ))}
          </div>
        )}

        {summary.summary_generation_warning && (
          <p className="summary-item-muted">{summary.summary_generation_warning}</p>
        )}
      </section>

      {summary.summary_points && summary.summary_points.length > 0 && (
        <section className="summary-column">
          <h3 className="summary-column-title">
            <ListBulletsIcon className="summary-icon accent" />
            Key Points
          </h3>
          <ul className="summary-followup-list">
            {summary.summary_points.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      {summary.metrics && summary.metrics.length > 0 && (
        <section className="summary-metrics-grid">
          {summary.metrics.map((metric, i) => (
            <div key={i} className="summary-metric-card">
              <span className="summary-metric-label">{metric.label}</span>
              <div className="summary-metric-row">
                <span className="summary-metric-value">{metric.value}</span>
                {metric.trend && (
                  <span className={`summary-trend ${metric.trend.toLowerCase()}`}>
                    {metric.trend}
                  </span>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="summary-two-column">
        {summary.key_decisions && summary.key_decisions.length > 0 && (
          <div className="summary-column">
            <h3 className="summary-column-title">
              <CheckCircleIcon className="summary-icon success" />
              Key Decisions
            </h3>
            <div className="summary-timeline">
              {summary.key_decisions.map((dec, i) => (
                <div key={i} className="summary-decision">
                  <div className="summary-timeline-dot" />
                  <p className="summary-item-title">{dec.decision}</p>
                  {dec.rationale && <p className="summary-item-muted">{dec.rationale}</p>}
                  {dec.owner && <span className="summary-owner">Owned by: {dec.owner}</span>}
                  <EvidenceDetails
                    evidenceQuote={dec.evidence_quote}
                    evidenceSegmentIds={dec.evidence_segment_ids}
                    confidence={dec.confidence}
                    inference={dec.inference}
                    onViewEvidence={onViewEvidence}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {summary.action_items && summary.action_items.length > 0 && (
          <div className="summary-column">
            <h3 className="summary-column-title">
              <UsersIcon className="summary-icon accent" />
              Action Items
            </h3>
            <div className="summary-action-list">
              {summary.action_items.map((item, i) => (
                <div key={i} className="summary-action-card">
                  <input
                    type="checkbox"
                    className="summary-action-checkbox"
                    aria-label={`Mark action item ${i + 1} complete`}
                  />
                  <div className="summary-action-content">
                    <p className="summary-item-title">{item.task}</p>
                    <div className="summary-action-meta">
                      {item.assignee && (
                        <span className="summary-meta-pill">
                          <UsersIcon />
                          {item.assignee}
                        </span>
                      )}
                      {item.due_date && (
                        <span className="summary-meta-muted">
                          <CalendarIcon />
                          {item.due_date}
                        </span>
                      )}
                      {item.priority && (
                        <span className={`summary-priority ${item.priority.toLowerCase()}`}>
                          <WarningIcon />
                          {item.priority}
                        </span>
                      )}
                    </div>
                    <EvidenceDetails
                      evidenceQuote={item.evidence_quote}
                      evidenceSegmentIds={item.evidence_segment_ids}
                      confidence={item.confidence}
                      inference={item.inference}
                      onViewEvidence={onViewEvidence}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

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
    </div>
  );
}
