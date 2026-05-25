import { StructuredSummary } from "../types";
import { CheckCircleIcon, FlagIcon, UsersIcon, WarningIcon, CalendarIcon, HashIcon } from "@phosphor-icons/react";

interface SummaryDashboardProps {
  summary: StructuredSummary;
}

export function SummaryDashboard({ summary }: SummaryDashboardProps) {
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
