import { describe, it, expect } from "vitest";
import { isDynastyLeague } from "@/lib/helpers/leagueType";

// This predicate was byte-identical-duplicated in 7 files (hooks/useSleeperUser.ts,
// hooks/useSpyState.ts, hooks/useUserTrades.ts, hooks/useCrossLeagueMateIntel.ts,
// app/api/cron/league-transactions/route.ts, app/api/cron/simulation-history/route.ts,
// app/api/compile-consensus/route.ts) before being collapsed here (Sept 22 code-review).

describe("isDynastyLeague", () => {
  it("is dynasty when taxi_slots > 0 and not best ball", () => {
    expect(isDynastyLeague({ settings: { taxi_slots: 2 }, roster_positions: [] })).toBe(true);
  });

  it("is dynasty when roster_positions has more than 20 slots and not best ball", () => {
    expect(isDynastyLeague({ settings: {}, roster_positions: Array(21).fill("BN") })).toBe(true);
  });

  it("is NOT dynasty when neither taxi slots nor a 20+ roster is present", () => {
    expect(isDynastyLeague({ settings: {}, roster_positions: Array(16).fill("BN") })).toBe(false);
  });

  it("is NOT dynasty when best_ball is set, even with taxi slots", () => {
    expect(isDynastyLeague({ settings: { taxi_slots: 2, best_ball: 1 }, roster_positions: [] })).toBe(false);
  });

  it("tolerates missing settings/roster_positions", () => {
    expect(isDynastyLeague({})).toBe(false);
  });
});
