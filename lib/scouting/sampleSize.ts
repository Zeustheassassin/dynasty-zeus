// How much of a full sample each prospect has charted: the Big Board's
// sample dot. A prospect's share is his plays over his position's full sample,
// capped at 100%.
//
// Full samples are the user's (2026-10-09): QB 180 throws, RB 125 runs, WR 160
// routes, TE 140 routes. They set the dots only. The AE Score keeps its own
// full-trust ceilings (aeComposite.ts trustAt), which these don't touch. Each
// counts the plays the position's headline AE metric reads: graded throws
// (AAE), runs with a known run type (SRAE), routes (SAE; every WR's equals his
// total routes) and rated TE routes (TE-SAER).
//
// The user's tiers: green full, yellow 50–99.9%, orange 25–49.9%, red under
// 25%. Every sample floor (25 throws, 15 runs or routes) sits under 14% of its
// full sample, so a prospect under the floor is red.

import type { ProspectWithStats } from "../types";
import type { CompositePos } from "./aeComposite";
import { isCompositePos, SAMPLE_UNIT, type CompositeInputs } from "./prospectScores";
import type { SampleTier } from "./sampleTiers";

export { SAMPLE_TIERS, type SampleTier } from "./sampleTiers";

/** A position's full sample: the metric whose plays count, and how many. */
export interface SampleFull {
  key: string;
  label: string;
  input: Exclude<keyof CompositeInputs, "extra">;
  full: number;
}

export const SAMPLE_FULL: Record<CompositePos, SampleFull> = {
  QB: { key: "aae",     label: "AAE",     input: "qb",      full: 180 },
  RB: { key: "srae",    label: "SRAE",    input: "rb",      full: 125 },
  WR: { key: "sae",     label: "SAE",     input: "wr",      full: 160 },
  TE: { key: "te_saer", label: "TE-SAER", input: "teRoute", full: 140 },
};

export interface SampleSize extends SampleFull {
  /** Plays charted; null under the metric's sample floor. */
  n: number | null;
  /** Share of full, 0–1. */
  share: number;
  tier: SampleTier;
}

export function sampleTier(n: number, full: number): SampleTier {
  if (n >= full) return "full";
  if (n >= full * 0.5) return "half";
  if (n >= full * 0.25) return "quarter";
  return "low";
}

/** Every QB / RB / WR / TE prospect's sample against his position's full sample. */
export function sampleSizes(prospects: readonly ProspectWithStats[], inputs: CompositeInputs): Map<string, SampleSize> {
  const out = new Map<string, SampleSize>();
  for (const p of prospects) {
    if (!isCompositePos(p.position)) continue;
    const f = SAMPLE_FULL[p.position];
    const n = inputs[f.input].get(p.id)?.n ?? null;
    out.set(p.id, { ...f, n, share: Math.min(1, (n ?? 0) / f.full), tier: sampleTier(n ?? 0, f.full) });
  }
  return out;
}

/** "120 of 180 throws", "200 throws (full at 180)", or why there's no count. */
export function sampleText(s: SampleFull & { n: number | null }): string {
  const unit = SAMPLE_UNIT[s.key] ?? "plays";
  if (s.n == null) return `under the ${s.label} sample floor (full at ${s.full} ${unit})`;
  return s.n >= s.full ? `${s.n} ${unit} (full at ${s.full})` : `${s.n} of ${s.full} ${unit}`;
}
