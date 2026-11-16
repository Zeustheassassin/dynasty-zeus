import { describe, it, expect } from "vitest";
import {
  countUnwatched,
  normalizeTapeSource,
  tapeLink,
  tapeSourceSuggestions,
  unwatchedByProspect,
} from "../../../lib/scouting/unwatchedGames";
import type { Prospect, ScoutingGame } from "../../../lib/types";

// 2026-11-16, the user: a list of "all the logged games that do not have any
// charted plays associated with them … right now it might show '8 charted games'
// but really i only charted 6 and 2 havent been completed yet."

type P = Pick<Prospect, "id" | "name" | "position" | "draft_class_year" | "personal_rank">;
const prospect = (id: string, extra: Partial<P> = {}): P =>
  ({ id, name: id, position: "WR", draft_class_year: 2027, personal_rank: null, ...extra });
const game = (id: string, prospect_id: string, season_year = 2026, game_slot = 1) =>
  ({ id, prospect_id, season_year, game_slot, opponent: `Opp ${id}`, game_type: "regular" }) as ScoutingGame;

describe("unwatchedByProspect", () => {
  it("lists only games with no charted plays, and counts every logged game", () => {
    const games = [game("g1", "a", 2026, 1), game("g2", "a", 2026, 2), game("g3", "a", 2026, 3)];
    const groups = unwatchedByProspect(games, [
      { game_id: "g1", snaps_charted: 41 },
      { game_id: "g2", snaps_charted: 0 },
      { game_id: "g3", snaps_charted: 0 },
    ], [prospect("a")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].games.map((g) => g.id)).toEqual(["g2", "g3"]);
    expect(groups[0].logged).toBe(3);
  });

  it("leaves out prospects whose every game is charted", () => {
    const groups = unwatchedByProspect([game("g1", "a")], [{ game_id: "g1", snaps_charted: 1 }], [prospect("a")]);
    expect(groups).toEqual([]);
  });

  it("calls a game with no play count unwatched (logged between the two reads)", () => {
    const groups = unwatchedByProspect([game("g1", "a")], [], [prospect("a")]);
    expect(groups[0].games.map((g) => g.id)).toEqual(["g1"]);
  });

  it("skips games whose prospect isn't on the board", () => {
    expect(unwatchedByProspect([game("g1", "gone")], [], [prospect("a")])).toEqual([]);
  });

  it("orders his games oldest season first, then by slot", () => {
    const games = [game("late", "a", 2026, 2), game("old", "a", 2025, 4), game("early", "a", 2026, 1)];
    const [group] = unwatchedByProspect(games, [], [prospect("a")]);
    expect(group.games.map((g) => g.id)).toEqual(["old", "early", "late"]);
  });

  it("orders prospects by class, then QB RB WR TE, then rank (unranked last), then name", () => {
    const prospects = [
      prospect("te27", { position: "TE" }),
      prospect("wr28", { draft_class_year: 2028 }),
      prospect("wrUnrankedB", { name: "B" }),
      prospect("wrUnrankedA", { name: "A" }),
      prospect("wr5", { personal_rank: 5 }),
      prospect("wr2", { personal_rank: 2 }),
      prospect("qb27", { position: "QB", personal_rank: 40 }),
      prospect("rb27", { position: "RB" }),
    ];
    const games = prospects.map((p, i) => game(`g${i}`, p.id));
    expect(unwatchedByProspect(games, [], prospects).map((g) => g.prospect.id))
      .toEqual(["qb27", "rb27", "wr2", "wr5", "wrUnrankedA", "wrUnrankedB", "te27", "wr28"]);
  });

  it("counts the games across groups", () => {
    const games = [game("g1", "a"), game("g2", "a", 2026, 2), game("g3", "b")];
    expect(countUnwatched(unwatchedByProspect(games, [], [prospect("a"), prospect("b")]))).toBe(3);
  });
});

// 2026-11-16, the user: "somewhere to mark where the tape is from for all the
// games i havent watched … Justin Bowick Colorado hasnt been watched yet and the
// tape is located on Dynasty Nerds", "Would be nice to mark it on that tab".
describe("tape source", () => {
  it("saves trimmed with single spaces, and blank as null", () => {
    expect(normalizeTapeSource("  Dynasty   Nerds ")).toBe("Dynasty Nerds");
    expect(normalizeTapeSource("   ")).toBeNull();
    expect(normalizeTapeSource("")).toBeNull();
    expect(normalizeTapeSource(null)).toBeNull();
    expect(normalizeTapeSource("x".repeat(400))).toHaveLength(300);
  });

  it("suggests the sources used, most-used first, one spelling per source, no links", () => {
    expect(tapeSourceSuggestions([
      "YouTube", "Dynasty Nerds", "dynasty nerds", "Dynasty Nerds", null, "", "https://youtu.be/abc", "ESPN+", "YouTube",
    ])).toEqual(["Dynasty Nerds", "YouTube", "ESPN+"]);
  });

  it("opens only http(s) links", () => {
    expect(tapeLink("https://youtu.be/abc")).toBe("https://youtu.be/abc");
    expect(tapeLink(" http://example.com/x ")).toBe("http://example.com/x");
    expect(tapeLink("Dynasty Nerds")).toBeNull();
    expect(tapeLink("javascript:alert(1)")).toBeNull();
    expect(tapeLink("https://")).toBeNull();
    expect(tapeLink(null)).toBeNull();
  });
});
