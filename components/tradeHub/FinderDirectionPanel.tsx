"use client";
import type { RosterDirectionProfile, LeagueMateView } from "../../lib/types";
import type { FinderStrategyOverride } from "./finderTypes";

interface FinderDirectionPanelProps {
  loadingCalcValues: boolean;
  finderDirectionProfile: RosterDirectionProfile | null | undefined;
  directionRefreshing: boolean;
  setDirectionRefreshing: (v: boolean) => void;
  onRefreshDirection: () => void;
  selectedLeagueMateProfilesView: LeagueMateView[];
  setFinderTargetOppRosterId: (id: number | null) => void;
  isChampionshipPush: boolean;
  finderTankMode: boolean;
  draftCapitalMode: boolean;
  autoStrategyLabel: string;
  finderPreferFuturePicks: boolean;
  rosterOverflow: number;
  finderStrategyOverride: FinderStrategyOverride;
  setFinderStrategyOverride: (mode: FinderStrategyOverride) => void;
}

const STRATEGY_OPTIONS: { mode: FinderStrategyOverride; label: string }[] = [
  { mode: "AUTO", label: "Default" },
  { mode: "TANK", label: "Full Tank" },
  { mode: "CONTEND", label: "Full Contend" },
];

export function FinderDirectionPanel({
  loadingCalcValues,
  finderDirectionProfile,
  directionRefreshing,
  setDirectionRefreshing,
  onRefreshDirection,
  selectedLeagueMateProfilesView,
  setFinderTargetOppRosterId,
  isChampionshipPush,
  finderTankMode,
  draftCapitalMode,
  autoStrategyLabel,
  finderPreferFuturePicks,
  rosterOverflow,
  finderStrategyOverride,
  setFinderStrategyOverride,
}: FinderDirectionPanelProps) {
  return (
    <>
      {loadingCalcValues ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 animate-pulse">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-2">
              <div className="h-2.5 w-28 rounded bg-slate-700" />
              <div className="h-4 w-3/4 rounded bg-slate-700" />
            </div>
            <div className="h-5 w-20 rounded-full bg-slate-700" />
          </div>
          <div className="mt-3 flex gap-2">
            <div className="h-6 w-36 rounded-full bg-slate-700" />
            <div className="h-6 w-44 rounded-full bg-slate-700" />
            <div className="h-6 w-32 rounded-full bg-slate-700" />
          </div>
        </div>
      ) : finderDirectionProfile ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Direction Engine</div>
                <button
                  type="button"
                  onClick={() => { setDirectionRefreshing(true); onRefreshDirection(); }}
                  disabled={directionRefreshing}
                  title="Reload direction data"
                  className="text-slate-600 hover:text-slate-400 transition disabled:opacity-40"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                    className={`w-3 h-3 ${directionRefreshing ? "animate-spin" : ""}`}
                  >
                    <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08 1.196.75.75 0 1 1-1.31-.734 6 6 0 0 1 9.44-1.595l.842.841V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.595l-.842-.841v1.017a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.84.841a4.5 4.5 0 0 0 7.08-1.196.75.75 0 0 1 1.025-.009Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <div className="mt-1 text-sm text-slate-200">{finderDirectionProfile.summary}</div>
            </div>
            <div className="flex flex-col items-end gap-1 self-start">
              <span className={`inline-flex text-[10px] font-semibold px-2 py-1 rounded-full border ${finderDirectionProfile.bucketColor}`}>
                {finderDirectionProfile.bucket}
              </span>
              {finderDirectionProfile.rawBucket &&
               finderDirectionProfile.rawBucket !== finderDirectionProfile.bucket && (
                <span className="text-[9px] text-slate-500 whitespace-nowrap">
                  base: {finderDirectionProfile.rawBucket} → age + sim adjusted
                </span>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {finderDirectionProfile.actions.map((action: string) => (
              <span key={action} className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-1 text-[11px] text-blue-200">
                {action}
              </span>
            ))}
          </div>
          {selectedLeagueMateProfilesView.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Best Partner Targets</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedLeagueMateProfilesView.slice(0, 3).map((mate) => (
                  <button
                    key={mate.rosterId}
                    onClick={() => setFinderTargetOppRosterId(Number(mate.rosterId))}
                    className="rounded-full border border-cyan-800 bg-cyan-950/30 px-3 py-1 text-[11px] text-cyan-200 transition hover:border-cyan-500"
                  >
                    {mate.ownerName} · {mate.fitLabel}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
      {finderDirectionProfile && (
        <div className="rounded-lg bg-slate-800/50 border border-slate-700/60 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Auto-Strategy</div>
            <div className="flex gap-1.5">
              {STRATEGY_OPTIONS.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFinderStrategyOverride(mode)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition ${
                    finderStrategyOverride === mode
                      ? "border-blue-500 bg-blue-950/50 text-blue-200"
                      : "border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-500 hover:text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium ${
              isChampionshipPush
                ? "border-amber-600 bg-amber-900/30 text-amber-300"
                : finderTankMode
                  ? "border-red-700 bg-red-950/30 text-red-300"
                  : draftCapitalMode
                    ? "border-indigo-700 bg-indigo-950/30 text-indigo-300"
                    : "border-emerald-700 bg-emerald-950/30 text-emerald-300"
            }`}>
              {autoStrategyLabel}
            </span>
            {draftCapitalMode && (
              <span className="text-[11px] px-2.5 py-0.5 rounded-full border border-blue-800 bg-blue-950/30 text-blue-300">
                Pick trades included
              </span>
            )}
            {finderPreferFuturePicks && (
              <span className="text-[11px] px-2.5 py-0.5 rounded-full border border-purple-800 bg-purple-950/30 text-purple-300">
                Future picks preferred
              </span>
            )}
            {finderTankMode && (
              <span className="text-[11px] px-2.5 py-0.5 rounded-full border border-red-800 bg-red-950/30 text-red-300">
                Package limits lifted
              </span>
            )}
            {rosterOverflow > 0 && (
              <span className="text-[11px] px-2.5 py-0.5 rounded-full border border-amber-800 bg-amber-950/30 text-amber-300">
                Roster pressure +{rosterOverflow} over cap
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
