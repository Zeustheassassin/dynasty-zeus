import { describe, expect, it } from "vitest";
import { nextManUp } from "@/lib/helpers/depthChart";
import type { SleeperPlayer } from "@/lib/types";

const player = (id: string, over: Partial<SleeperPlayer>): SleeperPlayer => ({
  player_id: id, team: "PHI", position: "RB", status: "Active", injury_status: null, ...over,
}) as unknown as SleeperPlayer;

const room = (entries: Record<string, Partial<SleeperPlayer>>): Record<string, SleeperPlayer> =>
  Object.fromEntries(Object.entries(entries).map(([id, over]) => [id, player(id, over)]));

describe("nextManUp", () => {
  it("the starter goes out: his backup moves up", () => {
    const players = room({
      rb1: { depth_chart_order: 1, injury_status: "Out" },
      rb2: { depth_chart_order: 2 },
      rb3: { depth_chart_order: 3 },
    });
    expect(nextManUp(players, "rb1")?.[0]).toBe("rb2");
  });

  it("a backup goes out: the starter ahead of him isn't the opportunity", () => {
    const players = room({
      rb1: { depth_chart_order: 1 },
      rb2: { depth_chart_order: 2, injury_status: "Out" },
      rb3: { depth_chart_order: 3 },
    });
    expect(nextManUp(players, "rb2")?.[0]).toBe("rb3");
  });

  it("skips a backup who's hurt too", () => {
    const players = room({
      rb1: { depth_chart_order: 1, injury_status: "Out" },
      rb2: { depth_chart_order: 2, injury_status: "IR" },
      rb3: { depth_chart_order: 3 },
    });
    expect(nextManUp(players, "rb1")?.[0]).toBe("rb3");
  });

  it("a player Sleeper dropped from the chart leaves the healthy player at the top of it", () => {
    const players = room({
      star: { depth_chart_order: null, injury_status: "IR" },
      rb1: { depth_chart_order: 1 },
      rb2: { depth_chart_order: 2 },
    });
    expect(nextManUp(players, "star")?.[0]).toBe("rb1");
  });

  it("only counts his own team and position", () => {
    const players = room({
      rb1: { depth_chart_order: 1, injury_status: "Out" },
      otherTeam: { depth_chart_order: 2, team: "DAL" },
      otherPos: { depth_chart_order: 2, position: "WR" },
    });
    expect(nextManUp(players, "rb1")).toBeNull();
  });

  it("ignores players who aren't on the chart", () => {
    const players = room({
      rb1: { depth_chart_order: 1, injury_status: "Out" },
      unlisted: { depth_chart_order: null },
    });
    expect(nextManUp(players, "rb1")).toBeNull();
  });

  it("nothing for an unknown player or one with no team", () => {
    expect(nextManUp({}, "nobody")).toBeNull();
    expect(nextManUp(room({ fa: { team: null } }), "fa")).toBeNull();
  });
});
