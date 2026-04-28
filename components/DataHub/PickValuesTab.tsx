"use client";
import React from "react";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { sleeperApi } from "../../lib/sleeperApi";
import type { SleeperLeague, SleeperRoster, SleeperUser, AugmentedPick } from "../../lib/types";
import type { CrossLeaguePick, FetchedRoster } from "./dataHubTypes";

const PICK_YEARS = Array.from({ length: 3 }, (_, i) => String(new Date().getFullYear() + i));
const PICK_ROUNDS = [1, 2, 3, 4];
const STANDARD_PICK_VALUES: Record<string, number> = {
  "1-0": 8500, "2-0": 4500, "3-0": 2200, "4-0": 1200,
  "1-1": 6500, "2-1": 3500, "3-1": 2000, "4-1": 1100,
  "1-2": 5000, "2-2": 2800, "3-2": 1600, "4-2": 900,
};

interface PickValuesTabProps {
  allPicks: AugmentedPick[];
  leagues: SleeperLeague[];
  user: SleeperUser | null;
}

function PickValuesTab({ allPicks, leagues, user }: PickValuesTabProps) {
  const { selectedLeague, rosters, users } = useLeague();
  const { selectedLeagueDynamicPickValues } = useValues();

  const [crossLeaguePicks, setCrossLeaguePicks] = React.useState<{ leagueName: string; picks: CrossLeaguePick[] }[]>([]);
  const [loadingCrossLeaguePicks, setLoadingCrossLeaguePicks] = React.useState(false);
  const [crossLeaguePicksLoaded, setCrossLeaguePicksLoaded] = React.useState(false);

  const loadCrossLeaguePicks = async () => {
    if (!user || !leagues.length) return;
    setLoadingCrossLeaguePicks(true);
    try {
      const results = await Promise.all(
        leagues.map(async (league) => {
          const [rostersData, tradedPicksData] = await Promise.all([
            sleeperApi.getLeagueRosters(league.league_id).catch(() => [] as SleeperRoster[]),
            sleeperApi.getLeagueTradedPicks(league.league_id),
          ]);
          const fetchedRosters = rostersData as FetchedRoster[];
          const myRoster = fetchedRosters.find((r) => r.owner_id === user.user_id);
          if (!myRoster) return null;
          const tempPicks: CrossLeaguePick[] = [];
          PICK_YEARS.forEach((year) => {
            fetchedRosters.forEach((r) => {
              PICK_ROUNDS.forEach((round) => {
                tempPicks.push({ season: year, round, roster_id: r.roster_id ?? 0, owner_id: r.roster_id ?? 0 });
              });
            });
          });
          (tradedPicksData as CrossLeaguePick[]).forEach((tp) => {
            const match = tempPicks.find(p => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id);
            if (match) match.owner_id = tp.owner_id;
          });
          const myPicks = tempPicks.filter(p => p.owner_id === myRoster.roster_id);
          return myPicks.length > 0 ? { leagueName: league.name, picks: myPicks } : null;
        })
      );
      setCrossLeaguePicks(results.filter((r): r is { leagueName: string; picks: CrossLeaguePick[] } => r !== null));
      setCrossLeaguePicksLoaded(true);
    } finally {
      setLoadingCrossLeaguePicks(false);
    }
  };

  const CrossLeagueSection = () => (
    <div className="mt-6 border-t border-gray-800 pt-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white">My Picks Across All Leagues</h3>
        {!crossLeaguePicksLoaded ? (
          <button
            onClick={loadCrossLeaguePicks}
            disabled={loadingCrossLeaguePicks || !user || !leagues.length}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded transition"
          >
            {loadingCrossLeaguePicks ? "Loading…" : "Load"}
          </button>
        ) : (
          <button
            onClick={loadCrossLeaguePicks}
            disabled={loadingCrossLeaguePicks}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition"
          >
            {loadingCrossLeaguePicks ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>
      {!crossLeaguePicksLoaded && !loadingCrossLeaguePicks && (
        <p className="text-sm text-gray-500">Load to see all draft picks you own across every league.</p>
      )}
      {loadingCrossLeaguePicks && <p className="text-sm text-blue-400">Fetching picks from all leagues…</p>}
      {crossLeaguePicksLoaded && (
        crossLeaguePicks.length === 0 ? (
          <p className="text-sm text-gray-500">No future picks found across your leagues.</p>
        ) : (
          <div className="space-y-3">
            {crossLeaguePicks.map((entry) => (
              <div key={entry.leagueName} className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
                <div className="text-xs font-semibold text-gray-300 mb-2">{entry.leagueName}</div>
                <div className="flex flex-wrap gap-1.5">
                  {[...entry.picks]
                    .sort((a, b) => a.season !== b.season ? Number(a.season) - Number(b.season) : a.round - b.round)
                    .map((pick) => {
                      const yi = PICK_YEARS.indexOf(String(pick.season));
                      const stdVal = yi >= 0 ? (STANDARD_PICK_VALUES[`${pick.round}-${yi}`] ?? null) : null;
                      return (
                        <span key={`${pick.season}-${pick.round}-${pick.roster_id}`} className="flex flex-col items-center text-center px-2 py-1 rounded-lg bg-blue-900/30 border border-blue-800/50">
                          <span className="text-[10px] font-semibold text-blue-300">{pick.season} R{pick.round}</span>
                          {stdVal && <span className="text-[8px] text-blue-500 font-mono leading-tight">~{stdVal.toLocaleString()}</span>}
                        </span>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );

  if (!selectedLeague || !rosters.length) {
    return (
      <>
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4 mb-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Pick Value Benchmarks</div>
          <p className="text-xs text-gray-400 mb-3">Approximate dynasty (SF) consensus values. Load a league for dynamic pick values tied to actual standings and playoff odds.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-1.5 px-2 text-[10px] text-gray-500 uppercase tracking-wider">Round</th>
                  {PICK_YEARS.map((year) => (
                    <th key={year} className="text-right py-1.5 px-2 text-[10px] text-gray-500 uppercase tracking-wider">{year}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PICK_ROUNDS.map((round) => (
                  <tr key={round} className="border-b border-gray-800/50">
                    <td className="py-1.5 px-2 text-xs font-semibold text-white">Round {round}</td>
                    {PICK_YEARS.map((_, yi) => (
                      <td key={yi} className="py-1.5 px-2 text-right text-xs text-gray-400 font-mono">
                        {(STANDARD_PICK_VALUES[`${round}-${yi}`] ?? 0).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <CrossLeagueSection />
      </>
    );
  }

  const pickRows = allPicks
    .map((pick) => {
      const key = `${pick.season}-${pick.round}-${pick.roster_id}`;
      const dynamic = selectedLeagueDynamicPickValues[key];
      const ownerName = users[pick.owner_id] || `Team ${pick.owner_id}`;
      const issuerName = users[pick.roster_id] || `Team ${pick.roster_id}`;
      const pickLabel = pick.slot && String(pick.slot).includes(".")
        ? `${pick.season} ${pick.slot}`
        : `${pick.season} Rd ${pick.round}`;
      return { ...pick, key, ownerName, issuerName, pickLabel, dynamic };
    })
    .sort((a, b) => (b.dynamic?.expectedValue ?? 0) - (a.dynamic?.expectedValue ?? 0));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Dynamic Pick Valuation</div>
        <div className="mt-1 text-sm text-gray-200">
          Each pick now uses simulated finish distributions, expected slot outcomes, and team-specific playoff odds instead of one flat round value.
        </div>
      </div>

      <div className="space-y-2">
        {pickRows.map((pick) => {
          const dynamic = pick.dynamic;
          if (!dynamic) return null;
          return (
            <div key={pick.key} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{pick.pickLabel}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      dynamic.bucket === "early" ? "border-red-700 bg-red-950/40 text-red-300" :
                      dynamic.bucket === "late" ? "border-green-700 bg-green-950/40 text-green-300" :
                      "border-yellow-700 bg-yellow-950/40 text-yellow-300"
                    }`}>
                      {dynamic.label}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Owned by {pick.ownerName} • tied to {pick.issuerName}&apos;s finish
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-blue-300">{(dynamic.expectedValue || 0).toLocaleString()}</div>
                  <div className="text-[11px] text-gray-500">Range {dynamic.floorValue?.toLocaleString()} - {dynamic.ceilingValue?.toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Expected Slot</div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {typeof dynamic.expectedSlot === "number" ? dynamic.expectedSlot.toFixed(1) : "-"}
                  </div>
                  <div className="text-[11px] text-gray-500">Finish band {dynamic.finishRange || "-"}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Issuer Outlook</div>
                  <div className="mt-1 text-sm font-semibold text-white">{Math.round(dynamic.issuerPlayoffOdds || 0)}%</div>
                  <div className="text-[11px] text-gray-500">Playoff odds for {dynamic.issuerName || pick.issuerName}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Most Likely Slots</div>
                  <div className="mt-1 text-xs text-gray-300">
                    {(dynamic.likelySlots || []).length > 0
                      ? dynamic.likelySlots.map((slotRow: { slot: number; probability: number }) => `${slotRow.slot} (${Math.round((slotRow.probability || 0) * 100)}%)`).join(" | ")
                      : "No slot spread"}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {(["early", "mid", "late"] as const).map((bucket) => (
                  <div key={bucket} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">{bucket}</div>
                    <div className="mt-1 text-sm font-semibold text-white">
                      {Math.round((dynamic.probabilities?.[bucket] || 0) * 100)}%
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {(dynamic.bandValues?.[bucket] ?? dynamic.expectedValue ?? 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <CrossLeagueSection />
    </div>
  );
}

export default React.memo(PickValuesTab);
