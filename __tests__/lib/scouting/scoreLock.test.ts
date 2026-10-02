import { describe, it, expect } from "vitest";
import { classDraftedBy, makeLock, activeLock } from "@/lib/scouting/scoreLock";

describe("score lock", () => {
  it("counts a class as drafted from May 1 of its draft year", () => {
    expect(classDraftedBy(2026, new Date("2026-04-30T23:00:00Z"))).toBe(false);
    expect(classDraftedBy(2026, new Date("2026-05-01T00:00:00Z"))).toBe(true);
    expect(classDraftedBy(2027, new Date("2026-10-01T00:00:00Z"))).toBe(false);
  });

  it("keeps the score, its parts with their spreads, and any alignment penalty or position baseline", () => {
    const components = [{ key: "csae", label: "cSAE", weight: 0.7, ae: 5, n: 100, reliability: 0.4, z: 1.2, tau: 4 }];
    const at = new Date("2026-10-01T12:00:00Z");
    expect(makeLock({ score: 1.2, components }, at)).toEqual({ score: 1.2, components, locked_at: "2026-10-01T12:00:00.000Z" });
    const alignment = { label: "96% of snaps on the right side", value: -0.5 };
    expect(makeLock({ score: 0.7, components, alignment }, at).alignment).toEqual(alignment);
    expect(makeLock({ score: 0.5, components, baseline: -0.2 }, at).baseline).toBe(-0.2);
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
