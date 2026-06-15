import { StructuredSummary } from "../types";
import { CheckCircleIcon, FlagIcon, UsersIcon, WarningIcon, CalendarIcon, HashIcon, QuotesIcon } from "@phosphor-icons/react";

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
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
        {label && (
          <span className="rounded-full bg-slate-500/10 px-2 py-1 text-slate-600 dark:text-slate-300">
            {label}{confidence !== undefined ? ` · ${Math.round(confidence * 100)}%` : ""}
          </span>
        )}
        {inference && (
          <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
            Inferred
          </span>
        )}
      </div>
      {evidenceQuote && (
        <div className="rounded-lg border border-slate-200/70 bg-slate-50/70 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          <div className="mb-1 flex items-center gap-1 font-semibold uppercase tracking-wide text-slate-500">
            <QuotesIcon /> Transcript evidence
          </div>
          <p className="leading-relaxed">“{evidenceQuote}”</p>
          {firstSegmentId && onViewEvidence && (
            <button
              type="button"
              className="mt-2 font-semibold text-primary hover:underline"
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

export function SummaryDashboard({ summary, onViewEvidence }: SummaryDashboardProps) {
  return (
    <div className="flex flex-col gap-8 p-4 animate-fade-in text-gray-800 dark:text-gray-100">
      
      {/* Hero Section: TL;DR */}
      <div className="p-8 rounded-2xl bg-gradient-to-br from-white/60 to-white/30 dark:from-white/10 dark:to-black/20 backdrop-blur-xl border border-white/40 dark:border-white/10 shadow-lg">
        <h2 className="text-sm font-bold uppercase tracking-widest text-primary mb-3 flex items-center gap-2">
          <FlagIcon weight="bold" />
          The Bottom Line
        </h2>
        <p className="text-xl md:text-2xl font-medium leading-relaxed">
          {summary.tldr || "No summary generated."}
        </p>
        
        {summary.metadata?.tags && summary.metadata.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {summary.metadata.tags.map(tag => (
              <span key={tag} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center gap-1">
                <HashIcon />
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Metrics Row */}
      {summary.metrics && summary.metrics.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {summary.metrics.map((metric, i) => (
            <div key={i} className="p-5 rounded-xl bg-white/40 dark:bg-black/20 backdrop-blur-md border border-white/30 dark:border-white/10 flex flex-col justify-between hover:-translate-y-1 hover:shadow-md transition-all duration-300 group">
              <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold tracking-wider group-hover:text-primary transition-colors">{metric.label}</span>
              <div className="flex items-end justify-between mt-2">
                <span className="text-2xl font-bold">{metric.value}</span>
                {metric.trend && (
                  <span className={`text-xs font-medium px-2 py-1 rounded-md ${
                    metric.trend.toLowerCase() === "up" ? "bg-green-500/10 text-green-600" :
                    metric.trend.toLowerCase() === "down" ? "bg-red-500/10 text-red-600" : "bg-gray-500/10 text-gray-600"
                  }`}>
                    {metric.trend}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Two Column Layout for Decisions and Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Key Decisions */}
        {summary.key_decisions && summary.key_decisions.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-2">
              <CheckCircleIcon className="text-green-500" />
              Key Decisions
            </h3>
            <div className="flex flex-col gap-5 border-l-2 border-gray-200 dark:border-gray-800 pl-6 ml-2">
              {summary.key_decisions.map((dec, i) => (
                <div key={i} className="relative">
                  <div className="absolute -left-[30px] top-1.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-4 ring-white dark:ring-gray-950 shadow-sm" />
                  <p className="font-medium text-gray-900 dark:text-white">{dec.decision}</p>
                  {dec.rationale && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{dec.rationale}</p>}
                  {dec.owner && <span className="text-xs font-medium text-primary mt-2 inline-block">Owned by: {dec.owner}</span>}
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

        {/* Action Items */}
        {summary.action_items && summary.action_items.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-2">
              <UsersIcon className="text-blue-500" />
              Action Items
            </h3>
            <div className="flex flex-col gap-3">
              {summary.action_items.map((item, i) => (
                <div key={i} className="p-4 rounded-xl bg-white/40 dark:bg-black/20 backdrop-blur-sm border border-white/30 dark:border-white/10 flex items-start gap-3 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                  <input type="checkbox" className="mt-1 w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary accent-primary cursor-pointer transition-transform hover:scale-110" />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white leading-tight">{item.task}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs">
                      {item.assignee && (
                        <span className="flex items-center gap-1 font-medium bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                          <UsersIcon /> {item.assignee}
                        </span>
                      )}
                      {item.due_date && (
                        <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                          <CalendarIcon /> {item.due_date}
                        </span>
                      )}
                      {item.priority && (
                        <span className={`flex items-center gap-1 font-medium ${
                          item.priority.toLowerCase() === 'high' ? 'text-red-500' :
                          item.priority.toLowerCase() === 'medium' ? 'text-yellow-600' : 'text-blue-500'
                        }`}>
                          <WarningIcon /> {item.priority}
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

      </div>
      
    </div>
  );
}
