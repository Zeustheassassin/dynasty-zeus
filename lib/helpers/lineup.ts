// ============================================================
// Lineup slot helpers — position eligibility, kickoff-window
// rebalancing, and the shared greedy lineup-optimizer used by both
// the Starters tab ("Lineup Coach") and the League Overview status dot.
// ============================================================
import type { LineupCoachRow, SleeperPlayer } from "../types";

/** Positions that can fill a FLEX slot. */
export const FLEX_ELIGIBLE_POSITIONS = ["RB", "WR", "TE"];

/** Positions that can fill a SUPER_FLEX slot. */
export const SUPER_FLEX_ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE"];

/** Returns the human-readable lineup format string for a Sleeper league
 *  (e.g. "QB 1 • RB 2 • WR 3 • SFLEX 1"). */
export const getLineupSettings = (
  league: { roster_positions?: string[] } | null | undefined
) => {
  const positions = league?.roster_positions || [];
  const counts: Record<string, number> = {};
  positions.forEach((pos: string) => {
    if (pos === "BN" || pos === "IR" || pos === "TAXI") return;
    counts[pos] = (counts[pos] || 0) + 1;
  });
  const order = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX"];
  return order
    .filter((pos) => counts[pos])
    .map((pos) => `${pos === "SUPER_FLEX" ? "SFLEX" : pos} ${counts[pos]}`)
    .join(" • ");
};

/** Returns the eligible positions for a given roster slot name. */
export const getLineupSlotEligiblePositions = (slot: string) => {
  if (slot === "FLEX")       return FLEX_ELIGIBLE_POSITIONS;
  if (slot === "SUPER_FLEX") return SUPER_FLEX_ELIGIBLE_POSITIONS;
  return [slot];
};

/** True when a player is tagged Out, IR, or Doubtful — the coach should not
 *  recommend starting them even if a stale projection still ranks them
 *  highly. Deliberately narrower than the injury badges elsewhere in the app
 *  (Questionable/PUP/Suspended players are still recommendable). */
export const isInjuryExcludedFromLineup = (player: SleeperPlayer | null | undefined): boolean => {
  if (!player) return false;
  const s = `${player.injury_status || player.status || ""}`.toLowerCase();
  return /\bout\b|\bir\b|doubtful/.test(s);
};

/** Reorders a lineup so that players with earlier kickoffs move into
 *  locked positional slots from FLEX / SUPER_FLEX where eligible.
 *  No-ops when kickoff data is unavailable. */
export const rebalanceLineupForKickoffWindows = (
  lineup: LineupCoachRow[],
  hasKickoffData: boolean,
  /** Player ids whose game has already started — computeSuggestedLineup has
   *  already pinned these to their exact current slot, so this pass must
   *  never move them (as either the displaced player or the mover). */
  gameStartedPlayerIds: Set<string> = new Set()
) => {
  if (!hasKickoffData) return lineup;

  const nextLineup = [...lineup];
  const getKickoffSortValue = (row: { kickoffAt: number | null }) =>
    row.kickoffAt ?? Number.MAX_SAFE_INTEGER;

  const tryMoveEarlierPlayerIntoLockedSlot = (
    lockedSlot: string,
    flexSlot: "FLEX" | "SUPER_FLEX"
  ) => {
    const lockedIndexes = nextLineup
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          row.slot === lockedSlot &&
          row.player?.player_id &&
          !gameStartedPlayerIds.has(row.player.player_id)
      );

    lockedIndexes.forEach(({ row: lockedRow, index: lockedIndex }) => {
      // Recomputed fresh on every locked slot, not hoisted above the loop:
      // each swap below changes who currently occupies the FLEX slots, so a
      // stale snapshot would keep re-selecting (and re-clobbering) the same
      // candidate for every locked slot of this position instead of moving
      // on to the next-best one.
      const flexIndexes = nextLineup
        .map((row, index) => ({ row, index }))
        .filter(
          ({ row }) =>
            row.slot === flexSlot &&
            row.player?.player_id &&
            !gameStartedPlayerIds.has(row.player.player_id)
        );

      const swapCandidate = flexIndexes
        .filter(({ row }) => row.player?.position === lockedSlot)
        .sort((a, b) => getKickoffSortValue(a.row) - getKickoffSortValue(b.row))[0];
      if (!swapCandidate) return;

      const lockedKickoff = getKickoffSortValue(lockedRow);
      const flexKickoff   = getKickoffSortValue(swapCandidate.row);
      if (flexKickoff >= lockedKickoff) return;

      nextLineup[lockedIndex]           = { ...swapCandidate.row, slot: lockedSlot };
      nextLineup[swapCandidate.index]   = { ...lockedRow, slot: flexSlot };
    });
  };

  ["RB", "WR", "TE"].forEach((slot) =>
    tryMoveEarlierPlayerIntoLockedSlot(slot, "FLEX")
  );
  ["QB", "RB", "WR", "TE"].forEach((slot) =>
    tryMoveEarlierPlayerIntoLockedSlot(slot, "SUPER_FLEX")
  );

  return nextLineup;
};

export interface SuggestedLineupInput {
  /** League's roster_positions, already filtered of BN/IR/TAXI. */
  rosterPositions: string[];
  starters: string[] | null | undefined;
  playerIds: string[] | null | undefined;
  players: Record<string, SleeperPlayer>;
  /** Score used for the DISPLAYED value and for ranking replacement candidates. */
  scoreFn: (id: string) => number;
  /** Score used to pick the best slot-fill candidate — defaults to scoreFn.
   *  Lets callers rank by a different criterion (e.g. Starters tab's "Lean
   *  Volatile" ceiling toggle) while keeping displayed scores consistent. */
  rankScoreFn?: (id: string) => number;
  kickoffFn?: (id: string) => number | null;
  hasKickoffData: boolean;
  /** Returns true once a player's own game has already started (Live or
   *  Final) — Sleeper locks a roster slot at kickoff, so a player who isn't
   *  already starting can no longer be added to the lineup once this is
   *  true. Callers with access to a real per-team schedule (see
   *  resolveGameState in lib/helpers/gameday.ts) should pass this instead of
   *  relying on `hasKickoffData`/`kickoffFn` alone — projection sources
   *  don't reliably populate per-player kickoff timestamps, so that
   *  fallback is used only when this isn't provided. */
  isLockedFn?: (id: string) => boolean;
}

export interface SuggestedLineupSwap {
  slot: string;
  suggested: SleeperPlayer;
  current: SleeperPlayer | null;
  delta: number;
}

export interface SuggestedLineupResult {
  currentStarterRows: LineupCoachRow[];
  lineup: LineupCoachRow[];
  /** Suggested-lineup players who differ from the current starters — empty
   *  means the current lineup already matches the suggestion. */
  swaps: SuggestedLineupSwap[];
  currentLineupScore: number;
  suggestedLineupScore: number;
}

/** Greedy per-slot fill: for each roster slot, picks the best-ranked
 *  still-available eligible player, then diffs the result against the
 *  current starters to report what would change. Pure function — reused by
 *  the Starters tab (StartersTab.tsx) for the currently selected league and
 *  by the League Overview status dot (useAppState.ts) across every league,
 *  so both can never disagree about whether a lineup is already optimal.
 *  `now` defaults to the real clock — overridable so tests can fix "already
 *  started" checks to a known instant. */
export function computeSuggestedLineup(
  input: SuggestedLineupInput,
  now: number = Date.now()
): SuggestedLineupResult {
  const { rosterPositions, starters, playerIds, players, scoreFn, hasKickoffData } = input;
  const rankScoreFn = input.rankScoreFn ?? scoreFn;
  const kickoffFn = input.kickoffFn ?? (() => null);
  const myPlayerIds = playerIds ?? [];
  const used = new Set<string>();
  const initialLineup: LineupCoachRow[] = [];

  const currentStarterRows: LineupCoachRow[] = rosterPositions.map((slot, index) => {
    const starterId = String(starters?.[index] || "");
    const starterPlayer = starterId ? players[starterId] : null;
    return {
      slot,
      player: starterPlayer,
      score: starterPlayer ? scoreFn(starterPlayer.player_id) : 0,
      kickoffAt: starterPlayer ? kickoffFn(starterPlayer.player_id) : null,
    };
  });

  const currentStarterIds = new Set(
    currentStarterRows.map((r) => r.player?.player_id).filter((id): id is string => !!id)
  );

  // Whether a player's own NFL game has already started (Live or Final) —
  // shared by the "can't be newly added" bench check below AND the "can't be
  // moved at all" starter check. Prefers the caller's real-schedule-backed
  // isLockedFn; falls back to the kickoff-timestamp heuristic (only reliable
  // when hasKickoffData is true) when no isLockedFn was supplied.
  const hasGameStarted = (id: string) => {
    if (input.isLockedFn) return input.isLockedFn(id);
    if (!hasKickoffData) return false;
    const kickoffAt = kickoffFn(id);
    return kickoffAt != null && now >= kickoffAt;
  };

  // Sleeper locks a player's roster slot at their own kickoff — once their
  // game has started, they can stay wherever they already are but can't be
  // newly added to the lineup. A bench player whose game is already Live or
  // Final is therefore never a legal swap-in, so exclude them from the fill
  // pool entirely (already-starting players are exempt since keeping them
  // put isn't a move).
  const isLockedOut = (id: string) => !currentStarterIds.has(id) && hasGameStarted(id);

  // A currently-starting player whose own game has already started is locked
  // to their EXACT current slot for the rest of the week — Sleeper doesn't
  // allow moving anyone out of, into, or within the lineup once their game is
  // live, and the real-world result can't be undone. Pre-assign these by
  // roster-position index before the greedy fill runs, so nothing below (not
  // even a rankScoreFn/injury-driven pick) can bump them to the bench or
  // shuffle their slot.
  const lockedSlotIndexes = new Map<number, SleeperPlayer>();
  currentStarterRows.forEach((row, index) => {
    if (row.player?.player_id && hasGameStarted(row.player.player_id)) {
      lockedSlotIndexes.set(index, row.player);
    }
  });
  const gameStartedStarterIds = new Set(
    Array.from(lockedSlotIndexes.values()).map((p) => p.player_id)
  );
  // Seed `used` with every locked player BEFORE the fill loop runs. Without
  // this, a locked player is only added to `used` once the loop reaches
  // their own pinned index — but isLockedOut() deliberately exempts
  // already-starting players (so pinning them doesn't fight itself), which
  // meant an EARLIER slot in iteration order could still pick that same
  // player as a fresh candidate (nothing was blocking it yet), and then the
  // loop would ALSO pin them into their real slot when it got there —
  // placing one player into two lineup rows and inflating the suggested
  // score without ever registering as a "swap" (they're already a current
  // starter either way, so the diff against currentStarterIds stays quiet).
  gameStartedStarterIds.forEach((id) => used.add(id));

  rosterPositions.forEach((slot, index) => {
    const lockedPlayer = lockedSlotIndexes.get(index);
    if (lockedPlayer) {
      used.add(lockedPlayer.player_id);
      initialLineup.push({
        slot,
        player: lockedPlayer,
        score: scoreFn(lockedPlayer.player_id),
        kickoffAt: kickoffFn(lockedPlayer.player_id),
      });
      return;
    }

    const eligible = getLineupSlotEligiblePositions(slot);
    const candidates = (allowInjured: boolean) =>
      myPlayerIds
        .filter((id) => !used.has(id) && !isLockedOut(id))
        .map((id) => ({ id, p: players[id] }))
        .filter(({ p }) => p && eligible.includes(p.position))
        .filter(({ p }) => allowInjured || !isInjuryExcludedFromLineup(p))
        .sort((a, b) => rankScoreFn(b.id) - rankScoreFn(a.id));
    // Don't recommend an Out/IR/Doubtful player over a healthy one even if a
    // stale projection still ranks them higher — but rather than leave a
    // slot empty, fall back to them when no healthy eligible player exists.
    const best = candidates(false)[0] ?? candidates(true)[0];
    if (best) {
      used.add(best.id);
      initialLineup.push({ slot, player: best.p, score: scoreFn(best.id), kickoffAt: kickoffFn(best.id) });
    } else {
      initialLineup.push({ slot, player: null, score: 0, kickoffAt: null });
    }
  });

  const lineup = rebalanceLineupForKickoffWindows(initialLineup, hasKickoffData, gameStartedStarterIds);

  const newStarterIds = new Set(
    lineup.map((r) => r.player?.player_id).filter((id): id is string => !!id)
  );

  // Players currently starting who are NOT in the optimized lineup — these go to the bench.
  // Sort lowest-score first so they pair with the cheapest replacements first.
  const benchedPool: SleeperPlayer[] = currentStarterRows
    .map((r) => r.player)
    .filter((p): p is SleeperPlayer => !!p && !newStarterIds.has(p.player_id))
    .sort((a, b) => scoreFn(a.player_id) - scoreFn(b.player_id));

  const swaps: SuggestedLineupSwap[] = lineup
    .map(({ slot, player, score }) => {
      if (!player?.player_id) return null;
      // Skip players who were already starting — their slot may have shifted (e.g.,
      // FLEX 1 → FLEX 2) but that's an internal shuffle, not a real lineup change.
      if (currentStarterIds.has(player.player_id)) return null;

      const eligible = getLineupSlotEligiblePositions(slot);
      let matchIdx = benchedPool.findIndex((p) => eligible.includes(p.position));
      if (matchIdx === -1 && benchedPool.length > 0) matchIdx = 0;
      const replaced = matchIdx >= 0 ? benchedPool.splice(matchIdx, 1)[0] : null;
      const replacedScore = replaced ? scoreFn(replaced.player_id) : 0;
      return { slot, suggested: player, current: replaced, delta: score - replacedScore };
    })
    .filter((s): s is SuggestedLineupSwap => !!s);

  const currentLineupScore = currentStarterRows.reduce((sum, row) => sum + (row.score || 0), 0);
  const suggestedLineupScore = lineup.reduce((sum, row) => sum + (row.score || 0), 0);

  return { currentStarterRows, lineup, swaps, currentLineupScore, suggestedLineupScore };
}
