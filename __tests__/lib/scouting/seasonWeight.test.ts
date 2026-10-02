import { describe, it, expect } from "vitest";
import { SEASON_DECAY, seasonWeights, playWeights } from "@/lib/scouting/seasonWeight";
import type { ScoutingGame } from "@/lib/types";

const game = (id: string, prospect_id: string, season_year?: number): ScoutingGame =>
  ({ id, prospect_id, season_year }) as unknown as ScoutingGame;

describe("seasonWeights", () => {
  it("counts the newest season in full and decays each season back", () => {
    const w = seasonWeights([game("a26", "a", 2026), game("a25", "a", 2025), game("a24", "a", 2024), game("a26b", "a", 2026)]);
    expect(w.get("a26")).toBe(1);
    expect(w.get("a26b")).toBe(1);
    expect(w.get("a25")).toBeCloseTo(SEASON_DECAY, 12);
    expect(w.get("a24")).toBeCloseTo(SEASON_DECAY ** 2, 12);
  });

  it("measures age from each prospect's own newest season", () => {
    const w = seasonWeights([game("a25", "a", 2025), game("b26", "b", 2026), game("b25", "b", 2025)]);
    expect(w.get("a25")).toBe(1);
    expect(w.get("b25")).toBeCloseTo(SEASON_DECAY, 12);
  });

  it("counts a game with no season in full", () => {
    const w = seasonWeights([game("x", "a"), game("a25", "a", 2025)]);
    expect(w.get("x")).toBe(1);
    expect(w.get("a25")).toBe(1);
  });

  it("splits three equal seasons about 36 / 33 / 30 (the user's example)", () => {
    const w = seasonWeights([game("26", "a", 2026), game("25", "a", 2025), game("24", "a", 2024)]);
    const total = w.get("26")! + w.get("25")! + w.get("24")!;
    expect((w.get("26")! / total) * 100).toBeCloseTo(36.3, 1);
    expect((w.get("25")! / total) * 100).toBeCloseTo(33.25, 1);
    expect((w.get("24")! / total) * 100).toBeCloseTo(30.4, 1);
    // 6.41 / 5.21 / 4.98 on equal snaps: 5.58 instead of the flat 5.53.
    const blended = (6.41 * w.get("26")! + 5.21 * w.get("25")! + 4.98 * w.get("24")!) / total;
    expect(blended).toBeCloseTo(5.58, 2);
  });
});

describe("playWeights", () => {
  it("reads a play's weight off its game, 1 for an unknown game", () => {
    const wOf = playWeights([game("g26", "a", 2026), game("g25", "a", 2025)]);
    expect(wOf({ game_id: "g26" })).toBe(1);
    expect(wOf({ game_id: "g25" })).toBeCloseTo(SEASON_DECAY, 12);
    expect(wOf({ game_id: "nope" })).toBe(1);
  });
});
