"use client";
import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type {
  SleeperPlayer, SleeperLeague, SleeperRoster, LeagueOverviewEntry, HistoricalSnapshot,
} from "../../../lib/types";
import { useModalBehavior } from "../../../lib/hooks/useModalBehavior";
import { injuryBadge, ageColor } from "../../../components/DataHub/dataHubHelpers";
import { ChartCard, ChartTooltip, chartGridProps, chartAxisProps, chartTickStyle } from "../../../components/charts/ChartCard";
import { CHART_CATEGORICAL } from "../../../lib/chartTheme";

const DEPTH_POSITIONS = ["QB", "RB", "WR", "TE"];

interface Props {
  playerProfileId: string;
  players: Record<string, SleeperPlayer>;
  calcFcValues: Record<string, number>;
  leagueAdjustedRedraftValues: Record<string, number>;
  playerNotes: Record<string, string>;
  rosters: SleeperRoster[];
  users: Record<string, string>;
  selectedLeague: SleeperLeague | null;
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  leagues: SleeperLeague[];
  historicalSnapshot: HistoricalSnapshot | null;
  savePlayerNote: (playerId: string, text: string) => void;
  onClose: () => void;
}

export function PlayerProfilePanel({
  playerProfileId, players, calcFcValues, leagueAdjustedRedraftValues,
  playerNotes, rosters, users, selectedLeague,
  leagueOverviewData, leagues, historicalSnapshot, savePlayerNote, onClose,
}: Props) {
  useModalBehavior(onClose);
  const p = players[playerProfileId];

  // Team depth chart for this player's position group. Sorted by Sleeper's
  // depth_chart_order when present, otherwise dynasty value descending — the
  // same logic the Data Hub Depth Charts tab uses (the slim /api/players proxy
  // strips depth_chart_order, so in practice this falls back to value order).
  const depthGroup = useMemo<SleeperPlayer[]>(() => {
    if (!p?.team || !DEPTH_POSITIONS.includes(p.position)) return [];
    return Object.values(players)
      .filter(
        (pl) =>
          pl.team === p.team &&
          pl.position === p.position &&
          (pl.status ?? "").toLowerCase() !== "retired"
      )
      .sort((a, b) => {
        const oa = a.depth_chart_order ?? null;
        const ob = b.depth_chart_order ?? null;
        if (oa !== null && ob !== null) return oa - ob;
        if (oa !== null) return -1;
        if (ob !== null) return 1;
        return (calcFcValues[b.player_id] ?? 0) - (calcFcValues[a.player_id] ?? 0);
      });
  }, [players, calcFcValues, p]);

  if (!p) return null;

  const dynVal = calcFcValues[playerProfileId] ?? p.value ?? 0;
  const redVal = leagueAdjustedRedraftValues[playerProfileId] ?? 0;
  const snapVal = historicalSnapshot?.players[playerProfileId]?.value ?? 0;
  const snapDate = historicalSnapshot?.recorded_at
    ? new Date(historicalSnapshot.recorded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "Snapshot";
  const trendData =
    snapVal > 0 && dynVal > 0 ? [{ label: snapDate, value: snapVal }, { label: "Now", value: dynVal }] : null;
  const injuryStatus = p.injury_status || p.status;
  const injuryNote = [p.injury_body_part, p.injury_notes].filter(Boolean).join(" — ");
  const practiceDesc = p.practice_description || p.practice_participation || "";
  const injuryColor =
    injuryStatus === "IR" || injuryStatus === "PUP" ? "bg-red-900/50 text-red-300 border-red-700" :
    injuryStatus === "Out" ? "bg-red-900/40 text-red-400 border-red-800" :
    injuryStatus === "Doubtful" ? "bg-orange-900/40 text-orange-400 border-orange-700" :
    injuryStatus === "Questionable" ? "bg-yellow-900/40 text-yellow-400 border-yellow-700" :
    "bg-green-900/30 text-green-400 border-green-700";

  const ownersInSelectedLeague = rosters
    .filter((r) => (r.players || []).includes(playerProfileId))
    .map((r) => users[r.owner_id] || `Team ${r.roster_id}`);

  const crossLeagueOwners: { leagueName: string; owner: string }[] = [];
  Object.entries(leagueOverviewData).forEach(([lid, entry]) => {
    const lg = leagues.find((l) => l.league_id === lid);
    if (!lg) return;
    const leagueUserMap: Record<string, string> = (entry as LeagueOverviewEntry & { userMap?: Record<string, string> }).userMap || {};
    (entry.rosters || []).forEach((r) => {
      if ((r.players || []).includes(playerProfileId)) {
        const ownerName = leagueUserMap[r.owner_id] || users[r.owner_id] || `Team ${r.roster_id}`;
        crossLeagueOwners.push({ leagueName: lg.name, owner: ownerName });
      }
    });
  });

  const ownedIds = new Set<string>(
    rosters.flatMap((r) => [...(r.players ?? []), ...(r.taxi ?? [])])
  );

  const noteVal = playerNotes[playerProfileId] ?? "";

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-profile-title"
        tabIndex={-1}
        className="fixed top-0 right-0 h-full w-full max-w-lg bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl overflow-y-auto"
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-800">
          <div>
            <h2 id="player-profile-title" className="text-lg font-bold text-white">{p.full_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-400">{p.position}</span>
              {p.team && <span className="text-xs text-gray-500">· {p.team}</span>}
              {p.age && <span className="text-xs text-gray-500">· Age {p.age}</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close player profile" className="text-gray-500 hover:text-white text-xl leading-none mt-1">✕</button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Dynasty Value</p>
              <p className="text-xl font-bold text-white">{dynVal > 0 ? dynVal.toLocaleString() : "—"}</p>
            </div>
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Redraft Value</p>
              <p className="text-xl font-bold text-white">{redVal > 0 ? redVal.toLocaleString() : "—"}</p>
            </div>
          </div>

          {trendData && (
            <ChartCard title="Dynasty Value Trend" subtitle={`${snapDate} → now`} height={140}>
              <LineChart data={trendData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" {...chartAxisProps} tick={chartTickStyle} />
                <YAxis {...chartAxisProps} tick={chartTickStyle} domain={["auto", "auto"]} />
                <Tooltip content={ChartTooltip} />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Dynasty Value"
                  stroke={CHART_CATEGORICAL[0]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ChartCard>
          )}

          <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Status</p>
            <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${injuryColor}`}>
              {injuryStatus || "Active"}
            </span>
            {injuryNote && <p className="text-xs text-gray-400 mt-1.5">{injuryNote}</p>}
            {practiceDesc && <p className="text-xs text-gray-500 mt-1">{practiceDesc}</p>}
          </div>

          {depthGroup.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                {p.team} {p.position} Depth Chart
              </p>
              <div className="divide-y divide-gray-800/40">
                {depthGroup.slice(0, p.position === "WR" ? 6 : 5).map((dp, idx) => {
                  const isCurrent = dp.player_id === playerProfileId;
                  const isOwned = ownedIds.has(dp.player_id);
                  const val = calcFcValues[dp.player_id] ?? 0;
                  return (
                    <div
                      key={dp.player_id}
                      className={`flex items-center gap-2 px-1 py-1.5 ${isCurrent ? "bg-blue-950/40 rounded" : ""}`}
                    >
                      <span className={`text-[10px] font-bold w-4 shrink-0 ${idx === 0 ? "text-white" : "text-gray-600"}`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0 flex items-center gap-1 flex-wrap">
                        <span className={`text-xs font-medium ${
                          isCurrent ? "text-blue-300" : isOwned ? "text-blue-200" : "text-white"
                        }`}>
                          {dp.full_name || `${dp.first_name} ${dp.last_name}`}
                        </span>
                        {injuryBadge(dp.injury_status)}
                        {idx === 0 && <span className="text-[9px] font-bold px-1 rounded bg-gray-700 text-gray-200 shrink-0">Starter</span>}
                        {isOwned && <span className="text-[9px] font-bold text-blue-400 shrink-0" title="On a roster you own">●</span>}
                      </div>
                      <span className={`text-[10px] shrink-0 ${ageColor(dp.age ?? undefined, dp.position)}`}>
                        {dp.age ?? "—"}
                      </span>
                      {val > 0 && (
                        <span className="text-[10px] font-mono text-gray-400 shrink-0 w-12 text-right">
                          {val.toLocaleString()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {ownersInSelectedLeague.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Owned in {selectedLeague?.name || "Selected League"}
              </p>
              {ownersInSelectedLeague.map((name) => (
                <p key={name} className="text-sm text-white">{name}</p>
              ))}
            </div>
          )}

          {crossLeagueOwners.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Cross-League Ownership</p>
              <div className="space-y-1">
                {crossLeagueOwners.map((entry) => (
                  <div key={`${entry.owner}-${entry.leagueName}`} className="flex items-baseline justify-between text-xs">
                    <span className="text-white truncate mr-2">{entry.owner}</span>
                    <span className="text-gray-500 shrink-0">{entry.leagueName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ownersInSelectedLeague.length === 0 && crossLeagueOwners.length === 0 && (
            <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Ownership</p>
              <p className="text-xs text-gray-600">Not on any loaded roster.</p>
            </div>
          )}

          <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Your Notes</p>
            <textarea
              value={noteVal}
              onChange={(e) => savePlayerNote(playerProfileId, e.target.value)}
              placeholder={`Jot down thoughts on ${p.first_name || p.full_name}…`}
              className="w-full h-28 bg-gray-800 border border-gray-700 rounded-lg p-2.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>
      </div>
    </>
  );
}
