// A draft-day snapshot of the AE Score, saved once a prospect's draft class
// has been drafted.
//
// The AE Score is relative: each AE is judged by league difficulty models fit
// on every charted play, then shrunk and scaled against the whole charted
// pool at the position, with opponent strength measured across everyone too.
// Charting later classes keeps sharpening all of that, so a drafted player's
// live score keeps moving. Mostly that's the measurement getting better, which
// is why the Big Board shows live scores by default (the user's call,
// 2026-10-01). The first time a drafted prospect is scored, though, the score
// is also saved (prospects.ae_score_lock, migration 059). That keeps a record
// of how the class stood at its draft: the "As of draft" view shows it, and
// the live view's tooltip quotes it. Age never drifts either way: the Dynasty
// Score uses the rookie-season age, not today's.

import type { AEScoreLock } from "../types";

// A class counts as drafted from May 1 of its draft year. The NFL draft runs
// in late April.
export function classDraftedBy(draftClassYear: number, now: Date): boolean {
  return now.getTime() >= Date.UTC(draftClassYear, 4, 1);
}

/** The snapshot to save for a live score: the score, each part with the spread it was scored against, and any alignment penalty. */
export function makeLock(live: Omit<AEScoreLock, "locked_at">, now: Date): AEScoreLock {
  return {
    score: live.score,
    components: live.components,
    ...(live.alignment ? { alignment: live.alignment } : {}),
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
