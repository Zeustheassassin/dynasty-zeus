// ============================================================
// Gameday / kickoff timing helpers.
// Used by GamedayHub to determine game state and display times.
// ============================================================
import { sum } from "./math";
import type {
  SleeperLeague, SleeperRoster, SleeperMatchup, SleeperPlayer,
  ProjectionRow, GamedayMatchup, GamedayTeamView, GamedayLineupRow,
  GamedayReserveRow, TeamGameState,
} from "../types";

interface KickoffSource {
  kickoffAt?: unknown;
  kickoff_at?: unknown;
  gameTime?: unknown;
  game_time?: unknown;
  startTime?: unknown;
  start_time?: unknown;
}

/** Extracts a kickoff timestamp (ms) from a raw Sleeper projection object,
 *  trying multiple field name variants returned by different API versions. */
export const getProjectionKickoffAt = (projection: KickoffSource | Record<string, unknown> | null | undefined): number | null => {
  if (!projection) return null;
  const rawCandidates = [
    projection.kickoffAt,
    projection.kickoff_at,
    projection.gameTime,
    projection.game_time,
    projection.startTime,
    projection.start_time,
  ];
  const parsed = rawCandidates
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  return parsed || null;
};

/** Returns the current game state: "Upcoming", "Live", or "Final".
 *  A game is considered Live for up to 6 hours after kickoff.
 *  Fallback heuristic only — prefer `resolveGameState` below, which uses the
 *  real per-team schedule when available. This stays because a kickoff
 *  timestamp is all we have when a team is missing from that schedule
 *  (bye week, fetch failure). */
export const getKickoffState = (kickoffAt: number | null, now = Date.now()) => {
  if (!kickoffAt) return "Upcoming";
  if (now < kickoffAt) return "Upcoming";
  if (now - kickoffAt < 6 * 60 * 60 * 1000) return "Live";
  return "Final";
};

/** Returns Tailwind class string for a game state badge. */
export const getKickoffStateClasses = (state: string) => {
  if (state === "Live")  return "border-green-500/40 bg-green-500/10 text-green-300";
  if (state === "Final") return "border-gray-600 bg-gray-800 text-gray-300";
  return "border-blue-500/40 bg-blue-500/10 text-blue-300";
};

/** Formats a kickoff timestamp as a short local time string (e.g. "1:00 PM"). */
export const formatKickoffTime = (kickoffAt: number | null) => {
  if (!kickoffAt) return "--";
  try {
    return new Date(kickoffAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "--";
  }
};

/**
 * Resolves a player's real game state from the NFL scoreboard, keyed by team
 * (kickoff/live/final is a property of the game, not any one player — every
 * player on the same team must agree). Falls back to the kickoff-timestamp
 * heuristic above when the team isn't in the schedule map (bye week, or the
 * scoreboard fetch failed/hasn't loaded yet), so a missing schedule degrades
 * gracefully instead of breaking the page.
 */
export const resolveGameState = (
  team: string | null | undefined,
  scheduleByTeam: Record<string, TeamGameState>,
  fallbackKickoffAt: number | null
): { state: string; kickoffAt: number | null } => {
  const scheduled = team ? scheduleByTeam[team] : undefined;
  if (scheduled) return { state: scheduled.state, kickoffAt: scheduled.kickoffAt };
  return { state: getKickoffState(fallbackKickoffAt), kickoffAt: fallbackKickoffAt };
};

/**
 * Builds this week's full matchup grid for one league: groups raw Sleeper
 * matchup rows by matchup_id, and for each roster computes actual/remaining/
 * projected-final points per starter slot plus sorted bench/taxi. Shared by
 * the single-league Gameday view and the cross-league Gameday Dashboard so
 * the two never drift apart.
 */
export function buildGamedayMatchups(
  league: SleeperLeague | null | undefined,
  rosters: SleeperRoster[],
  matchups: SleeperMatchup[],
  week: number,
  players: Record<string, SleeperPlayer>,
  projectionData: ProjectionRow[],
  usersByOwnerOrRoster: Record<string | number, string>,
  scheduleByTeam: Record<string, TeamGameState>
): GamedayMatchup[] {
  if (!league || !rosters.length || !week) return [];

  const starterSlots = (league.roster_positions || []).filter(
    (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
  );
  const rosterMap = new Map(rosters.map((entry) => [Number(entry.roster_id), entry]));
  const projectionByPlayerId = new Map(
    projectionData.map((row) => [String(row.sleeperId), row])
  );
  const matchupMap = new Map<number, SleeperMatchup[]>();

  matchups.forEach((entry) => {
    const matchupId = Number(entry?.matchup_id || 0);
    if (!matchupId) return;
    if (!matchupMap.has(matchupId)) matchupMap.set(matchupId, []);
    matchupMap.get(matchupId)?.push(entry);
  });

  const buildTeamView = (entry: SleeperMatchup): GamedayTeamView => {
    const rosterId = Number(entry?.roster_id || 0);
    const rosterEntry = rosterMap.get(rosterId);
    const starterIds = Array.isArray(entry?.starters) && entry.starters.length > 0
      ? entry.starters.map((id) => String(id || ""))
      : (rosterEntry?.starters || []).map((id) => String(id || ""));
    const playerPoints = entry?.players_points || {};
    const starterRows: GamedayLineupRow[] = starterSlots.map((slot: string, index: number) => {
      const playerId = starterIds[index] ? String(starterIds[index]) : "";
      const player = playerId ? players[playerId] : null;
      const projection = playerId ? projectionByPlayerId.get(playerId) : null;
      const fallbackKickoffAt = getProjectionKickoffAt(projection);
      const { state: gameState, kickoffAt } = resolveGameState(player?.team, scheduleByTeam, fallbackKickoffAt);
      const actualPoints = Number(playerId ? playerPoints[playerId] ?? entry?.starters_points?.[index] ?? 0 : 0);
      const remainingProjection = gameState === "Upcoming"
        ? Number(projection?.fpts || 0)
        : gameState === "Live"
        ? Math.max(Number(projection?.fpts || 0) - actualPoints, 0)
        : 0;

      return {
        slot,
        playerId,
        player,
        actualPoints,
        remainingProjection,
        kickoffAt,
        kickoffLabel: formatKickoffTime(kickoffAt),
        gameState,
      };
    });

    const starterIdSet = new Set(starterRows.map((row) => row.playerId).filter(Boolean));
    const taxiIdSet = new Set((rosterEntry?.taxi || []).map((id) => String(id)));
    const buildReserveRow = (playerId: string): GamedayReserveRow => {
      const player = players[playerId];
      const projection = projectionByPlayerId.get(String(playerId));
      const fallbackKickoffAt = getProjectionKickoffAt(projection);
      const { state: gameState, kickoffAt } = resolveGameState(player?.team, scheduleByTeam, fallbackKickoffAt);
      const actualPoints = Number(playerPoints[playerId] ?? 0);
      const remainingProjection = gameState === "Upcoming"
        ? Number(projection?.fpts || 0)
        : gameState === "Live"
        ? Math.max(Number(projection?.fpts || 0) - actualPoints, 0)
        : 0;
      return {
        playerId,
        player,
        actualPoints,
        remainingProjection,
        kickoffAt,
        kickoffLabel: formatKickoffTime(kickoffAt),
        gameState,
      };
    };

    const benchRows = (rosterEntry?.players || [])
      .map((id) => String(id))
      .filter((playerId: string) => !starterIdSet.has(playerId) && !taxiIdSet.has(playerId))
      .map(buildReserveRow)
      .filter((row) => row.player)
      .sort((a, b) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

    const taxiRows = (rosterEntry?.taxi || [])
      .map((id) => String(id))
      .map(buildReserveRow)
      .filter((row) => row.player)
      .sort((a, b) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

    const ownerId = rosterEntry?.owner_id ?? "";
    return {
      rosterId,
      ownerId,
      ownerName: usersByOwnerOrRoster[ownerId] || usersByOwnerOrRoster[rosterId] || `Team ${rosterId}`,
      actualPoints: Number(entry?.points || 0),
      remainingProjection: Math.round(sum(starterRows.map((row) => row.remainingProjection)) * 10) / 10,
      projectedFinal: Math.round((Number(entry?.points || 0) + sum(starterRows.map((row) => row.remainingProjection))) * 10) / 10,
      finishedStarters: starterRows.filter((row) => row.gameState === "Final" && row.playerId).length,
      liveStarters: starterRows.filter((row) => row.gameState === "Live" && row.playerId).length,
      upcomingStarters: starterRows.filter((row) => row.gameState === "Upcoming" && row.playerId).length,
      totalStarters: starterRows.filter((row) => row.playerId).length,
      starterRows,
      benchRows,
      taxiRows,
    };
  };

  return [...matchupMap.entries()]
    .map(([matchupId, entries]) => {
      const teams = entries
        .map((entry) => buildTeamView(entry))
        .sort((a, b) => b.actualPoints - a.actualPoints);
      const sortKickoff = teams
        .flatMap((team) => team.starterRows.map((row) => row.kickoffAt).filter((k): k is number => k !== null))
        .sort((a, b) => a - b)[0] || Number.MAX_SAFE_INTEGER;

      return {
        matchupId,
        teams,
        sortKickoff,
      };
    })
    .sort((a, b) => {
      if (a.sortKickoff !== b.sortKickoff) return a.sortKickoff - b.sortKickoff;
      return a.matchupId - b.matchupId;
    });
}
