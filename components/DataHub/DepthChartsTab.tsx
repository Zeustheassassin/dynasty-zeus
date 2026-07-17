"use client";
import React from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import type { SleeperPlayer } from "../../lib/types";
import { injuryBadge, injuryRiskBadge, ageColor } from "./dataHubHelpers";
import EmptyState from "../ui/EmptyState";

function DepthChartsTab() {
  const players = usePlayers();
  const { rosters } = useLeague();
  const { leagueAdjustedFcValues: calcFcValues } = useValues();

  const [depthPos, setDepthPos] = React.useState<"QB" | "RB" | "WR" | "TE">("QB");
  const [depthTeamSearch, setDepthTeamSearch] = React.useState("");
  const [depthShowOwnedOnly, setDepthShowOwnedOnly] = React.useState(false);

  // Build owned player set across all rosters in the selected league (or all leagues)
  const ownedIds = new Set<string>(
    rosters.flatMap((r) => [
      ...(r.players ?? []),
      ...(r.taxi ?? []),
    ])
  );

  // Build team → position → players map from the Sleeper player database.
  // Include every player with a team assignment — never gate on status or
  // depth_chart_order being populated, as Sleeper frequently leaves those null
  // for rostered players (e.g. practice squad, IR, late additions).
  const teamMap = new Map<string, Record<string, SleeperPlayer[]>>();
  Object.values(players).forEach((p) => {
    if (!p.team || !["QB", "RB", "WR", "TE"].includes(p.position)) return;
    // Only skip truly non-roster entries
    const status = (p.status ?? "").toLowerCase();
    if (status === "retired") return;
    if (!teamMap.has(p.team)) teamMap.set(p.team, { QB: [], RB: [], WR: [], TE: [] });
    teamMap.get(p.team)![p.position].push(p);
  });
  // Sort each position group:
  //   1. Explicit depth_chart_order (0 = starter, ascending)
  //   2. Fallback: dynasty value descending (higher value = more likely the starter)
  teamMap.forEach((posMap) => {
    Object.keys(posMap).forEach((pos) => {
      posMap[pos].sort((a, b) => {
        const oa = a.depth_chart_order ?? null;
        const ob = b.depth_chart_order ?? null;
        if (oa !== null && ob !== null) return oa - ob;
        if (oa !== null) return -1;
        if (ob !== null) return 1;
        // Both null — higher dynasty value = higher on the depth chart
        return (calcFcValues[b.player_id] ?? 0) - (calcFcValues[a.player_id] ?? 0);
      });
    });
  });

  // Sorted list of teams, optionally filtered by search
  const allTeams = Array.from(teamMap.keys()).sort();
  const filteredTeams = allTeams.filter((team) => {
    if (depthTeamSearch.trim()) {
      const q = depthTeamSearch.toLowerCase();
      if (!team.toLowerCase().includes(q)) return false;
    }
    if (depthShowOwnedOnly) {
      const posGroup = teamMap.get(team)?.[depthPos] ?? [];
      return posGroup.some((p) => ownedIds.has(p.player_id));
    }
    return true;
  });

  // Returns the depth role label for a player.
  // index 0 = Starter, index 1 = Handcuff — BUT only if value < 1400.
  // At 1400+ the player has standalone dynasty value and is not a true handcuff.
  const HC_VALUE_THRESHOLD = 1400;
  const getDepthRole = (team: string, player: SleeperPlayer): "STARTER" | "HANDCUFF" | null => {
    const group = teamMap.get(team)?.[depthPos] ?? [];
    const idx = group.findIndex((p) => p.player_id === player.player_id);
    if (idx === 0) return "STARTER";
    const val = calcFcValues[player.player_id] ?? 0;
    if (idx === 1 && val < HC_VALUE_THRESHOLD) return "HANDCUFF";
    return null;
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Position filter */}
        <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1">
          {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
            <button
              key={pos}
              onClick={() => setDepthPos(pos)}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                depthPos === pos
                  ? pos === "QB" ? "bg-red-900/60 text-red-300"
                  : pos === "RB" ? "bg-green-900/60 text-green-300"
                  : pos === "WR" ? "bg-blue-900/60 text-blue-300"
                  : "bg-yellow-900/60 text-yellow-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
        {/* Team search */}
        <input
          type="text"
          value={depthTeamSearch}
          onChange={(e) => setDepthTeamSearch(e.target.value)}
          placeholder="Filter team…"
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-36"
        />
        {/* Owned only toggle */}
        <button
          onClick={() => setDepthShowOwnedOnly((v) => !v)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
            depthShowOwnedOnly
              ? "border-blue-600 bg-blue-900/30 text-blue-300"
              : "border-slate-700 text-slate-400 hover:text-white"
          }`}
        >
          Owned Players Only
        </button>
        {/* Legend */}
        <div className="flex items-center gap-3 ml-auto text-[10px] text-slate-500 flex-wrap">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"/> Owned</span>
          <span className="flex items-center gap-1"><span className="rounded px-1 bg-slate-700 text-slate-200 font-bold">Starter</span> Depth #1</span>
          <span className="flex items-center gap-1"><span className="rounded px-1 bg-amber-900/60 text-amber-300 font-bold">HC</span> Depth #2 handcuff</span>
        </div>
      </div>

      {/* Team grid — fills full width; more columns on wider screens */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        {filteredTeams.map((team) => {
          const posGroup = teamMap.get(team)?.[depthPos] ?? [];
          if (posGroup.length === 0) return null;
          const hasOwned = posGroup.some((p) => ownedIds.has(p.player_id));
          return (
            <div
              key={team}
              className={`rounded-2xl border bg-slate-900/60 overflow-hidden ${
                hasOwned ? "border-blue-800/60" : "border-slate-800"
              }`}
            >
              {/* Team header */}
              <div className={`px-3 py-2 border-b flex items-center justify-between ${
                hasOwned ? "border-blue-800/40 bg-blue-950/20" : "border-slate-800"
              }`}>
                <span className="text-sm font-bold text-white">{team}</span>
                {hasOwned && <span className="text-[9px] font-bold text-blue-400 uppercase tracking-wide">You own</span>}
              </div>
              {/* Player rows */}
              <div className="divide-y divide-slate-800/40">
                {posGroup.slice(0, depthPos === "WR" ? 5 : 4).map((p, rowIdx) => {
                  const isOwned = ownedIds.has(p.player_id);
                  const role = getDepthRole(team, p);
                  const val = calcFcValues[p.player_id] ?? 0;
                  return (
                    <div
                      key={p.player_id}
                      className={`flex items-center gap-2 px-3 py-1.5 ${
                        isOwned ? "bg-blue-950/20" : ""
                      }`}
                    >
                      {/* Depth number */}
                      <span className={`text-[10px] font-bold w-4 shrink-0 ${
                        rowIdx === 0 ? "text-white" : "text-slate-600"
                      }`}>{rowIdx + 1}</span>
                      {/* Name + role badge + injury */}
                      <div className="flex-1 min-w-0 flex items-center gap-1 flex-wrap">
                        <span className={`text-xs font-medium ${isOwned ? "text-blue-200" : "text-white"}`}>
                          {p.full_name || `${p.first_name} ${p.last_name}`}
                        </span>
                        {injuryBadge(p.injury_status)}
                        {injuryRiskBadge(p.age, p.position, p.injury_status)}
                        {role === "STARTER"  && <span className="text-[9px] font-bold px-1 rounded bg-slate-700 text-slate-200 shrink-0">Starter</span>}
                        {role === "HANDCUFF" && <span className="text-[9px] font-bold px-1 rounded bg-amber-900/60 text-amber-300 shrink-0">HC</span>}
                      </div>
                      {/* Age */}
                      <span className={`text-[10px] shrink-0 ${ageColor(p.age ?? undefined, p.position)}`}>
                        {p.age ?? "—"}
                      </span>
                      {/* Value */}
                      {val > 0 && (
                        <span className="text-[10px] font-mono text-slate-400 shrink-0 w-12 text-right">
                          {val.toLocaleString()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {filteredTeams.length === 0 && (
          <EmptyState className="col-span-full">No teams match your filter.</EmptyState>
        )}
      </div>
    </div>
  );
}

export default React.memo(DepthChartsTab);
