// The scores the Draft Hub's rookie board shows (prospects.board_scores,
// migration 068). The draft board never computes scores itself: each Big Board
// visit saves every prospect's Dynasty, Dynasty+ and sample dot, and the draft
// board reads them back.
//
// What's saved is the user's call (2026-10-09): live and without traits,
// whatever the Big Board is showing, at the Dynasty sliders' weights in effect
// then. Only rows whose numbers changed are written, so values are rounded
// first and float noise between visits doesn't rewrite every row.

import type { BoardScores, ProspectWithStats } from "../types";
import type { DynastyBreakdown, DynastyWeights } from "./dynastyScore";
import type { SampleSize } from "./sampleSize";

/** A row's saved scores, before the save stamps saved_at. */
export type BoardScoresValue = Omit<BoardScores, "saved_at">;

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
const roundOrNull = (v: number | null | undefined, dp: number) => (v == null ? null : round(v, dp));

/**
 * Every prospect with a sample dot (QB / RB / WR / TE). Dynasty and Dynasty+
 * are null for one without an AE Score, and Dynasty+ until a round is set.
 */
export function buildBoardScores(
  prospects: readonly ProspectWithStats[],
  dynasty: ReadonlyMap<string, DynastyBreakdown>,
  samples: ReadonlyMap<string, SampleSize>,
  weights: DynastyWeights,
): Map<string, BoardScoresValue> {
  const out = new Map<string, BoardScoresValue>();
  for (const p of prospects) {
    const s = samples.get(p.id);
    if (!s) continue;
    const d = dynasty.get(p.id);
    out.set(p.id, {
      dynasty: roundOrNull(d?.dynasty, 3),
      plus: roundOrNull(d?.plus, 3),
      sample: { n: s.n, share: round(s.share, 3), tier: s.tier },
      weights: { age: weights.age, size: weights.size, draft: weights.draft },
    });
  }
  return out;
}

/** What a save compares: every saved field but saved_at. Field by field, since jsonb doesn't keep key order. */
export function boardScoresKey(b: Partial<BoardScoresValue> | null | undefined): string | null {
  if (!b) return null;
  return [
    b.dynasty ?? null, b.plus ?? null,
    b.sample?.n ?? null, b.sample?.share ?? null, b.sample?.tier ?? null,
    b.weights?.age ?? null, b.weights?.size ?? null, b.weights?.draft ?? null,
  ].join("|");
}

/**
 * The rows to write: those whose scores differ from what was last saved.
 * `saved` holds what this visit already wrote (or is writing), keyed by
 * boardScoresKey; without an entry, the prospect's loaded board_scores count.
 */
export function changedBoardScores(
  prospects: readonly ProspectWithStats[],
  next: ReadonlyMap<string, BoardScoresValue>,
  saved: ReadonlyMap<string, string | null>,
): Map<string, BoardScoresValue> {
  const out = new Map<string, BoardScoresValue>();
  for (const p of prospects) {
    const v = next.get(p.id);
    if (!v) continue;
    const prev = saved.has(p.id) ? saved.get(p.id) : boardScoresKey(p.board_scores);
    if (boardScoresKey(v) !== prev) out.set(p.id, v);
  }
  return out;
}
