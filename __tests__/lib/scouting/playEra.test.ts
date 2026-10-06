import { describe, it, expect } from "vitest";
import { countPlayEras, gameSource, isTaggedPlay, playEra, POSITION_TAGS, SITUATION_TAGS, tagColumns } from "@/lib/scouting/playEra";

const imported = { created_at: "2026-04-30T20:07:28Z" };
const inApp = { created_at: "2026-06-01T00:00:00Z" };

describe("tag registry", () => {
  it("puts the four situation tags on every position, first", () => {
    for (const pos of ["QB", "RB", "WR", "TE"] as const) {
      expect(tagColumns(pos).slice(0, 4)).toEqual(["red_zone", "third_fourth_down", "short_yardage", "garbage_time"]);
    }
    expect(SITUATION_TAGS.map((t) => t.entry)).toEqual(["sticky", "exception", "exception", "sticky"]);
  });

  it("uses new columns for broken tackles after the catch, never the old NOT NULL broken_tackle", () => {
    for (const pos of ["QB", "RB", "WR", "TE"] as const) expect(tagColumns(pos)).not.toContain("broken_tackle");
    expect(tagColumns("RB")).toContain("broken_tackle_after_catch");
    expect(tagColumns("WR")).toContain("broken_tackle_after_catch");
  });

  it("matches migration 062's enum CHECKs and presets", () => {
    const qb = Object.fromEntries(POSITION_TAGS.QB.map((t) => [t.column, t]));
    expect(qb.release_timing.values).toEqual(["early", "on_time", "late"]);
    expect(qb.release_timing.preset).toBe("on_time");
    expect(qb.sack_fault.values).toEqual(["qb", "line", "coverage"]);
    expect(qb.sack_fault.preset).toBe("line");
    const te = Object.fromEntries(POSITION_TAGS.TE.map((t) => [t.column, t]));
    expect(te.blocked_defender.values).toEqual(["dl", "lb", "db"]);
    expect(te.blocked_defender.preset).toBe("dl");
    expect(POSITION_TAGS.RB.find((t) => t.column === "pass_pro_loss")?.values).toEqual(["wrong_man", "beaten"]);
  });
});

describe("isTaggedPlay", () => {
  it("treats a play with every tag null or absent as charted before the tags existed", () => {
    expect(isTaggedPlay({ route_type: "nine" }, "WR")).toBe(false);
    expect(isTaggedPlay({ red_zone: null, press_release: null }, "WR")).toBe(false);
    // An old RB row's NOT NULL DEFAULT false columns don't make it tagged.
    expect(isTaggedPlay({ broken_tackle: false, explosive_play: false }, "RB")).toBe(false);
  });

  it("treats any non-null situation tag, false included, as a tagged play", () => {
    expect(isTaggedPlay({ red_zone: false }, "QB")).toBe(true);
    expect(isTaggedPlay({ garbage_time: false, third_fourth_down: false }, "TE")).toBe(true);
    expect(isTaggedPlay({ red_zone: false, release_timing: "on_time" }, "QB")).toBe(true);
  });

  it("a position tag alone leaves an old play old (RPO play action backfilled by 067)", () => {
    expect(isTaggedPlay({ play_type: "rpo", play_action: true, red_zone: null }, "QB")).toBe(false);
    expect(isTaggedPlay({ release_timing: "on_time" }, "QB")).toBe(false);
    expect(isTaggedPlay({ press_release: "won" }, "TE")).toBe(false);
  });
});

describe("playEra", () => {
  it("labels each play by its own era, so one prospect can have all three", () => {
    expect(playEra({}, imported, "WR")).toBe("imported");
    expect(playEra({ red_zone: null }, inApp, "WR")).toBe("in_app");
    expect(playEra({ red_zone: false }, inApp, "WR")).toBe("tagged");
  });

  it("follows coverageEra for the game's source", () => {
    expect(gameSource(imported)).toBe("imported");
    expect(gameSource(inApp)).toBe("in_app");
    expect(gameSource(undefined)).toBe("in_app");
  });

  it("counts plays per era", () => {
    const games = new Map([["g1", imported], ["g2", inApp]]);
    const plays = [
      { game_id: "g1" }, { game_id: "g1" },
      { game_id: "g2" }, { game_id: "g2", red_zone: true }, { game_id: "g2", short_yardage: false },
    ];
    expect(countPlayEras(plays, games, "RB")).toEqual({ imported: 2, in_app: 1, tagged: 2 });
  });
});
