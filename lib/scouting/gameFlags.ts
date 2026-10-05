// The user's per-game flags: left early and played hurt (tape-grading
// expansion, Stage 5). Pure.
//
// Left early: the app suggests it when his snap share in a game (his PFF
// snaps ÷ his team's offensive snaps) is well under his usual (the median of
// his other charted games); the user confirms or dismisses it
// (scouting_games.left_early: true / false; NULL = not reviewed). A blowout
// (28+ points) is noted, since starters sit late in those too.
//
// Played hurt: a manual toggle (scouting_games.played_hurt), allowed on old
// games: it needs no re-charting.
//
// Either can make a game count for less in his numbers: each flag has a game
// weight (multiplied into the season weight, seasonWeight.ts), 1 = in full.
// Both start at 1 (OFF). A weight below 1 is switched on only when
// flaggedGameTest shows that the flagged games say less about a player than
// his other games do (held out by game, like the garbage-time test).
import type { ScoutingGame } from "../types";
import type { ByGame } from "./contextEffects";
import type { GameContext } from "./gameContext";

/** Game weight of a confirmed left-early game (1 = counts in full: off). */
export const LEFT_EARLY_WEIGHT = 1;
/** Game weight of a played-hurt game (1 = counts in full: off). */
export const PLAYED_HURT_WEIGHT = 1;

type Flags = Pick<ScoutingGame, "played_hurt" | "left_early">;

/** A game's weight from its flags (1 unless a flag's weight is switched on). */
export function gameFlagWeight(g: Partial<Flags>): number {
  return (g.left_early === true ? LEFT_EARLY_WEIGHT : 1) * (g.played_hurt === true ? PLAYED_HURT_WEIGHT : 1);
}

/** Suggest "left early" when his share is under this fraction of his usual. */
export const LEFT_EARLY_SHARE = 0.6;
/** His other charted games with a snap share needed to know his usual. */
export const LEFT_EARLY_MIN_OTHER_GAMES = 2;
/** A final margin this big is a blowout: starters often sit late. */
export const BLOWOUT_MARGIN = 28;

export interface LeftEarlySuggestion {
  gameId: string;
  /** His snap share that game, and the median of his other games. */
  share: number;
  usual: number;
  hisSnaps: number;
  teamSnaps: number;
  /** Final margin was BLOWOUT_MARGIN+ (starters may have sat late). */
  blowout: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Games whose snap share says he may have left early (not yet reviewed or already confirmed). */
export function leftEarlySuggestions(
  games: readonly Pick<ScoutingGame, "id" | "prospect_id" | "left_early">[],
  contexts: ReadonlyMap<string, GameContext>,
): Map<string, LeftEarlySuggestion> {
  const byProspect = new Map<string, { id: string; share: number }[]>();
  for (const g of games) {
    const share = contexts.get(g.id)?.snapShare;
    if (share == null) continue;
    (byProspect.get(g.prospect_id) ?? byProspect.set(g.prospect_id, []).get(g.prospect_id)!).push({ id: g.id, share });
  }
  const out = new Map<string, LeftEarlySuggestion>();
  for (const g of games) {
    if (g.left_early === false) continue;
    const c = contexts.get(g.id);
    if (c?.snapShare == null || c.hisSnaps == null || !c.teamSnaps) continue;
    const others = (byProspect.get(g.prospect_id) ?? []).filter((o) => o.id !== g.id).map((o) => o.share);
    if (others.length < LEFT_EARLY_MIN_OTHER_GAMES) continue;
    const usual = median(others);
    if (!(c.snapShare < LEFT_EARLY_SHARE * usual)) continue;
    const margin = c.teamPoints != null && c.oppPoints != null ? Math.abs(c.teamPoints - c.oppPoints) : null;
    out.set(g.id, {
      gameId: g.id, share: c.snapShare, usual, hisSnaps: c.hisSnaps, teamSnaps: c.teamSnaps,
      blowout: margin != null && margin >= BLOWOUT_MARGIN,
    });
  }
  return out;
}

// ── Should flagged games count less? ─────────────────────────────────────

export const FLAG_TEST_WEIGHTS = [0, 0.25, 0.5, 0.75, 1] as const;
export const FLAG_TEST_MIN_PROSPECTS = 5;

export interface FlagWeightTest {
  /** Prospects with a flagged game and 2+ other games. */
  prospects: number;
  flaggedGames: number;
  testable: boolean;
  /** Held-out squared error at each weight; null untested. */
  errors: Record<string, number> | null;
  /** The weight with the lowest error (1 = count in full). */
  best: number | null;
}

/**
 * Held out by game: each unflagged game's mean residual is predicted from the
 * prospect's other games, with his flagged games at weight w. If flagged games
 * say as much about him as the rest, w = 1 predicts best; if less, a lower w.
 */
export function flaggedGameTest(
  samples: Iterable<readonly [string, ByGame | undefined]>,
  flagged: ReadonlySet<string>,
): FlagWeightTest {
  const usable: { id: string; n: number; resid: number; flagged: boolean }[][] = [];
  let flaggedGames = 0;
  for (const [, byGame] of samples) {
    if (!byGame) continue;
    const gs = Object.entries(byGame).filter(([, g]) => g.n > 0).map(([id, g]) => ({ id, n: g.n, resid: g.resid, flagged: flagged.has(id) }));
    const f = gs.filter((g) => g.flagged).length;
    if (f === 0 || gs.length - f < 2) continue;
    usable.push(gs);
    flaggedGames += f;
  }
  const testable = usable.length >= FLAG_TEST_MIN_PROSPECTS;
  if (!testable) return { prospects: usable.length, flaggedGames, testable, errors: null, best: null };
  const errors: Record<string, number> = {};
  for (const w of FLAG_TEST_WEIGHTS) {
    let err = 0;
    for (const gs of usable) {
      for (const held of gs) {
        if (held.flagged) continue;
        let n = 0, r = 0;
        for (const g of gs) if (g !== held) { const k = g.flagged ? w : 1; n += k * g.n; r += k * g.resid; }
        if (n === 0) continue;
        err += held.n * (held.resid / held.n - r / n) ** 2;
      }
    }
    errors[String(w)] = err;
  }
  const best = FLAG_TEST_WEIGHTS.reduce((a, b) => (errors[String(b)] < errors[String(a)] ? b : a), 1 as number);
  return { prospects: usable.length, flaggedGames, testable, errors, best };
}
