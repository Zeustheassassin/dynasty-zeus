// Freezing the AE Score once a prospect's draft class has been drafted.
//
// The AE Score is relative: each AE is judged by league difficulty models fit
// on every charted play, then shrunk and scaled against the whole charted
// pool at the position, with opponent strength measured across everyone too.
// Charting later classes reshapes all of that and would nudge a drafted
// player's score for years. The user wants a drafted class's rankings to stay
// put, so the first time a drafted prospect is scored, the score is saved
// (prospects.ae_score_lock, migration 059) and used from then on. Dynasty and
// Dynasty+ are built on it, so they hold too. They only move when the user
// moves the sliders or edits the prospect's size or round. Age never drifts
// either way: the Dynasty Score uses the rookie-season age, not today's.
//
// Locked prospects still count in the pool and the league models for
// everyone not yet locked.

import type { AEScoreLock } from "../types";
import type { AEScore, PositionComposite } from "./aeComposite";

// A class counts as drafted from May 1 of its draft year. The NFL draft runs
// in late April.
export function classDraftedBy(draftClassYear: number, now: Date): boolean {
  return now.getTime() >= Date.UTC(draftClassYear, 4, 1);
}

/** The lock to save for a live score: the score, each part, and the spread it was scored against. */
export function makeLock(score: AEScore, pc: PositionComposite, now: Date): AEScoreLock {
  return {
    score: score.score,
    components: score.components.map((c) => ({ ...c, tau: pc.metrics.find((m) => m.key === c.key)?.tau ?? 0 })),
    locked_at: now.toISOString(),
  };
}

/** A usable saved lock, or null. Ignores one on a class that isn't drafted (e.g. its year was edited). */
export function activeLock(
  p: { draft_class_year: number; ae_score_lock?: AEScoreLock | null },
  now: Date,
): AEScoreLock | null {
  const lock = p.ae_score_lock;
  if (!lock || typeof lock.score !== "number" || !classDraftedBy(p.draft_class_year, now)) return null;
  return lock;
}
