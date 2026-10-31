import { describe, it, expect } from "vitest";
import {
  trimSleeperProjectionWeek, scoreWeeklyProjections, remainingRegularSeasonWeeks,
} from "@/lib/helpers/weeklyProjections";

describe("trimSleeperProjectionWeek", () => {
  it("keeps only skill players Sleeper projects to score, with only scoring stats", () => {
    const week = trimSleeperProjectionWeek([
      { player_id: 1, player: { position: "WR" }, stats: { rec: 5.123, rec_yd: 60, pts_ppr: 11, pts_std: 6, adp_dd_ppr: 40, pos_adp_dd_ppr: 12, gp: 1, rush_yd: 0 } },
      { player_id: "2", player: { position: "QB" }, stats: { pass_att: 0, pts_ppr: 0, pts_std: 0 } }, // bye / out
      { player_id: "3", player: { position: "K" }, stats: { fgm: 2, pts_ppr: 8 } },
      { player_id: "4", player: { position: "RB" } }, // no stats at all
    ]);
    expect(week).toEqual({ "1": { position: "WR", stats: { rec: 5.12, rec_yd: 60 } } });
  });

  it("reads a two-way player at his fantasy position (Travis Hunter: DB listed, WR eligible)", () => {
    const week = trimSleeperProjectionWeek([
      { player_id: "12", player: { position: "DB", fantasy_positions: ["DB", "WR"] }, stats: { rec: 3, pts_half_ppr: 5 } },
    ]);
    expect(week["12"]?.position).toBe("WR");
  });
});

describe("scoreWeeklyProjections", () => {
  it("scores every week under the league's rules, TE premium included", () => {
    const scored = scoreWeeklyProjections(
      {
        9: { a: { position: "TE", stats: { rec: 4, rec_yd: 50 } }, b: { position: "WR", stats: { rec: 4, rec_yd: 50 } } },
        10: { a: { position: "TE", stats: { rec: 2, rec_yd: 20 } } },
      },
      { rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5 },
    );
    expect(scored).toEqual({ 9: { a: 11, b: 9 }, 10: { a: 5 } });
  });

  it("leaves out a player whose projection comes to 0 or less in this league", () => {
    const scored = scoreWeeklyProjections({ 9: { q: { position: "QB", stats: { pass_int: 1 } } } }, { pass_int: -2 });
    expect(scored).toEqual({ 9: {} });
  });
});

describe("remainingRegularSeasonWeeks", () => {
  it("runs from this week through the last week before the playoffs", () => {
    expect(remainingRegularSeasonWeeks(8, 14)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(remainingRegularSeasonWeeks(14, 14)).toEqual([14]);
  });

  it("is empty in the offseason and once the regular season is over", () => {
    expect(remainingRegularSeasonWeeks(0, 14)).toEqual([]);
    expect(remainingRegularSeasonWeeks(15, 14)).toEqual([]);
  });
});
