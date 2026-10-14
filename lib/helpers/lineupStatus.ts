// ============================================================
// One league's lineup status: the League Overview dot, its T/F/S flags and
// late-risk "!", and the To-Do hub's lineup items, all read off a single
// Lineup Coach run (computeSuggestedLineup) so none of them can disagree with
// the Starters tab. useAppState's leagueLineupStatus builds each league's
// inputs (that league's scoring, the lock/bye rules, availability) and calls
// this once per league.
// ============================================================
import { computeSuggestedLineup, getEarlyLockStake, isInjuryExcludedFromLineup, type SuggestedLineupInput } from "./lineup";
import { getLatePivotRisks } from "./lineupAvailability";
import { EARLY_LOCK_DAYS, getEarlyLockDay } from "./gameday";
import type { LeagueLineupStatus, LineupStatusEmptySlot, SleeperPlayer } from "../types";

export interface LeagueLineupStatusInput {
  /** The Lineup Coach's input for this league, built the way the Starters tab builds it. */
  lineup: SuggestedLineupInput;
  /** Kickoff of a player's game while it's still to come; null once it has started, on a bye,
   *  or when unknown. Drives the T/F/S flags and each swap's lock time. */
  upcomingKickoffFn: (id: string) => number | null;
  /** Kickoff of a player's game this week, started or not (null on a bye or unknown). */
  scheduledKickoffFn: (id: string) => number | null;
  isRiskFn: (id: string) => boolean;
  isUnavailableFn: (id: string) => boolean;
  /** Passed through to the status (LeagueLineupStatus.asOf). */
  asOf: number | null;
}

const playerName = (p: SleeperPlayer) =>
  p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.player_id;

/** `now` defaults to the real clock — overridable so tests can pin it. */
export function buildLeagueLineupStatus(input: LeagueLineupStatusInput, now: number = Date.now()): LeagueLineupStatus {
  const lineupInput = input.lineup;
  const playerIds = lineupInput.playerIds ?? [];
  const { lineup, swaps, currentLineupScore, suggestedLineupScore } = computeSuggestedLineup(lineupInput, now);

  // The Thursday/Friday/Saturday game a player is in, if it hasn't kicked off. The T/F/S flags
  // price what the suggestion loses if that day's games lock before the lineup changes.
  const earlyLockDayOf = (id: string) => {
    const kickoffAt = input.upcomingKickoffFn(id);
    return kickoffAt == null ? null : getEarlyLockDay(kickoffAt);
  };
  const earlyLocks = EARLY_LOCK_DAYS.flatMap((day) => {
    const stake = getEarlyLockStake(lineupInput, (id) => earlyLockDayOf(id) === day, now);
    return stake.points > 0 ? [{ day, stake: stake.points, moves: stake.moves.map(playerName) }] : [];
  });

  // Only the risky starters with no way out once inactives land — one with a later-game bench
  // player to swap in is handled by the Starters tab's note, not flagged.
  const noBackupRisks = getLatePivotRisks({
    lineup,
    playerIds,
    players: lineupInput.players,
    scoreFn: lineupInput.scoreFn,
    kickoffFn: input.scheduledKickoffFn,
    isRiskFn: input.isRiskFn,
    isUnavailableFn: input.isUnavailableFn,
  }, now).filter((risk) => risk.pivots.length === 0);

  // A starting slot the coach could only fill with someone who won't play (on bye, or out by tag,
  // the user's call or the news) or with no one: the coach falls back to those players only when
  // nobody else on the roster fits, so nothing short of a pickup helps. A slot whose game has
  // started is past fixing and left out.
  const isLocked = (id: string) => lineupInput.isLockedFn?.(id) ?? false;
  const emptySlots: LineupStatusEmptySlot[] = lineup.flatMap((row): LineupStatusEmptySlot[] => {
    const player = row.player;
    if (!player) return [{ slot: row.slot, playerId: null, reason: "none" }];
    const id = player.player_id;
    if (isLocked(id)) return [];
    if (lineupInput.isByeFn?.(id)) return [{ slot: row.slot, playerId: id, reason: "bye" }];
    if (isInjuryExcludedFromLineup(player) || lineupInput.isExcludedFn?.(id)) {
      return [{ slot: row.slot, playerId: id, reason: "out" }];
    }
    return [];
  });

  const firstKickoff = (ids: (string | null)[]) => {
    const kickoffs = ids
      .map((id) => (id ? input.upcomingKickoffFn(id) : null))
      .filter((kickoffAt): kickoffAt is number => kickoffAt != null);
    return kickoffs.length > 0 ? Math.min(...kickoffs) : null;
  };

  return {
    isOptimal: swaps.length === 0,
    swapCount: swaps.length,
    delta: Math.max(0, suggestedLineupScore - currentLineupScore),
    pivotRiskCount: noBackupRisks.length,
    earlyLocks,
    swaps: swaps.map((swap) => {
      const outId = swap.current?.player_id ?? null;
      return {
        slot: swap.slot,
        inId: swap.suggested.player_id,
        outId,
        delta: swap.delta,
        lockAt: firstKickoff([swap.suggested.player_id, outId]),
      };
    }),
    pivotRisks: noBackupRisks.map((risk) => ({
      slot: risk.slot,
      playerId: risk.player.player_id,
      kickoffAt: risk.kickoffAt,
      decisionAt: risk.decisionAt,
      swapBy: risk.swapBy,
    })),
    emptySlots,
    asOf: input.asOf,
  };
}
