import { describe, it, expect } from "vitest";
import { classDraftedBy, makeLock, activeLock } from "@/lib/scouting/scoreLock";
import type { AEScore, PositionComposite } from "@/lib/scouting/aeComposite";

describe("score lock", () => {
  it("counts a class as drafted from May 1 of its draft year", () => {
    expect(classDraftedBy(2026, new Date("2026-04-30T23:00:00Z"))).toBe(false);
    expect(classDraftedBy(2026, new Date("2026-05-01T00:00:00Z"))).toBe(true);
    expect(classDraftedBy(2027, new Date("2026-10-01T00:00:00Z"))).toBe(false);
  });

  it("keeps the score, its parts and the spread each was scored against", () => {
    const score: AEScore = { score: 1.2, components: [{ key: "aae", label: "AAE", weight: 1, ae: 5, n: 100, reliability: 0.4, z: 1.2 }] };
    const pc = { pos: "QB", ready: true, scores: new Map(), metrics: [{ key: "aae", label: "AAE", weight: 1, qualified: 22, ready: true, mean: 0.5, tau: 2 }] } as PositionComposite;
    const lock = makeLock(score, pc, new Date("2026-10-01T12:00:00Z"));
    expect(lock).toEqual({ score: 1.2, components: [{ ...score.components[0], tau: 2 }], locked_at: "2026-10-01T12:00:00.000Z" });
  });

  it("only honours a lock on a drafted class", () => {
    const lock = { score: 0.5, components: [], locked_at: "2026-10-01T00:00:00.000Z" };
    const now = new Date("2026-10-01T00:00:00Z");
    expect(activeLock({ draft_class_year: 2026, ae_score_lock: lock }, now)).toBe(lock);
    expect(activeLock({ draft_class_year: 2027, ae_score_lock: lock }, now)).toBeNull(); // class year edited back
    expect(activeLock({ draft_class_year: 2026, ae_score_lock: null }, now)).toBeNull();
    expect(activeLock({ draft_class_year: 2026 }, now)).toBeNull();
  });
});
