import { describe, it, expect } from "vitest";
import { coverageEra, coverageEras } from "@/lib/scouting/coverageEra";
import type { ScoutingGame } from "@/lib/types";

const game = (id: string, created_at?: string) => ({ id, created_at }) as unknown as ScoutingGame;

describe("coverageEra", () => {
  it("puts the imported games under the old press definition and in-app charting under the new one", () => {
    expect(coverageEra(game("last import", "2026-04-30T20:07:28Z"))).toBe("old");
    expect(coverageEra(game("early", "2026-04-20T12:46:41Z"))).toBe("old");
    expect(coverageEra(game("first in-app", "2026-05-01T14:09:28Z"))).toBe("new");
  });

  it("counts a game with no creation time as the current definition", () => {
    expect(coverageEra(game("x"))).toBe("new");
    expect(coverageEra(undefined)).toBe("new");
  });

  it("maps games by id", () => {
    const m = coverageEras([game("a", "2026-04-30T19:00:00Z"), game("b", "2026-06-01T00:00:00Z")]);
    expect(m.get("a")).toBe("old");
    expect(m.get("b")).toBe("new");
  });
});
