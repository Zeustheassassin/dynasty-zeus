"use client";
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

export default function StartersTab({ projectionData, nflState }: StartersTabProps) {
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

  const lineupCoachNotes = lineup
    .map(({ slot, player, score }, index) => {
      if (!player?.player_id) return null;
      const currentRow = currentStarterRows[index];
      const currentPlayer = currentRow?.player;
      if (currentPlayer?.player_id === player.player_id) return null;
      const delta = score - (currentRow?.score || 0);
      const reasonParts = [
        delta > 0
          ? `${isInSeason ? "Projection" : "Redraft score"} improves by ${delta.toFixed(1)}`
          : `${isInSeason ? "Projection" : "Redraft score"} is safer for this slot`,
        currentPlayer?.status && /out|doubtful|inactive|suspended/i.test(String(currentPlayer.status))
          ? `${currentPlayer.full_name} is ${String(currentPlayer.status).toLowerCase()}`
          : null,
        slot === "FLEX" || slot === "SUPER_FLEX"
          ? `${player.full_name} is the strongest remaining ${slot === "SUPER_FLEX" ? "flex-eligible" : "flex"} fit`
          : `${player.full_name} grades best at ${slot.replace("_", " ")}`,
        isInSeason &&
        hasKickoffData &&
        currentRow?.slot !== slot &&
        currentPlayer?.position === player.position
          ? `${player.full_name} gets the earlier locked slot so later-game flexibility stays in ${currentRow.slot.replace("_", " ")}`
          : null,
      ].filter(Boolean);

      return {
        slot,
        suggested: player,
        current: currentPlayer,
        delta,
        reason: reasonParts.join(" • "),
      };
    })
    .filter(Boolean) as Array<{
      slot: string;
      suggested: SleeperPlayer;
      current: SleeperPlayer | null | undefined;
      delta: number;
      reason: string;
    }>;

  const currentLineupScore = currentStarterRows.reduce((sum: number, row) => sum + (row.score || 0), 0);
  const suggestedLineupScore = lineup.reduce((sum: number, row) => sum + (row.score || 0), 0);
  const lineupDelta = suggestedLineupScore - currentLineupScore;

  const posColor: Record<string,string> = { QB:"bg-red-900/50 border-red-700", RB:"bg-green-900/50 border-green-700", WR:"bg-blue-900/50 border-blue-700", TE:"bg-yellow-900/50 border-yellow-700", FLEX:"bg-purple-900/50 border-purple-700", SUPER_FLEX:"bg-pink-900/50 border-pink-700" };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-gray-500">
          {isInSeason
            ? <>Week {week} starters based on <strong className="text-gray-300">consensus projections</strong></>
            : <>Offseason starters based on <strong className="text-gray-300">redraft rankings</strong></>
          }
          {" — "}<span className="text-blue-400">{selectedLeague.name}</span>
        </p>
      </div>
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Lineup Coach</div>
            <div className="mt-1 text-sm text-gray-200">
              {lineupCoachNotes.length === 0
                ? "Your current lineup already matches the coach recommendation."
                : `The coach would make ${lineupCoachNotes.length} swap${lineupCoachNotes.length === 1 ? "" : "s"}${lineupDelta > 0 ? ` for roughly +${lineupDelta.toFixed(1)}` : ""}.`}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center md:min-w-[220px]">
            <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Current</div>
              <div className="mt-1 text-sm font-semibold text-white">{currentLineupScore.toFixed(1)}</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Suggested</div>
              <div className={`mt-1 text-sm font-semibold ${lineupDelta > 0 ? "text-green-300" : "text-white"}`}>
                {suggestedLineupScore.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
        {lineupCoachNotes.length > 0 && (
          <div className="mt-4 grid gap-2">
            {lineupCoachNotes.map((note) => (
              <div key={`${note.slot}-${note.suggested.player_id}-${note.current?.player_id || "empty"}`} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full border border-blue-800 bg-blue-950/40 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                    {note.slot.replace("_", " ")}
                  </span>
                  <span className="text-white">{note.current?.full_name || "Empty slot"}</span>
                  <span className="text-gray-500">→</span>
                  <span className="font-semibold text-green-300">{note.suggested.full_name}</span>
                  <span className={`text-xs font-mono ${note.delta > 0 ? "text-green-300" : "text-gray-400"}`}>
                    {note.delta > 0 ? "+" : ""}{note.delta.toFixed(1)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-400">{note.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {lineup.map(({ slot, player, score }) => {
        const statusStr = player?.status ? String(player.status).toLowerCase() : "";
        const isOut = /out|inactive|suspended|covid|nfi|pup/.test(statusStr);
        const isDoubtful = statusStr === "doubtful";
        const isQuestionable = statusStr === "questionable";
        return (
          <div key={slot} className={`flex items-center gap-3 border rounded-xl px-3 py-2 ${posColor[slot] ?? "bg-gray-800 border-gray-700"}`}>
            <span className="text-[10px] font-bold uppercase w-16 shrink-0 text-gray-300">{slot.replace("_"," ")}</span>
            {player ? (
              <>
                <span className="text-sm text-white flex-1 font-medium">{player.full_name}</span>
                {isOut && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-900/60 text-red-400 border border-red-700 shrink-0">OUT</span>}
                {isDoubtful && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-900/60 text-orange-400 border border-orange-700 shrink-0">D</span>}
                {isQuestionable && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-yellow-900/60 text-yellow-400 border border-yellow-700 shrink-0">Q</span>}
                <span className="text-[10px] text-gray-400 shrink-0">{player.team}</span>
                <span className="text-xs font-mono text-gray-300 shrink-0">{score > 0 ? score.toFixed(1) : "—"}</span>
              </>
            ) : (
              <span className="text-sm text-gray-600 italic">Empty</span>
            )}
          </div>
        );
      })}
      <div className="grid gap-3 pt-2 md:grid-cols-2">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Bench</span>
            <span className="text-[10px] text-gray-600">{benchPlayers.length}</span>
          </div>
          <div className="space-y-1.5">
            {benchPlayers.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No bench players</p>
            ) : (
              benchPlayers.map((player) => {
                const score = playerScore(player.player_id);
                return (
                  <div key={player.player_id} className="flex items-center gap-2 rounded-lg bg-gray-800/80 px-3 py-1.5">
                    <span className="text-[10px] font-bold w-7 shrink-0 text-gray-400">{player.position}</span>
                    <span className="text-sm text-white flex-1 truncate">{player.full_name}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">{player.team}</span>
                    <span className="text-xs font-mono text-gray-300 shrink-0">{score > 0 ? score.toFixed(1) : "—"}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Taxi</span>
            <span className="text-[10px] text-gray-600">{taxiPlayers.length}</span>
          </div>
          <div className="space-y-1.5">
            {taxiPlayers.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No taxi players</p>
            ) : (
              taxiPlayers.map((player) => {
                const score = playerScore(player.player_id);
                return (
                  <div key={player.player_id} className="flex items-center gap-2 rounded-lg bg-gray-800/80 px-3 py-1.5">
                    <span className="text-[10px] font-bold w-7 shrink-0 text-gray-400">{player.position}</span>
                    <span className="text-sm text-white flex-1 truncate">{player.full_name}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">{player.team}</span>
                    <span className="text-xs font-mono text-gray-300 shrink-0">{score > 0 ? score.toFixed(1) : "—"}</span>
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
