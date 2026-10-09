// How much of a full sample each prospect has charted: the Big Board's
// sample dot. "Full" is the AE Score's full-trust ceiling (aeComposite.ts
// trustAt), the play count at which a sample counts at face value: QB 232
// throws, RB 160 runs, WR 168 core / 232 total routes. A prospect's share is
// his plays over that ceiling, capped at 100%. WR blends its two the way the
// AE Score does (cSAE 70%, SAE 30%), so a WR is full only at both.
//
// TE's ceilings are matched to WR's once TEs join the AE Score. Until then
// there is no TE ceiling, so a TE's rated routes are read against WR's 232
// total routes (TE routes are graded the way WR routes are).
//
// The user's tiers (2026-10-09): green full, yellow 50–99.9%, orange
// 25–49.9%, red under 25%. Every sample floor (25 throws, 15 runs or routes)
// sits under 11% of its ceiling, so a prospect under the floor is red.

import type { ProspectWithStats } from "../types";
import {
  QB_FULL_TRUST, RB_FULL_TRUST, WR_ALL_FULL_TRUST, WR_ALL_WEIGHT, WR_CORE_FULL_TRUST, WR_CORE_WEIGHT,
  type AEComposite, type CompositePos,
} from "./aeComposite";
import { isCompositePos, SAMPLE_UNIT, type CompositeInputs } from "./prospectScores";

export type SampleTier = "full" | "half" | "quarter" | "low";

export const SAMPLE_TIERS: { tier: SampleTier; label: string; dot: string }[] = [
  { tier: "full",    label: "Full",      dot: "bg-emerald-400" },
  { tier: "half",    label: "50–99.9%",  dot: "bg-yellow-400" },
  { tier: "quarter", label: "25–49.9%",  dot: "bg-orange-500" },
  { tier: "low",     label: "Under 25%", dot: "bg-red-500" },
];

/** One metric's ceiling: the plays at which its sample is full, and its share of the position's dot. */
export interface SampleCeiling {
  key: string;
  label: string;
  full: number;
  weight: number;
}

export interface SamplePart extends SampleCeiling {
  /** Plays charted; null under the metric's sample floor. */
  n: number | null;
}

export interface SampleSize {
  /** Weighted share of full, 0–1. */
  share: number;
  tier: SampleTier;
  parts: SamplePart[];
}

const SAMPLES_BY_KEY: Record<string, Exclude<keyof CompositeInputs, "extra"> | undefined> = {
  aae: "qb", srae: "rb", csae: "wrCore", sae: "wr", te_saer: "teRoute", te_saeb: "teBlock",
};

/** The ceilings a position's sample is read against. */
export function sampleCeilings(pos: CompositePos, composite: AEComposite): SampleCeiling[] {
  if (pos === "QB") return [{ key: "aae", label: "AAE", full: QB_FULL_TRUST, weight: 1 }];
  if (pos === "RB") return [{ key: "srae", label: "SRAE", full: RB_FULL_TRUST, weight: 1 }];
  if (pos === "WR") {
    return [
      { key: "csae", label: "cSAE", full: WR_CORE_FULL_TRUST, weight: WR_CORE_WEIGHT },
      { key: "sae", label: "SAE", full: WR_ALL_FULL_TRUST, weight: WR_ALL_WEIGHT },
    ];
  }
  const matched = composite.positions.TE.metrics
    .filter((m) => !m.perPlayer && m.fullTrustAt != null)
    .map((m) => ({ key: m.key, label: m.label, full: m.fullTrustAt!, weight: m.weight }));
  return matched.length ? matched : [{ key: "te_saer", label: "TE-SAER", full: WR_ALL_FULL_TRUST, weight: 1 }];
}

export function sampleTier(share: number, full: boolean): SampleTier {
  if (full) return "full";
  if (share >= 0.5) return "half";
  if (share >= 0.25) return "quarter";
  return "low";
}

/** Every QB / RB / WR / TE prospect's sample against its position's ceilings. */
export function sampleSizes(
  prospects: readonly ProspectWithStats[], inputs: CompositeInputs, composite: AEComposite,
): Map<string, SampleSize> {
  const ceilings = new Map<CompositePos, SampleCeiling[]>();
  const out = new Map<string, SampleSize>();
  for (const p of prospects) {
    if (!isCompositePos(p.position)) continue;
    let cs = ceilings.get(p.position);
    if (!cs) { cs = sampleCeilings(p.position, composite); ceilings.set(p.position, cs); }
    const parts: SamplePart[] = cs.map((c) => {
      const k = SAMPLES_BY_KEY[c.key];
      return { ...c, n: k ? inputs[k].get(p.id)?.n ?? null : null };
    });
    const totalWeight = parts.reduce((s, x) => s + x.weight, 0);
    const raw = parts.reduce((s, x) => s + x.weight * Math.min(1, (x.n ?? 0) / x.full), 0) / totalWeight;
    // Rounded so a weighted sum landing a hair under a line (0.4999…) doesn't drop a tier.
    const share = Math.round(raw * 1e9) / 1e9;
    // Full means every ceiling is reached, not a share that rounds to 1.
    const full = parts.every((x) => x.n != null && x.n >= x.full);
    out.set(p.id, { share, tier: sampleTier(share, full), parts });
  }
  return out;
}

/** "120 of 168 core routes", "240 throws (full at 232)", or why there's no count. */
export function samplePartText(part: SamplePart): string {
  const unit = SAMPLE_UNIT[part.key] ?? "plays";
  if (part.n == null) return `under the ${part.label} sample floor (full at ${part.full} ${unit})`;
  return part.n >= part.full ? `${part.n} ${unit} (full at ${part.full})` : `${part.n} of ${part.full} ${unit}`;
}
