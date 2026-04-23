"use client";
import { memo } from "react";
import type { GmBriefing } from "../../lib/types";

type BriefingTabProps = {
  rosterBriefings?: GmBriefing[];
  onRefreshLeagueData?: () => void;
  loadingLeagueOverview?: boolean;
};

function BriefingTab({ rosterBriefings, onRefreshLeagueData, loadingLeagueOverview }: BriefingTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Auto-updated from live league data across all your leagues</span>
        {onRefreshLeagueData && (
          <button
            onClick={onRefreshLeagueData}
            disabled={loadingLeagueOverview}
            title="Refresh all leagues"
            className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 bg-slate-800/60 hover:bg-slate-700/60 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={`h-3 w-3 ${loadingLeagueOverview ? "animate-spin" : ""}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            Refresh
          </button>
        )}
      </div>
      {!rosterBriefings || rosterBriefings.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-500">
          Load your leagues to see your GM briefings across all leagues.
        </div>
      ) : (
        <>
        {rosterBriefings.map((b) => {
          const cardKey = `${b.leagueId}-${b.rosterId}`;
          const urgencyStyle =
            b.urgency === "critical" ? "border-red-700/60 bg-red-950/30" :
            b.urgency === "high"     ? "border-amber-700/60 bg-amber-950/20" :
            b.urgency === "medium"   ? "border-slate-700 bg-slate-900/60" :
                                      "border-slate-800 bg-slate-950/40";

          const urgencyBadge =
            b.urgency === "critical" ? "border-red-700 bg-red-900/50 text-red-300" :
            b.urgency === "high"     ? "border-amber-700 bg-amber-900/40 text-amber-300" :
            b.urgency === "medium"   ? "border-slate-600 bg-slate-800/60 text-slate-300" :
                                      "border-slate-700 bg-slate-900/40 text-slate-400";

          const timestampLabel = b.generatedAt
            ? (() => {
                const diffMs = Date.now() - new Date(b.generatedAt).getTime();
                const diffMin = Math.floor(diffMs / 60000);
                const diffHr  = Math.floor(diffMin / 60);
                const diffDay = Math.floor(diffHr / 24);
                if (diffMin < 2)  return "just now";
                if (diffMin < 60) return `${diffMin}m ago`;
                if (diffHr  < 24) return `${diffHr}h ago`;
                return `${diffDay}d ago`;
              })()
            : null;

          return (
            <div key={cardKey} className={`rounded-2xl border px-4 py-3.5 space-y-2.5 ${urgencyStyle}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="text-sm font-semibold text-white truncate">{b.leagueName}</span>
                  <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-lg shrink-0 ${b.bucketColor}`}>
                    {b.bucket}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold uppercase tracking-wider border px-2.5 py-1 rounded-xl ${urgencyBadge}`}>
                    {b.urgencyLabel}
                  </span>
                </div>
              </div>

              <p className="text-sm font-medium text-white leading-snug">{b.headline}</p>
              <p className="text-xs text-slate-300 leading-relaxed">{b.writeup}</p>

              {b.rosterSnapshot && (
                <p className="text-[11px] text-slate-500 font-mono leading-snug border-t border-slate-800 pt-2">{b.rosterSnapshot}</p>
              )}

              {b.bullets.length > 0 && (
                <ul className="space-y-1">
                  {b.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2 text-xs text-slate-400">
                      <span className="mt-0.5 shrink-0 text-slate-600">•</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}

              {(b.fallingPlayers.length > 0 || b.risingPlayers.length > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {b.fallingPlayers.map((p) => (
                    <span
                      key={p.name}
                      className="inline-flex items-center gap-1 border border-red-800/60 bg-red-950/40 text-red-300 text-[10px] font-medium px-2 py-0.5 rounded-lg"
                    >
                      <span className="text-red-500">↓</span>
                      <span>{p.name}</span>
                      <span className="text-red-500/70">{p.delta.toLocaleString()}</span>
                    </span>
                  ))}
                  {b.risingPlayers.map((p) => (
                    <span
                      key={p.name}
                      className="inline-flex items-center gap-1 border border-emerald-800/60 bg-emerald-950/40 text-emerald-300 text-[10px] font-medium px-2 py-0.5 rounded-lg"
                    >
                      <span className="text-emerald-500">↑</span>
                      <span>{p.name}</span>
                      <span className="text-emerald-500/70">+{p.delta.toLocaleString()}</span>
                    </span>
                  ))}
                </div>
              )}

              {timestampLabel && (
                <div className="text-[10px] text-slate-600 pt-0.5">Updated {timestampLabel}</div>
              )}
            </div>
          );
        })}
        </>
      )}
    </div>
  );
}

export default memo(BriefingTab);
