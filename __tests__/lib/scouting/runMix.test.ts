import { describe, it, expect } from "vitest";
import { NFL_RUN_MIX, RUN_MIX_PRIOR, runMixWeight, type DesignedRunType } from "../../../lib/scouting/runMix";

const runs = (counts: Partial<Record<string, number>>) =>
  Object.entries(counts).flatMap(([run_type, n]) => Array.from({ length: n ?? 0 }, () => ({ run_type })));

describe("NFL_RUN_MIX", () => {
  it("is a full mix, PFF's 56.5% zone split about 65% inside either way", () => {
    const m = NFL_RUN_MIX;
    expect(m.inside_zone + m.outside_zone + m.inside_man_gap + m.outside_man_gap).toBeCloseTo(1, 9);
    expect(m.inside_zone + m.outside_zone).toBeCloseTo(0.565, 9);
    expect(m.inside_zone / (m.inside_zone + m.outside_zone)).toBeCloseTo(0.65, 1);
    expect(m.inside_man_gap / (m.inside_man_gap + m.outside_man_gap)).toBeCloseTo(0.65, 1);
  });
});

describe("runMixWeight", () => {
  it("leaves a back already at the mix alone", () => {
    const at = { inside_zone: 0.25, outside_zone: 0.25, inside_man_gap: 0.25, outside_man_gap: 0.25 };
    const w = runMixWeight(runs({ inside_zone: 10, outside_zone: 10, inside_man_gap: 10, outside_man_gap: 10 }), at);
    for (const t of Object.keys(at)) expect(w({ run_type: t })).toBeCloseTo(1, 12);
  });

  it("averages 1 over his runs, so a back keeps his run count", () => {
    const mine = runs({ inside_zone: 12, outside_zone: 3, inside_man_gap: 40, outside_man_gap: 9 });
    const w = runMixWeight(mine);
    expect(mine.reduce((s, r) => s + w(r), 0)).toBeCloseTo(mine.length, 9);
  });

  it("moves each share toward the NFL's by n / (n + 30), then renormalizes", () => {
    const k: Record<DesignedRunType, number> = { inside_zone: 3, outside_zone: 20, inside_man_gap: 50, outside_man_gap: 27 };
    const total = 100;
    const target = (t: DesignedRunType) => k[t] / total + (NFL_RUN_MIX[t] - k[t] / total) * (k[t] / (k[t] + RUN_MIX_PRIOR));
    const sum = (Object.keys(k) as DesignedRunType[]).reduce((s, t) => s + target(t), 0);
    const w = runMixWeight(runs(k));
    for (const t of Object.keys(k) as DesignedRunType[]) {
      expect(w({ run_type: t }) * (k[t] / total)).toBeCloseTo(target(t) / sum, 12);
    }
    // 3 inside-zone runs move only 3/33 of the way from 3% toward 37%.
    expect(target("inside_zone")).toBeCloseTo(0.03 + 0.34 * (3 / 33), 12);
    // The heavy inside-gap share comes down toward 28%, so those runs weigh less.
    expect(w({ run_type: "inside_man_gap" })).toBeLessThan(1);
  });

  it("gives a run type he never ran no weight, and other plays 1", () => {
    const mine = runs({ inside_zone: 30, inside_man_gap: 30 });
    const w = runMixWeight(mine);
    expect(mine.reduce((s, r) => s + w(r), 0)).toBeCloseTo(60, 9);
    expect(w({ run_type: "route" })).toBe(1);
    expect(runMixWeight([])({ run_type: "inside_zone" })).toBe(1);
  });
});
