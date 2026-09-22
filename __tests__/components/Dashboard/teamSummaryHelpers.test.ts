import { describe, it, expect } from "vitest";
import { sortByPlayoffOdds } from "@/components/Dashboard/teamSummaryHelpers";

describe("sortByPlayoffOdds", () => {
  it("orders entries by playoff odds, highest first", () => {
    const result = sortByPlayoffOdds([
      { entry: "mid", playoffOdds: 50 },
      { entry: "best", playoffOdds: 90 },
      { entry: "worst", playoffOdds: 10 },
    ]);
    expect(result).toEqual(["best", "mid", "worst"]);
  });

  it("sorts a real 0% below every league with a positive number", () => {
    const result = sortByPlayoffOdds([
      { entry: "longshot", playoffOdds: 0 },
      { entry: "contender", playoffOdds: 60 },
    ]);
    expect(result).toEqual(["contender", "longshot"]);
  });

  it("sends leagues with no simulator history (undefined) to the very end, below a real 0%", () => {
    const result = sortByPlayoffOdds([
      { entry: "no-data", playoffOdds: undefined },
      { entry: "longshot", playoffOdds: 0 },
      { entry: "contender", playoffOdds: 60 },
    ]);
    expect(result).toEqual(["contender", "longshot", "no-data"]);
  });

  it("keeps original relative order among ties (stable sort)", () => {
    const result = sortByPlayoffOdds([
      { entry: "first-no-data", playoffOdds: undefined },
      { entry: "second-no-data", playoffOdds: undefined },
      { entry: "third-no-data", playoffOdds: undefined },
    ]);
    expect(result).toEqual(["first-no-data", "second-no-data", "third-no-data"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { entry: "a", playoffOdds: 10 },
      { entry: "b", playoffOdds: 90 },
    ];
    const copy = [...input];
    sortByPlayoffOdds(input);
    expect(input).toEqual(copy);
  });
});
