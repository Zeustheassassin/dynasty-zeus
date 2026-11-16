// RB speed floor (Dynasty Score, 2026-11-15). The user's idea: "fast prospects
// will never get a bonus but slow WR, RB will get penalties potentially", with
// the lines left to the research ("i want you to decide the lines based on
// your research").
//
// How the lines were decided: every WR and RB who ran a 40 at the 2000–2021
// combines (nflverse combine, draft picks and regular-season PPR; 984 WRs, 621
// RBs), each one's first five NFL seasons, and the question "does a slow 40
// cost fantasy hits BEYOND his draft capital?" (the app's own capital curve,
// which the data reproduced: 2.24–2.26 log-odds per capital unit vs the 2.255
// the table implies). Beyond capital is the part that belongs here: Dynasty+
// adds draft capital on top, and the user's call (2026-11-10) is that
// athleticism is "buried in the draft capital". Hit = a top-24 (or top-12)
// PPR season at his position.
//
// WRs: no floor. At every line tried, slow WRs hit as often as their pick
// says (4.65 and slower: 5 top-24 seasons vs 3.9 expected). The raw gap is big
// (25% of sub-4.35 WRs had a top-24 season, 4–7% at 4.60+), but all of it runs
// through where they're drafted.
//
// RBs: a floor at Speed Score 90 (Barnwell's weight × 200 ÷ 40⁴; weight
// counts: it fit far better than the raw 40). The 108 RBs under 90 had no
// top-12 season where their picks predicted 4.2, in each of 2000–07, 2008–14
// and 2015–21, and a shuffle test that scans every line from 85 to 100 finds a
// gap that large 0.2% of the time. Top-24 seasons: 5 vs 9.1. From 90 up, RBs
// hit as their picks predicted (90–95: 16 vs 12.0).
//
// How much: the top-24 shortfall on the ramp below is −0.73 log-odds (a step
// at 90 gives −0.83; its 80% bootstrap range −1.59 to −0.33). That's 0.33
// capital units, ≈ 0.7 points at the Draft slider's 2×: about one round of
// draft capital (2nd 0.6 → 3rd 0.25). The top-12 shortfall is bigger still, so
// this errs small. The ramp: nothing at 91 and up, all of it at 88 and under,
// a straight line between, so 89.9 and 90.0 aren't a cliff (the fits can't
// tell a step from a ramp: AIC within 1). In 40 times: at 214 lb (the RB mean)
// nothing at 4.65 or faster, all of it at 4.70 or slower; 200 lb 4.57 / 4.62;
// 225 lb 4.71 / 4.76.
//
// Pro-day 40s are hand-timed and run fast: +0.05 puts one on the combine's
// scale (PlayerProfiler, 2015–19 players who ran both: RB 0.055, WR 0.045, all
// 0.05). Speed Score reads his weigh-in where he ran (the lines were set on
// combine weigh-ins), else his bio weight, which runs heavy: the 2026 RBs on
// the board were listed 5–9 lb over their combine weigh-in, 9 of 10 (Robert
// Henry 205 vs 196: 98.2 vs 93.9). Without any weight there's no penalty
// (never a penalty on a guess). Game MPH isn't used: top speed in a game only
// errs slow (it needs a long run to show), so it can't prove a player is slow.

import type { FortySource } from "../types";
import type { CompositePos } from "./aeComposite";

/** The range a 40 can be (the migration 099 CHECK). 4.10 is under the record (4.21), and keeps a half-typed "4" from reading as 4.00. */
export const FORTY_MIN = 4.1;
export const FORTY_MAX = 6.5;
/** A weigh-in's range (the migration 099 CHECK). */
export const FORTY_WEIGHT_MIN = 150;
export const FORTY_WEIGHT_MAX = 400;

/** His 40 as the score reads it: the time, where, and his weigh-in there (null = use the bio weight). */
export interface FortyRun { time: number; source: FortySource; weightLb?: number | null }
/** Seconds added to a pro-day (hand-timed) 40 to put it on the combine's scale. */
export const PRO_DAY_ADJUST = 0.05;
/** The RB floor, in Speed Score: no penalty at `none` and up, all of `value` at `full` and under. */
export const RB_SPEED_FLOOR = { none: 91, full: 88, value: -0.7 } as const;

export const FORTY_SOURCE_LABEL: Record<FortySource, string> = { combine: "Combine", pro_day: "Pro day" };

/** Barnwell's Speed Score: weight × 200 ÷ 40⁴ (100 ≈ an average RB prospect). */
export function speedScore(weightLb: number, forty: number): number {
  return (weightLb * 200) / forty ** 4;
}

/** His 40 on the combine's scale: a pro-day time plus PRO_DAY_ADJUST. */
export function combineEquivalent(time: number, source: FortySource): number {
  return source === "pro_day" ? time + PRO_DAY_ADJUST : time;
}

/** "4.52", or "4.48 PD" for a pro day. */
export function formatForty(time: number, source: FortySource | null | undefined): string {
  return `${time.toFixed(2)}${source === "pro_day" ? " PD" : ""}`;
}

/** Where he ran it, and the weigh-in when one is on file: the Big Board 40 cell's tooltip. */
export function fortyDetail(time: number, source: FortySource | null | undefined, weighIn: number | null | undefined): string {
  const where = source === "pro_day"
    ? `${FORTY_SOURCE_LABEL.pro_day} (hand-timed): ${combineEquivalent(time, "pro_day").toFixed(2)} on the combine's scale`
    : FORTY_SOURCE_LABEL.combine;
  return weighIn != null ? `${where} · weighed ${weighIn} lb` : where;
}

export interface FortyFields {
  forty_time?: number | string | null;
  forty_source?: FortySource | null;
  forty_weight?: number | null;
  forty_projected?: number | string | null;
  forty_projected_from?: string | null;
}

export interface FortyDisplay {
  /** "4.52", "4.48 PD", or "~4.55" for a projection. */
  text: string;
  title: string;
  projected: boolean;
  /** On the combine's scale (a pro day +0.05); a projection as it is. */
  sortValue: number;
}

/**
 * A 40 cell: his real 40 when there is one, else a projection (Fill 40s),
 * greyed and marked ~, which never counts in the speed floor. Null for neither.
 * numeric columns can arrive as strings.
 */
export function fortyDisplay(p: FortyFields): FortyDisplay | null {
  if (p.forty_time != null) {
    const t = Number(p.forty_time);
    return { text: formatForty(t, p.forty_source), title: fortyDetail(t, p.forty_source, p.forty_weight), projected: false, sortValue: combineEquivalent(t, p.forty_source ?? "combine") };
  }
  if (p.forty_projected != null) {
    const t = Number(p.forty_projected);
    return {
      text: `~${t.toFixed(2)}`, projected: true, sortValue: t,
      title: `Projected${p.forty_projected_from ? ` by ${p.forty_projected_from}` : ""}: shown only. The speed floor counts a real 40 (combine or pro day), not a projection.`,
    };
  }
  return null;
}

/**
 * A typed 40: a number of seconds rounded to hundredths, null for blank, or
 * undefined while it isn't a valid time yet ("4.", "45", "abc").
 */
export function parseFortyTime(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  if (!/^\d+(\.\d*)?$/.test(s)) return undefined;
  const v = Math.round(Number(s) * 100) / 100;
  return v >= FORTY_MIN && v <= FORTY_MAX ? v : undefined;
}

export interface SpeedFlag {
  label: string;
  /** ≤ 0, before the Speed slider. */
  value: number;
  /** Null without a weight on file. */
  speedScore: number | null;
}

/**
 * An RB's speed-floor piece, on his weigh-in (else `bioWeightLb`). Null for
 * other positions and without a 40. With a 40 but no weight at all it's 0,
 * with the reason in the label.
 */
export function speedFlag(pos: CompositePos, forty: FortyRun | null | undefined, bioWeightLb: number | null): SpeedFlag | null {
  if (pos !== "RB" || !forty) return null;
  const adjusted = combineEquivalent(forty.time, forty.source);
  const timeText = forty.source === "pro_day"
    ? `${forty.time.toFixed(2)} at his pro day (+${PRO_DAY_ADJUST.toFixed(2)} hand-timed = ${adjusted.toFixed(2)})`
    : `${forty.time.toFixed(2)} at the combine`;
  const weighIn = forty.weightLb ?? null;
  const weightLb = weighIn ?? bioWeightLb;
  if (weightLb == null) return { label: `${timeText}, no weight on file for a Speed Score`, value: 0, speedScore: null };
  const ss = speedScore(weightLb, adjusted);
  const { none, full, value: fullValue } = RB_SPEED_FLOOR;
  const share = Math.max(0, Math.min(1, (none - ss) / (none - full)));
  const value = share === 0 ? 0 : fullValue * share; // not −0 when clear
  const where = share === 0
    ? `clear of the floor (${none})`
    : share === 1 ? `under the floor (all of it at ${full} and under)` : `under the floor (${none} down to ${full})`;
  const weightText = weighIn != null ? `weighing ${weighIn}` : `at ${weightLb} lb (bio weight, no weigh-in)`;
  return { label: `${timeText} ${weightText}: Speed Score ${ss.toFixed(1)}, ${where}`, value, speedScore: ss };
}
