// RB light-inside-runner red flag (Dynasty Score, 2026-11-19). The user, on
// Dwight Phillips Jr. (5'10" 185, the Inside tag): "5'10" 185 shouldnt be an
// inside runner by anymeans. Its too light for that height to hold up. I would
// personally RED FLAG this prospect". He's fast ("he will probably run a 4.3
// flat"), so the speed floor never touches him, "But that speed just wont have
// the ability to show up on inside runs in the pros hes going to have to use it
// on the outside and as he has shown in college hes not great at the outside
// runs."
//
// The flag: an RB with the Inside tag (roleFitRB.ts runSideTag: above average
// on inside runs and below on outside ones, RUN_SIDE_GAP+ pts apart after the
// sample discount, RUN_SIDE_MIN_RUNS+ runs each side) on a light frame. Frame =
// pounds per inch of height, on his weigh-in when there is one, else his bio
// weight (the user: "if at the combine he goes and weighs in at 198 then it
// goes away"). All of it at LIGHT_INSIDE.full lb per inch and under, none from
// LIGHT_INSIDE.none up, a straight line between: at 5'10" all of it at 189 lb
// and under, none from 196; 5'9" 186 / 193; 5'11" 192 / 199. No height or no
// weight on file: no flag (never a penalty on a guess). Never a bonus.
//
// How much (the user's calls, 2026-11-19): −0.5 before the draft, "and maybe
// after the draft reduce it to −0.25 I still want it to be penalised as its a
// clear red flag fo rme". Unlike the speed floor it stays on after the draft,
// halved, since the pick prices only some of it in.
//
// These lines are the user's judgment plus the 2026-11-19 board, not NFL
// outcome data (there's no public inside / outside split by back size to fit).
// Previewed read-only on that board: it flagged only Phillips (2.64 lb per inch,
// inside +20.1 on 22 runs vs outside −3.6 on 47), Dynasty 0.52 → 0.02, 2027 RB
// #3 → #10. The other Inside-tag backs are 2.93+ lb per inch, and the other
// light backs aren't inside-reliant (Isaac Brown and Jeremy Payne win outside;
// Hollywood Smothers is below average both ways).

import type { CompositePos } from "./aeComposite";
import type { RoleTag } from "./roleFit";

export const LIGHT_INSIDE = {
  /** Lb per inch at and above which there's no flag. */
  none: 2.8,
  /** Lb per inch at and below which all of it applies. */
  full: 2.7,
  /** Before the Light Inside slider, before his class is drafted. */
  value: -0.5,
  /** The same once his class is drafted (scoreLock.ts classDraftedBy). */
  draftedValue: -0.25,
} as const;

export interface LightInsideFlag {
  label: string;
  /** < 0, before the Light Inside slider. */
  value: number;
  /** His pounds per inch of height. */
  lbPerIn: number;
}

const feetInches = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;

/** The full flag's value: halved once his class is drafted. */
export function lightInsideFull(classDrafted: boolean): number {
  return classDrafted ? LIGHT_INSIDE.draftedValue : LIGHT_INSIDE.value;
}

/**
 * An RB's light-inside-runner flag: null off RB, without the Inside tag,
 * without a height or weight, or on a frame of LIGHT_INSIDE.none lb per inch
 * and up. The weigh-in counts over the bio weight.
 */
export function lightInsideFlag(inp: {
  pos: CompositePos;
  /** His Inside / Outside tag (roleFitRB.ts runSideTag); only "inside" counts. */
  runSideTag: RoleTag | null | undefined;
  heightIn: number | null;
  bioWeightLb: number | null;
  weighInLb?: number | null;
  classDrafted?: boolean;
}): LightInsideFlag | null {
  if (inp.pos !== "RB" || inp.runSideTag?.key !== "inside") return null;
  const weighIn = inp.weighInLb ?? null;
  const weightLb = weighIn ?? inp.bioWeightLb;
  if (weightLb == null || inp.heightIn == null || !(inp.heightIn > 0)) return null;
  const lbPerIn = weightLb / inp.heightIn;
  const { none, full } = LIGHT_INSIDE;
  const share = Math.max(0, Math.min(1, (none - lbPerIn) / (none - full)));
  if (share === 0) return null;
  const drafted = inp.classDrafted ?? false;
  const value = lightInsideFull(drafted) * share;
  const weightText = weighIn != null ? `${weighIn} at his weigh-in` : `${weightLb} (bio weight, no weigh-in)`;
  const where = share === 1 ? `all of it at ${full.toFixed(2)} and under` : `${none.toFixed(2)} down to ${full.toFixed(2)}`;
  return {
    label: `inside runner on a light frame: ${feetInches(inp.heightIn)} ${weightText} = ${lbPerIn.toFixed(2)} lb per inch (${where}); ${inp.runSideTag.why}`
      + (drafted ? "; halved now his class is drafted" : ""),
    value,
    lbPerIn,
  };
}
