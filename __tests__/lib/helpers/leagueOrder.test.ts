import { describe, it, expect } from "vitest";
import { getSleeperLeagueOrder } from "@/lib/helpers/leagueOrder";

// The user's league order in the Sleeper app (display_order), which the To-Do hub lists by (10/14).

describe("getSleeperLeagueOrder", () => {
  it("ranks by display_order, not by where the league sits in the list", () => {
    const order = getSleeperLeagueOrder([
      { league_id: "c", display_order: 2 },
      { league_id: "a", display_order: 0 },
      { league_id: "b", display_order: 1 },
    ]);
    expect([...order.entries()]).toEqual([["a", 0], ["b", 1], ["c", 2]]);
  });

  it("keeps list order for leagues without one, after those that have one", () => {
    const order = getSleeperLeagueOrder([
      { league_id: "x" }, { league_id: "b", display_order: 5 }, { league_id: "y" }, { league_id: "a", display_order: 1 },
    ]);
    expect([...order.keys()]).toEqual(["a", "b", "x", "y"]);
  });

  it("breaks a tie by list order", () => {
    const order = getSleeperLeagueOrder([{ league_id: "q", display_order: 3 }, { league_id: "p", display_order: 3 }]);
    expect([...order.keys()]).toEqual(["q", "p"]);
  });
});
