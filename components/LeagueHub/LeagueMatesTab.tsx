"use client";
import React from "react";
import { getBucketColor, getAdjustedDirectionBucket } from "../../lib/helpers";
import { useAuth } from "../../lib/AuthContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import type { LeagueMateView } from "../../lib/types";
import type { MainTab } from "../../lib/hubs";
import { Card } from "../ui/Card";

interface LeagueMatesTabProps {
  selectedLeagueMateProfilesView: LeagueMateView[];
  loadingLeagueMateIntel: boolean;
  loadingCrossLeagueMateIntel: boolean;
  loadUserTrades: (ownerId: string, bypass?: boolean) => void;
  loadUserExposure: (ownerId: string) => void;
  setCalcOpponentRosterId: (id: number | null) => void;
  setMainTab: (tab: MainTab) => void;
  setTradeHubSection: (section: "CALCULATOR" | "FINDER") => void;
}

function LeagueMatesTab({
  selectedLeagueMateProfilesView,
  loadingLeagueMateIntel,
  loadingCrossLeagueMateIntel,
  loadUserTrades,
  loadUserExposure,
  setCalcOpponentRosterId,
  setMainTab,
  setTradeHubSection,
}: LeagueMatesTabProps) {
  const { supabaseUser } = useAuth();
  const { selectedLeague, rosters } = useLeague();
  const { selectedLeagueSimulation } = useValues();
  const [leagueMateIntelLoadedAt, setLeagueMateIntelLoadedAt] = React.useState<number | null>(null);
  const prevIntelLoading = React.useRef(false);

  React.useEffect(() => {
    const isLoading = loadingLeagueMateIntel || loadingCrossLeagueMateIntel;
    if (prevIntelLoading.current && !isLoading && selectedLeagueMateProfilesView.length > 0) {
      setLeagueMateIntelLoadedAt(Date.now());
    }
    prevIntelLoading.current = isLoading;
  }, [loadingLeagueMateIntel, loadingCrossLeagueMateIntel, selectedLeagueMateProfilesView.length]);

  if (!selectedLeague || !rosters.length) {
    return <p className="text-sm text-slate-500">Select a league from Rosters &amp; Rules first to view league-mate intelligence.</p>;
  }

  const bestPartnerRosterId = selectedLeagueMateProfilesView[0]?.rosterId;

  return (
    <div className="space-y-4">
      <Card padding="lg">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">League-Mate Intelligence</div>
            <div className="mt-1 text-sm text-slate-200">
              Static roster profiles, recent trade behavior, and trade-partner fit for <strong className="text-slate-100">{selectedLeague.name}</strong>.
            </div>
          </div>
          <div className="text-[11px] text-slate-500 text-right">
            {loadingLeagueMateIntel || loadingCrossLeagueMateIntel
              ? "Refreshing trade behavior and all-league tendencies..."
              : supabaseUser ? "Supabase cache enabled" : "Browser-only until you log in"}
            {leagueMateIntelLoadedAt && !loadingLeagueMateIntel && !loadingCrossLeagueMateIntel && (
              <div className="text-[10px] text-slate-600 mt-0.5">
                Updated {new Date(leagueMateIntelLoadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        </div>
      </Card>

      {selectedLeagueMateProfilesView.length === 0 ? (
        <p className="text-sm text-slate-500">No league-mate profiles available yet.</p>
      ) : (
        selectedLeagueMateProfilesView.map((mate) => {
          const mateSimRow = selectedLeagueSimulation?.rowByRosterId?.get(Number(mate.rosterId));
          const matePlayoffOdds = mateSimRow?.playoffOdds ?? 0;
          const mateAdjBucket = getAdjustedDirectionBucket(
            mate.directionProfile?.bucket,
            mate.directionProfile,
            matePlayoffOdds,
            !!mateSimRow
          );
          const mateAdjColor = getBucketColor(mateAdjBucket);
          return (
          <Card key={mate.rosterId} padding="lg">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-base font-semibold text-white">{mate.ownerName}</div>
                  {Number(mate.rosterId) === Number(bestPartnerRosterId) && (
                    <span className="rounded-full border border-emerald-700 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      Best Trade Partner
                    </span>
                  )}
                  <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${mateAdjColor}`}>
                    {mateAdjBucket}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    mate.fitScore >= 24 ? "border-blue-700 bg-blue-950/40 text-blue-300" :
                    mate.fitScore >= 10 ? "border-cyan-700 bg-cyan-950/40 text-cyan-300" :
                    "border-slate-700 bg-slate-950/60 text-slate-400"
                  }`}>
                    {mate.fitLabel}
                  </span>
                </div>
                <div className="mt-2 text-sm text-slate-300">{mate.motivation}</div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => loadUserExposure(mate.ownerId)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white transition hover:border-blue-500"
                >
                  Most Owned Players
                </button>
                <button
                  onClick={() => loadUserTrades(mate.ownerId)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white transition hover:border-blue-500"
                >
                  Recent Trades
                </button>
                <button
                  onClick={() => { setCalcOpponentRosterId(Number(mate.rosterId)); setMainTab("TRADE_HUB"); setTradeHubSection("FINDER"); }}
                  className="rounded-xl border border-blue-700 bg-blue-950/40 px-3 py-2 text-sm text-blue-200 transition hover:border-blue-500"
                >
                  Open In Trade Finder
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Build</div>
                <div className="mt-1 text-sm font-semibold text-white">{mate.buildBiasLabel}</div>
                <div className="mt-1 text-xs text-slate-500">Top groups: {mate.strongestPos} / {mate.secondPos}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Draft Capital</div>
                <div className="mt-1 text-sm font-semibold text-white">{mate.directionProfile.firstRounders} firsts</div>
                <div className="mt-1 text-xs text-slate-500">{mate.directionProfile.futureFirsts} future firsts • {Math.round(mate.directionProfile.pickTotal || 0).toLocaleString()} pick value</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Roster Age</div>
                <div className="mt-1 text-sm font-semibold text-white">{mate.directionProfile.coreAge || "-"}</div>
                <div className="mt-1 text-xs text-slate-500">{mate.directionProfile.summary}</div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Recent Behavior</div>
                <div className="mt-1 text-sm font-semibold text-white">{mate.tradeCount30d} trades in 30d</div>
                <div className="mt-1 text-xs text-slate-500">{mate.recentBuyLabel} • picks {mate.picksIn30d}-{mate.picksOut30d}</div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div className="text-[10px] uppercase tracking-wide text-violet-400">Across All Leagues</div>
                <div className="text-[11px] text-slate-500">
                  {mate.totalDynastyLeagues > 0 ? `${mate.totalDynastyLeagues} dynasty leagues tracked` : "Loading broader tendencies"}
                </div>
              </div>
              <div className="mt-2 text-sm text-slate-300">{mate.crossLeagueSummary}</div>
              <div className="mt-2 text-sm text-slate-400">{mate.crossLeagueTradeSummary}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-violet-800 bg-violet-950/30 px-3 py-1 text-[11px] text-violet-200">
                  {mate.preferenceLabel}
                </span>
                <span className="rounded-full border border-amber-800 bg-amber-950/30 px-3 py-1 text-[11px] text-amber-200">
                  {mate.tradePreferenceLabel}
                </span>
                {mate.preferredPositions?.map((pos: string) => (
                  <span key={pos} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] text-slate-300">
                    Prefers {pos}
                  </span>
                ))}
                {mate.tradePreferredPositions?.map((pos: string) => (
                  <span key={`trade-${pos}`} className="rounded-full border border-amber-800 bg-amber-950/20 px-3 py-1 text-[11px] text-amber-200">
                    Trades For {pos}
                  </span>
                ))}
                {mate.repeatedPlayers?.slice(0, 3).map((player) => (
                  <span key={player.playerId} className="rounded-full border border-cyan-800 bg-cyan-950/30 px-3 py-1 text-[11px] text-cyan-200">
                    Likes {player.name}
                  </span>
                ))}
                {mate.acquiredPlayers?.slice(0, 2).map((player) => (
                  <span key={`acquired-${player.playerId}`} className="rounded-full border border-emerald-800 bg-emerald-950/30 px-3 py-1 text-[11px] text-emerald-200">
                    Recently Bought {player.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-emerald-400">Why They Fit</div>
                <div className="mt-2 space-y-1">
                  {mate.fitReasons?.length > 0 ? mate.fitReasons.map((reason: string) => (
                    <div key={reason} className="text-xs text-slate-300">{reason}</div>
                  )) : (
                    <div className="text-xs text-slate-500">No major structural trade edge right now.</div>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-orange-400">Likely Motivations</div>
                <div className="mt-2 space-y-1">
                  {mate.directionProfile.actions?.slice(0, 3).map((action: string) => (
                    <div key={action} className="text-xs text-slate-300">{action}</div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
          );
        })
      )}
    </div>
  );
}

export default React.memo(LeagueMatesTab);
