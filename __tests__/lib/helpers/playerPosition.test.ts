import { describe, it, expect } from "vitest";
import { fantasySkillPosition, withFantasyPositions } from "@/lib/helpers/playerPosition";

// Travis Hunter vanished from the app (2026-10-15): Sleeper lists him DB with ["DB","WR"], and
// nearly every view keeps only QB/RB/WR/TE by `position`. The player map now reads him as a WR.

describe("fantasySkillPosition", () => {
  it("reads a two-way player at his fantasy position (Travis Hunter: DB, [DB, WR] → WR)", () => {
    expect(fantasySkillPosition("DB", ["DB", "WR"])).toBe("WR");
    expect(fantasySkillPosition("CB", ["DB", "WR"])).toBe("WR");
    expect(fantasySkillPosition("SS", ["DB", "QB"])).toBe("QB");
  });

  it("leaves a QB/RB/WR/TE primary alone", () => {
    expect(fantasySkillPosition("TE", ["TE", "WR"])).toBe("TE");
    expect(fantasySkillPosition("WR", ["WR"])).toBe("WR");
  });

  it("never turns a fullback into a running back — a single eligibility doesn't count", () => {
    expect(fantasySkillPosition("FB", ["RB"])).toBe("FB");
  });

  it("leaves defenders, kickers and missing data as they are", () => {
    expect(fantasySkillPosition("LB", ["LB"])).toBe("LB");
    expect(fantasySkillPosition("DB", ["DB", "LB"])).toBe("DB");
    expect(fantasySkillPosition("K", null)).toBe("K");
    expect(fantasySkillPosition(undefined, undefined)).toBe("");
  });
});

describe("withFantasyPositions", () => {
  type P = { player_id: string; full_name: string; position: string; fantasy_positions: string[]; sleeper_position?: string };
  const hunter: P = { player_id: "12530", full_name: "Travis Hunter", position: "DB", fantasy_positions: ["DB", "WR"] };
  const wr = { player_id: "1", full_name: "A Receiver", position: "WR", fantasy_positions: ["WR"] };
  const fb = { player_id: "2", full_name: "A Fullback", position: "FB", fantasy_positions: ["RB"] };

  it("moves only the two-way player, keeping Sleeper's value as sleeper_position", () => {
    const players = { "12530": hunter, "1": wr, "2": fb };
    const out = withFantasyPositions(players);
    expect(out["12530"]).toEqual({ ...hunter, position: "WR", sleeper_position: "DB" });
    expect(out["1"]).toBe(wr);
    expect(out["2"]).toBe(fb);
    expect(players["12530"].position).toBe("DB"); // input untouched
  });

  it("returns the same map when nobody changes, and is safe to run twice", () => {
    const plain = { "1": wr, "2": fb };
    expect(withFantasyPositions(plain)).toBe(plain);
    const once = withFantasyPositions({ "12530": hunter });
    expect(withFantasyPositions(once)).toBe(once);
    expect(once["12530"].sleeper_position).toBe("DB");
  });
});
