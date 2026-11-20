import { describe, it, expect } from "vitest";
import { LIGHT_INSIDE, lightInsideFlag, lightInsideFull } from "../../../lib/scouting/lightInsideFlag";
import type { RoleTag } from "../../../lib/scouting/roleFit";

// 2026-11-19, the user on Dwight Phillips Jr. (5'10" 185, the Inside tag): "5'10"
// 185 shouldnt be an inside runner by anymeans. Its too light for that height to
// hold up. I would personally RED FLAG this prospect", "if at the combine he goes
// and weighs in at 198 then it goes away", and "I would do the -0.5 and maybe
// after the draft reduce it to -0.25".

const inside: RoleTag = { key: "inside", label: "Inside", why: "inside +20.1 pts on 22 runs vs outside −3.6 pts on 47 runs (SRAE)" };
const outside: RoleTag = { key: "outside", label: "Outside", why: "outside +10.2 pts on 24 runs vs inside −13.0 pts on 19 runs (SRAE)" };
const rb = (extra: Partial<Parameters<typeof lightInsideFlag>[0]> = {}) =>
  lightInsideFlag({ pos: "RB", runSideTag: inside, heightIn: 70, bioWeightLb: 185, ...extra });

describe("lightInsideFlag", () => {
  it("gives a 5'10\" 185 Inside back all of the −0.5, with his frame and his inside / outside split in the label", () => {
    const f = rb()!;
    expect(f.value).toBeCloseTo(-0.5, 12);
    expect(f.lbPerIn).toBeCloseTo(185 / 70, 12);
    expect(f.label).toContain(`5'10" 185 (bio weight, no weigh-in) = 2.64 lb per inch`);
    expect(f.label).toContain("all of it at 2.70 and under");
    expect(f.label).toContain(inside.why);
  });

  it("slides from all of it at 2.70 lb per inch to none at 2.80 (5'10\": 189 / 196 lb)", () => {
    expect(rb({ bioWeightLb: 189 })!.value).toBeCloseTo(-0.5, 12); // 2.70
    expect(rb({ bioWeightLb: 192.5 })!.value).toBeCloseTo(-0.25, 9); // 2.75, halfway
    expect(rb({ bioWeightLb: 192.5 })!.label).toContain("2.80 down to 2.70");
    expect(rb({ bioWeightLb: 196 })).toBeNull(); // 2.80
    expect(rb({ bioWeightLb: 221 })).toBeNull(); // a 221-lb Inside back is what the tag should look like
  });

  it("reads his weigh-in over his bio weight: a 198 weigh-in clears it, a lighter one counts", () => {
    expect(rb({ weighInLb: 198 })).toBeNull();
    const lighter = rb({ bioWeightLb: 195, weighInLb: 187 })!;
    expect(lighter.value).toBeCloseTo(-0.5, 12);
    expect(lighter.label).toContain("187 at his weigh-in");
  });

  it("halves once his class is drafted, still on", () => {
    expect(lightInsideFull(false)).toBe(LIGHT_INSIDE.value);
    expect(lightInsideFull(true)).toBe(LIGHT_INSIDE.draftedValue);
    const drafted = rb({ classDrafted: true })!;
    expect(drafted.value).toBeCloseTo(-0.25, 12);
    expect(drafted.label).toContain("halved now his class is drafted");
  });

  it("needs an RB with the Inside tag and a height and weight on file", () => {
    expect(rb({ runSideTag: null })).toBeNull();
    expect(rb({ runSideTag: undefined })).toBeNull();
    expect(rb({ runSideTag: outside })).toBeNull();
    for (const pos of ["WR", "QB", "TE"] as const) expect(rb({ pos })).toBeNull();
    expect(rb({ heightIn: null })).toBeNull();
    expect(rb({ bioWeightLb: null })).toBeNull();
  });
});
