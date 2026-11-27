import { describe, it, expect } from "vitest";
import { capitalTableText, scoreRules, signedText, type ScoreRule } from "../../../lib/scouting/scoreRules";
import { COMPOSITE_POS } from "../../../lib/scouting/prospectScores";
import { FIELD_TIME_MODIFIERS, type CompositePos } from "../../../lib/scouting/aeComposite";
import { componentWeight } from "../../../lib/scouting/aeComponents";
import { CHARTED_COMPONENTS } from "../../../lib/scouting/chartedComponents";
import { PFF_COMPONENTS } from "../../../lib/scouting/pffComponents";
import { TAG_COMPONENTS } from "../../../lib/scouting/tagStats";
import { DIFFICULTY_TAGS, ENABLED_TAG_CORRECTIONS } from "../../../lib/scouting/tagCorrection";
import { DEFAULT_DYNASTY_WEIGHTS } from "../../../lib/scouting/dynastyScore";
import { PECKING_VALUE } from "../../../lib/scouting/teamLanding";

// Stage 7 of the 2026-11-26 scouting plan: one rules popout per position,
// built from the constants the scores use.

const all = (pos: CompositePos, w = DEFAULT_DYNASTY_WEIGHTS) => scoreRules(pos, w).flatMap((s) => s.rules);
const rule = (pos: CompositePos, key: string, w = DEFAULT_DYNASTY_WEIGHTS): ScoreRule | undefined => all(pos, w).find((r) => r.key === key);
const keys = (pos: CompositePos) => all(pos).map((r) => r.key);

describe("scoreRules", () => {
  it("has the five sections in the order the scores build up", () => {
    expect(scoreRules("WR", DEFAULT_DYNASTY_WEIGHTS).map((s) => s.title)).toEqual([
      "AE Score: the skill pieces", "AE Score: added on top", "AE Score: how his plays are read", "Dynasty Score", "Dynasty+",
    ]);
    for (const pos of COMPOSITE_POS) expect(new Set(keys(pos)).size).toBe(keys(pos).length); // keys unique
  });

  it("lists every PFF, charted and tag component of the position, on by its weight or through field time", () => {
    for (const pos of COMPOSITE_POS) {
      for (const d of [...CHARTED_COMPONENTS, ...PFF_COMPONENTS, ...TAG_COMPONENTS].filter((x) => x.pos === pos)) {
        const r = rule(pos, `comp:${d.key}`);
        expect(r, `${pos} ${d.key}`).toBeDefined();
        const w = componentWeight(d.key);
        expect(r!.on).toBe(w > 0 || FIELD_TIME_MODIFIERS.has(d.key));
        if (FIELD_TIME_MODIFIERS.has(d.key)) expect(r!.size).toBe("through field time");
        else if (!(d.additive && w > 0)) expect(r!.size.startsWith(`weight ${w.toFixed(2)}`)).toBe(true);
        expect(r!.detail).toBe(d.description);
      }
    }
    expect(rule("QB", "comp:pff_qb_fum")!.size).toBe("adds 0.05 × his z on top");
    expect(rule("WR", "comp:pff_wr_fum")).toMatchObject({ on: false, state: "weight 0: shown in Grading checks, not scored" });
  });

  it("weighs the headline metrics as the AE Score does", () => {
    expect(rule("WR", "head:csae")!.size).toMatch(/^weight 0\.70 \(\d+% when he has every piece\)$/);
    expect(rule("WR", "head:sae")!.size).toMatch(/^weight 0\.30 /);
    expect(rule("TE", "head:te_saeb")).toMatchObject({ size: "through field time", on: true });
    expect(rule("QB", "head:aae")!.state).toBe("counts in full at 232 graded throws");
  });

  it("shows each position's own pieces and only those", () => {
    expect(rule("RB", "baseline")).toMatchObject({ size: "−0.10", on: true });
    for (const k of ["speed", "light_inside", "run_mix", "frame"]) expect(keys("RB")).toContain(k);
    for (const k of ["middle", "rushing", "qb_discount"]) expect(keys("QB")).toContain(k);
    expect(keys("QB")).not.toContain("frame");
    expect(keys("TE")).not.toContain("frame");
    for (const k of ["alignment", "light_wr", "press_era"]) expect(keys("WR")).toContain(k);
    expect(keys("WR")).not.toContain("baseline");
    expect(rule("QB", "middle")!.size).toBe("−0.30 to +0.30");
    expect(rule("WR", "alignment")!.size).toBe("up to −0.50 (one side) · −0.20 (slot)");
    expect(rule("RB", "speed")!.size).toBe("up to −0.70");
  });

  it("marks each difficulty tag on or off as the models have them", () => {
    const ck = { QB: ["qb_aae"], RB: ["rb_srae"], WR: ["wr_sae"], TE: ["te_saer", "te_saeb"] } as const;
    for (const pos of COMPOSITE_POS) {
      for (const k of ck[pos]) {
        for (const t of DIFFICULTY_TAGS[k]) {
          expect(rule(pos, `tag:${k}:${t.column}`)!.on, `${k} ${t.column}`).toBe(ENABLED_TAG_CORRECTIONS[k].includes(t.column));
        }
      }
    }
    expect(rule("WR", "subroutes:wr_sae")!.state).toContain("Nine: Love of the game");
  });

  it("reads the Big Board sliders: a piece at 0 is off", () => {
    expect(rule("RB", "speed")).toMatchObject({ on: true, state: "Speed slider 1.00×; off once his class is drafted" });
    const w = { ...DEFAULT_DYNASTY_WEIGHTS, speed: 0, landing: 0 };
    expect(rule("RB", "speed", w)).toMatchObject({ on: false, state: "Speed slider 0.00×: off; off once his class is drafted" });
    expect(rule("RB", "vets", w)!.on).toBe(false);
    expect(rule("RB", "capital", w)!.state).toBe("Draft slider 2.00×; at it, pick 1 is worth +2.33 and undrafted −2.00");
  });

  it("Dynasty+: the capital tables, the projected pick and the team pieces by position", () => {
    expect(capitalTableText("RB")).toBe("1st +1.00 · 2nd +0.66 · 3rd +0.33 · 4th 0.00 · 5th −0.20 · 6th −0.30 · 7th −0.40 · undrafted −1.00");
    expect(capitalTableText("WR")).toBe("1st +1.00 · 2nd +0.60 · 3rd +0.25 · 4th −0.15 · 5th −0.35 · 6th −0.60 · 7th −0.70 · undrafted −1.00");
    expect(capitalTableText("QB")).toMatch(/^picks 1–5 \+1\.1\d · 6–10 \+0\.8\d · 11–15 \+0\.69 · 16–32 \+0\.22 · 2nd \+0\.05 · 3rd −0\.15 · 4th −0\.60/);
    expect(rule("WR", "projected")!.size).toBe("capital averaged over ±25% of his rank");
    expect(rule("WR", "vets")!.size).toBe(PECKING_VALUE.WR.map((v, i) => `${i}${i === 4 ? "+" : ""}: ${signedText(v)}`).join(" · "));
    // No QB piece for a QB prospect; half for an RB.
    expect(keys("QB")).not.toContain("qb");
    expect(rule("RB", "qb")!.size).toBe("0.005 per grade point around 72, capped at ±0.10");
    expect(rule("WR", "qb")!.size).toBe("0.010 per grade point around 72, capped at ±0.20");
    expect(rule("RB", "offense")!.size).toBe("pass −0.05 · balanced 0 · run +0.05");
  });

  it("formats signs with a real minus", () => {
    expect([signedText(0.2), signedText(-0.2), signedText(0), signedText(-0.0001)]).toEqual(["+0.20", "−0.20", "0.00", "0.00"]);
  });
});
