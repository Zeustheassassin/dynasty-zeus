import { describe, it, expect } from "vitest";
import {
  MIDDLE_BONUS_FULL, MIDDLE_BONUS_START, MIDDLE_MAX, MIDDLE_PENALTY_FULL, MIDDLE_PENALTY_START, MIDDLE_POOL_SHARE,
  MIDDLE_SHRINK_ATTEMPTS, depthSeasonsFor, middleAdjustment, middleUsageByProspect, seasonMiddle, zoneAttemptsFrom,
  type MiddleUsage, type PffSeasonDepthRow,
} from "@/lib/scouting/middleUsage";
import { SEASON_DECAY } from "@/lib/scouting/seasonWeight";
import { makeLock } from "@/lib/scouting/scoreLock";

// A season: `past` attempts past the line, `mid` of them 10+ yds between the
// numbers (split medium / deep), plus some behind the line and short middle,
// which never count as middle.
const zones = (past: number, mid: number): Record<string, number> => ({
  left_behind_los: 10, center_behind_los: 5, right_behind_los: 10,
  center_short: 20, center_medium: Math.max(0, mid - 2), center_deep: Math.min(2, mid),
  left_short: past - mid - 20, left_medium: 0, left_deep: 0, right_short: 0, right_medium: 0, right_deep: 0,
});
const row = (prospect_id: string, season: number, past: number, mid: number): PffSeasonDepthRow =>
  ({ prospect_id, season, pff_player_id: 1, team_name: "X", zone_attempts: zones(past, mid), fetched_at: "" });
const usage = (share: number): MiddleUsage => ({ share, rawShare: share, middle: 0, attempts: 300, seasons: [2025] });

describe("middle of the field share", () => {
  it("counts 10+ yd middle throws over attempts past the line; short middle and screens don't count", () => {
    expect(seasonMiddle(zones(300, 60))).toEqual({ middle: 60, pastLos: 300 });
  });

  it("reads PFF's zone attempts, 0 where PFF leaves one blank", () => {
    const z = zoneAttemptsFrom({ center_medium_attempts: 31, left_deep_attempts: 4.0, right_short_attempts: null, center_medium_accuracy_percent: 70 });
    expect(Object.keys(z)).toHaveLength(12);
    expect(z).toMatchObject({ center_medium: 31, left_deep: 4, right_short: 0, center_behind_los: 0 });
  });

  it("blends seasons by attempts with the AE season fade, then pulls toward the college average", () => {
    const u = middleUsageByProspect([row("Q", 2025, 300, 45), row("Q", 2024, 200, 70)]).get("Q")!;
    const w = SEASON_DECAY;
    const raw = (100 * (45 + w * 70)) / (300 + w * 200);
    expect(u.rawShare).toBeCloseTo(raw, 9);
    expect(u.share).toBeCloseTo((raw * (300 + w * 200) + MIDDLE_SHRINK_ATTEMPTS * MIDDLE_POOL_SHARE) / (300 + w * 200 + MIDDLE_SHRINK_ATTEMPTS), 9);
    expect(u).toMatchObject({ middle: 115, attempts: 500, seasons: [2024, 2025] });
    // A thin sample is mostly the average: 5 of 30 (16.7%) reads 21.3%, no adjustment.
    const thin = middleUsageByProspect([row("T", 2025, 30, 5)]).get("T")!;
    expect(thin.rawShare).toBeCloseTo(100 * 5 / 30, 9);
    expect(thin.share).toBeCloseTo((500 + MIDDLE_SHRINK_ATTEMPTS * MIDDLE_POOL_SHARE) / (30 + MIDDLE_SHRINK_ATTEMPTS), 9);
    expect(middleAdjustment(thin)).toBeNull();
  });

  it("skips a season with nothing past the line, and a prospect with no seasons", () => {
    const empty = { ...row("E", 2025, 0, 0), zone_attempts: { center_behind_los: 12 } };
    expect(middleUsageByProspect([empty]).has("E")).toBe(false);
  });
});

describe("middle of the field adjustment (the user's picks, 2026-11-10)", () => {
  it("nothing between the bottom and top quarters", () => {
    expect(middleAdjustment(usage(MIDDLE_PENALTY_START))).toBeNull();
    expect(middleAdjustment(usage(22))).toBeNull();
    expect(middleAdjustment(usage(MIDDLE_BONUS_START))).toBeNull();
    expect(middleAdjustment(null)).toBeNull();
  });

  it("costs up to 0.3 in the bottom quarter, full at the bottom 5%, curving like the alignment penalty", () => {
    expect(MIDDLE_MAX).toBe(0.3);
    expect([MIDDLE_PENALTY_FULL, MIDDLE_PENALTY_START, MIDDLE_BONUS_START, MIDDLE_BONUS_FULL]).toEqual([17.7, 20.5, 24.1, 28.3]);
    expect(middleAdjustment(usage(MIDDLE_PENALTY_FULL))!.value).toBeCloseTo(-0.3, 12);
    expect(middleAdjustment(usage(8))!.value).toBeCloseTo(-0.3, 12);
    const half = middleAdjustment(usage((MIDDLE_PENALTY_START + MIDDLE_PENALTY_FULL) / 2))!.value;
    expect(half).toBeCloseTo(-0.3 * 0.5 ** 1.5, 12);
  });

  it("earns up to 0.3 in the top quarter, full at the top 5%", () => {
    expect(middleAdjustment(usage(MIDDLE_BONUS_FULL))!.value).toBeCloseTo(0.3, 12);
    expect(middleAdjustment(usage(36))!.value).toBeCloseTo(0.3, 12);
    expect(middleAdjustment(usage((MIDDLE_BONUS_START + MIDDLE_BONUS_FULL) / 2))!.value).toBeCloseTo(0.3 * 0.5 ** 1.5, 12);
  });

  it("says what it read", () => {
    const label = middleAdjustment({ share: 17.5, rawShare: 16.4, middle: 39, attempts: 238, seasons: [2024, 2025] })!.label;
    expect(label).toContain("16.4% of 238 throws past the line");
    expect(label).toContain("2024–2025");
    expect(label).toContain("17.5%");
  });

  it("rides along in the draft-day snapshot", () => {
    const lock = makeLock({ score: 1, components: [], middle: { label: "x", value: -0.1 } }, new Date("2027-05-02T00:00:00Z"));
    expect(lock.middle).toEqual({ label: "x", value: -0.1 });
    expect(makeLock({ score: 1, components: [] }, new Date()).middle).toBeUndefined();
  });
});

describe("depthSeasonsFor", () => {
  it("reads the five seasons before his class, never past the season under way", () => {
    expect(depthSeasonsFor(2027, [2025], new Date("2026-11-10T00:00:00Z"))).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(depthSeasonsFor(2028, [2025], new Date("2026-11-10T00:00:00Z"))).toEqual([2023, 2024, 2025, 2026]);
    // Before August the season under way is last year's.
    expect(depthSeasonsFor(2028, [], new Date("2026-05-01T00:00:00Z"))).toEqual([2023, 2024, 2025]);
    expect(depthSeasonsFor(2026, [2025], new Date("2026-11-10T00:00:00Z"))).toEqual([2021, 2022, 2023, 2024, 2025]);
  });

  it("without a class, from a season before his first charted one", () => {
    expect(depthSeasonsFor(null, [2025, 2024], new Date("2026-11-10T00:00:00Z"))).toEqual([2023, 2024, 2025, 2026]);
  });
});
