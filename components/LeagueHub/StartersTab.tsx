"use client";
import { memo } from "react";
import {
  getProjectionKickoffAt,
  getLineupSlotEligiblePositions,
  rebalanceLineupForKickoffWindows,
} from "../../lib/helpers";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { useMyRoster } from "../../lib/RosterContext";
import type { ProjectionRow, SleeperNFLState, SleeperPlayer, LineupCoachRow } from "../../lib/types";

interface StartersTabProps {
  projectionData: ProjectionRow[];
  nflState: SleeperNFLState | null;
}

function StartersTab({ projectionData, nflState }: StartersTabProps) {
  const players = usePlayers();
  const { selectedLeague } = useLeague();
  const { myRoster: roster } = useMyRoster();
  const { leagueAdjustedRedraftValues: redraftValues } = useValues();

  if (!selectedLeague || !roster) return (
    <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first.</p>
  );

  const week = nflState?.week;
  const isInSeason = nflState?.season_type === "regular";
  const projectionBySleeperId = new Map(
    projectionData.map((row) => [String(row.sleeperId), row])
  );
  const hasKickoffData = projectionData.some((row) => getProjectionKickoffAt(row));

  const playerScore = (id: string) => {
    if (isInSeason) {
      const proj = projectionBySleeperId.get(String(id));
      return proj?.fpts ?? 0;
    }
    return redraftValues[id] ?? 0;
  };

  const playerKickoffAt = (id: string) => {
    if (!isInSeason) return null;
    const proj = projectionBySleeperId.get(String(id));
    return proj ? getProjectionKickoffAt(proj) : null;
  };

  const positions: string[] = selectedLeague.roster_positions?.filter((p: string) => !["BN","IR","TAXI"].includes(p)) ?? [];
  const myPlayerIds: string[] = roster.players ?? [];
  const taxiIds = new Set<string>((roster.taxi ?? []).map((id) => String(id)));
  const used = new Set<string>();
  const initialLineup: LineupCoachRow[] = [];
  const currentStarterRows = positions.map((slot: string, index: number) => {
    const starterId = String(roster?.starters?.[index] || "");
    const starterPlayer = starterId ? players[starterId] : null;
    return {
      slot,
      player: starterPlayer,
      score: starterPlayer ? playerScore(starterPlayer.player_id) : 0,
      kickoffAt: starterPlayer ? playerKickoffAt(starterPlayer.player_id) : null,
    };
  });

  for (const slot of positions) {
    const eligible = getLineupSlotEligiblePositions(slot);
    const best = myPlayerIds
      .filter(id => !used.has(id))
      .map(id => ({ id, p: players[id] }))
      .filter(({ p }) => p && eligible.includes(p.position))
      .sort((a, b) => playerScore(b.id) - playerScore(a.id))[0];
    if (best) {
      used.add(best.id);
      initialLineup.push({ slot, player: best.p, score: playerScore(best.id), kickoffAt: playerKickoffAt(best.id) });
    } else {
      initialLineup.push({ slot, player: null, score: 0, kickoffAt: null });
    }
  }

  const lineup = rebalanceLineupForKickoffWindows(initialLineup, isInSeason && hasKickoffData);

  const benchPlayers = myPlayerIds
    .filter((id) => !used.has(id) && !taxiIds.has(String(id)))
    .map((id) => players[id])
    .filter((p): p is SleeperPlayer => !!p)
    .sort((a, b) => playerScore(b.player_id) - playerScore(a.player_id));

  const taxiPlayers = myPlayerIds
    .filter((id) => taxiIds.has(String(id)))
    .map((id) => players[id])
    .filter((p): p is SleeperPlayer => !!p)
    .sort((a, b) => playerScore(b.player_id) - playerScore(a.player_id));

  const currentStarterIds = new Set(
    currentStarterRows
      .map((r) => r.player?.player_id)
      .filter((id): id is string => !!id)
  );
  const newStarterIds = new Set(
    lineup
      .map((r) => r.player?.player_id)
      .filter((id): id is string => !!id)
  );

  // Players currently starting who are NOT in the optimized lineup — these go to the bench.
  // Sort lowest-score first so they pair with the cheapest replacements first.
  const benchedPool: SleeperPlayer[] = currentStarterRows
    .map((r) => r.player)
    .filter((p): p is SleeperPlayer => !!p && !newStarterIds.has(p.player_id))
    .sort((a, b) => playerScore(a.player_id) - playerScore(b.player_id));

  const lineupCoachNotes = lineup
    .map(({ slot, player, score }) => {
      if (!player?.player_id) return null;
      // Skip players who were already starting — their slot may have shifted (e.g.,
      // FLEX 1 → FLEX 2) but that's an internal shuffle, not a real lineup change.
      if (currentStarterIds.has(player.player_id)) return null;

      const eligible = getLineupSlotEligiblePositions(slot);
      let matchIdx = benchedPool.findIndex((p) => eligible.includes(p.position));
      if (matchIdx === -1 && benchedPool.length > 0) matchIdx = 0;
      const replaced = matchIdx >= 0 ? benchedPool.splice(matchIdx, 1)[0] : null;
      const replacedScore = replaced ? playerScore(replaced.player_id) : 0;
      const delta = score - replacedScore;

      const reasonParts = [
        delta > 0
          ? `${isInSeason ? "Projection" : "Redraft score"} improves by ${delta.toFixed(1)}`
          : `${isInSeason ? "Projection" : "Redraft score"} is safer for this slot`,
        replaced?.status && /out|doubtful|inactive|suspended/i.test(String(replaced.status))
          ? `${replaced.full_name} is ${String(replaced.status).toLowerCase()}`
          : null,
        slot === "FLEX" || slot === "SUPER_FLEX"
          ? `${player.full_name} is the strongest remaining ${slot === "SUPER_FLEX" ? "flex-eligible" : "flex"} fit`
          : `${player.full_name} grades best at ${slot.replace("_", " ")}`,
      ].filter(Boolean);

      return {
        slot,
        suggested: player,
        current: replaced,
        delta,
        reason: reasonParts.join(" • "),
      };
    })
    .filter(Boolean) as Array<{
      slot: string;
      suggested: SleeperPlayer;
      current: SleeperPlayer | null;
      delta: number;
      reason: string;
    }>;

  const currentLineupScore = currentStarterRows.reduce((sum: number, row) => sum + (row.score || 0), 0);
  const suggestedLineupScore = lineup.reduce((sum: number, row) => sum + (row.score || 0), 0);
  const lineupDelta = suggestedLineupScore - currentLineupScore;

  const renderStatusBadge = (status: string | null | undefined) => {
    const s = status ? String(status).toLowerCase() : "";
    if (/out|inactive|suspended|covid|nfi|pup/.test(s)) return <span className="text-[10px] font-semibold text-red-400 shrink-0">OUT</span>;
    if (s === "doubtful") return <span className="text-[10px] font-semibold text-orange-400 shrink-0">D</span>;
    if (s === "questionable") return <span className="text-[10px] font-semibold text-yellow-400 shrink-0">Q</span>;
    return null;
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 mb-1">
        {isInSeason
          ? <>Week {week} starters based on <span className="text-gray-300 font-medium">consensus projections</span></>
          : <>Offseason starters based on <span className="text-gray-300 font-medium">redraft rankings</span></>
        }
        {" — "}<span className="text-gray-300">{selectedLeague.name}</span>
      </p>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
        <div className="border-b border-gray-800 pb-2 mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Lineup Coach</div>
            <div className="mt-0.5 text-xs text-gray-200">
              {lineupCoachNotes.length === 0
                ? "Your current lineup already matches the coach recommendation."
                : `The coach would make ${lineupCoachNotes.length} swap${lineupCoachNotes.length === 1 ? "" : "s"}${lineupDelta > 0 ? ` for roughly +${lineupDelta.toFixed(1)}` : ""}.`}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 text-right whitespace-nowrap">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Current</div>
              <div className="text-gray-200 font-medium text-xs">{currentLineupScore.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Suggested</div>
              <div className={`font-medium text-xs ${lineupDelta > 0 ? "text-emerald-400" : "text-gray-200"}`}>
                {suggestedLineupScore.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
        {lineupCoachNotes.length > 0 && (
          <div className="space-y-2">
            {lineupCoachNotes.map((note) => (
              <div key={`${note.slot}-${note.suggested.player_id}-${note.current?.player_id || "empty"}`} className="text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500 w-16 shrink-0">{note.slot.replace("_", " ")}</span>
                  <span className="text-gray-200">{note.current?.full_name || "Empty slot"}</span>
                  <span className="text-gray-600">→</span>
                  <span className="text-gray-200 font-medium">{note.suggested.full_name}</span>
                  <span className={`font-medium ${note.delta > 0 ? "text-emerald-400" : "text-gray-500"}`}>
                    {note.delta > 0 ? "+" : ""}{note.delta.toFixed(1)}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-gray-500 pl-[4.5rem]">{note.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
        <div className="border-b border-gray-800 pb-2 mb-2">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Suggested Lineup</div>
        </div>
        <div className="space-y-0.5">
          {lineup.map(({ slot, player, score }, index) => (
            <div key={`${slot}-${index}`} className="flex items-center gap-2 text-xs py-0.5">
              <span className="text-[10px] uppercase tracking-wide text-gray-500 w-16 shrink-0">{slot.replace("_", " ")}</span>
              {player ? (
                <>
                  <span className="text-gray-200 flex-1 truncate">{player.full_name}</span>
                  {renderStatusBadge(player.status)}
                  <span className="text-[10px] text-gray-500 shrink-0">{player.team}</span>
                  <span className="text-emerald-400 font-medium shrink-0 w-12 text-right">{score > 0 ? score.toFixed(1) : "—"}</span>
                </>
              ) : (
                <span className="text-gray-600 italic flex-1">Empty</span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="border-b border-gray-800 pb-2 mb-2">
            <div className="text-xs text-gray-400">Bench: <span className="font-semibold text-emerald-400">{benchPlayers.length}</span></div>
          </div>
          <div className="space-y-0.5">
            {benchPlayers.length === 0 ? (
              <div className="text-[11px] text-gray-600 italic">No bench players</div>
            ) : (
              benchPlayers.map((player) => {
                const score = playerScore(player.player_id);
                return (
                  <div key={player.player_id} className="flex items-center gap-2 text-xs py-0.5">
                    <span className="text-[10px] uppercase text-gray-500 w-7 shrink-0">{player.position}</span>
                    <span className="text-gray-200 flex-1 truncate">{player.full_name}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">{player.team}</span>
                    <span className="text-emerald-400 font-medium shrink-0 w-12 text-right">{score > 0 ? score.toFixed(1) : "—"}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="border-b border-gray-800 pb-2 mb-2">
            <div className="text-xs text-gray-400">Taxi: <span className="font-semibold text-emerald-400">{taxiPlayers.length}</span></div>
          </div>
          <div className="space-y-0.5">
            {taxiPlayers.length === 0 ? (
              <div className="text-[11px] text-gray-600 italic">No taxi players</div>
            ) : (
              taxiPlayers.map((player) => {
                const score = playerScore(player.player_id);
                return (
                  <div key={player.player_id} className="flex items-center gap-2 text-xs py-0.5">
                    <span className="text-[10px] uppercase text-gray-500 w-7 shrink-0">{player.position}</span>
                    <span className="text-gray-200 flex-1 truncate">{player.full_name}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">{player.team}</span>
                    <span className="text-emerald-400 font-medium shrink-0 w-12 text-right">{score > 0 ? score.toFixed(1) : "—"}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(StartersTab);
