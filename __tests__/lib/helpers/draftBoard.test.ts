import { describe, it, expect } from "vitest";
import {
  sortDraftBoard, nflDraftLabel, latestScoresSavedAt, fcClassValues, fcValueFor,
  draftBoardSnapshotRows, readNotes, draftBoardRookies, unionRookies, sameRookie, isDraftedRookie,
  draftBoardTiers, tierRangeLabel, tierScore,
  type DraftBoardProspect,
} from "../../../lib/helpers/draftBoard";
import { normalizeRookieName } from "../../../lib/helpers/formatting";
import type { BoardScores, RookieBoardPlayer } from "../../../lib/types";

const scores = (dynasty: number | null, saved_at = "2026-10-09T19:19:15.322Z", plus: number | null = null): BoardScores => ({
  dynasty, plus,
  sample: { n: 120, share: 0.667, tier: "half" },
  weights: { age: 1, size: 1, draft: 2 },
  saved_at,
});

const prospect = (id: string, name: string, overall_rank: number | null, board_scores: BoardScores | null = null, extra: Partial<DraftBoardProspect> = {}): DraftBoardProspect => ({
  id, name, position: "WR", school: "Ohio State", draft_class_year: 2027,
  overall_rank, draft_round: null, draft_pick: null, draft_team: null, board_scores, ...extra,
});

describe("sortDraftBoard", () => {
  it("puts ranked prospects first by OVR, the unranked below by Dynasty Score, then name", () => {
    const rows = [
      prospect("a", "Zed Unranked", null, scores(1.5)),
      prospect("b", "Bo Second", 2),
      prospect("c", "Al Unscored", null, null),
      prospect("d", "Cy First", 1, scores(-3)),
      prospect("e", "Ann Unranked", null, scores(2.25)),
      prospect("f", "Ben Unscored", null, scores(null)),
    ];
    expect(sortDraftBoard(rows).map((p) => p.id)).toEqual(["d", "b", "e", "a", "c", "f"]);
  });

  it("breaks OVR ties by name, and Dynasty ties by name", () => {
    const rows = [
      prospect("a", "Yu", 3), prospect("b", "Xi", 3),
      prospect("c", "Pat", null, scores(1)), prospect("d", "Abe", null, scores(1)),
    ];
    expect(sortDraftBoard(rows).map((p) => p.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("leaves the input alone", () => {
    const rows = [prospect("a", "B", 2), prospect("b", "A", 1)];
    sortDraftBoard(rows);
    expect(rows.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("nflDraftLabel", () => {
  it("shows the slot once an NFL team is set", () => {
    expect(nflDraftLabel({ draft_team: "NYJ", draft_round: 1, draft_pick: 3 })).toBe("NYJ · R1 · #3");
    expect(nflDraftLabel({ draft_team: "KC", draft_round: 8, draft_pick: 300 })).toBe("KC · Undrafted");
  });

  it("is null before he's drafted, even with a round set", () => {
    expect(nflDraftLabel({ draft_team: null, draft_round: 2, draft_pick: null })).toBeNull();
    expect(nflDraftLabel({ draft_team: "", draft_round: null, draft_pick: null })).toBeNull();
  });
});

describe("latestScoresSavedAt", () => {
  it("takes the newest save, skipping rows without scores", () => {
    const rows = [
      prospect("a", "A", 1, scores(1, "2026-10-08T10:00:00.000Z")),
      prospect("b", "B", 2, null),
      prospect("c", "C", 3, scores(1, "2026-10-09T19:19:15.322Z")),
    ];
    expect(latestScoresSavedAt(rows)).toBe("2026-10-09T19:19:15.322Z");
    expect(latestScoresSavedAt([prospect("b", "B", 2)])).toBeNull();
  });
});

// FantasyCalc's /values/current shape, trimmed to what fcClassValues reads.
const fc = (name: string, position: string, value: number, extra: Record<string, unknown> = {}) =>
  ({ value, player: { name, position, ...extra } });

describe("fcClassValues", () => {
  const raw = [
    fc("DJ Moore", "WR", 2014, { maybeYoe: 8, maybeTeam: "CHI", maybeDraftInfo: { year: 2018, round: 1, pick: 24 } }),
    fc("Carnell Tate", "WR", 3644, { maybeYoe: 0, maybeTeam: "TEN", maybeDraftInfo: { year: 2026, round: 1, pick: 4 } }),
    fc("Carson Beck", "QB", 900, { maybeYoe: 0, maybeTeam: "ARI", maybeDraftInfo: null }),
    fc("Jeremiah Smith", "WR", 7000, { maybeYoe: 0, maybeTeam: null, maybeDraftInfo: null }),
    fc("Arch Manning", "QB", 5000, { maybeYoe: 0, maybeTeam: "FA" }),
    fc("2027 Round 1", "PICK", 4000),
    fc("No Value", "RB", 0, { maybeYoe: 0 }),
  ];

  it("keeps the class's own rookies and prospects not drafted yet", () => {
    expect([...fcClassValues(raw, 2027).keys()].sort()).toEqual(["archmanning", "jeremiahsmith"]);
    expect([...fcClassValues(raw, 2026).keys()].sort()).toEqual(["archmanning", "carnelltate", "jeremiahsmith"]);
  });

  it("drops veterans and last class's undrafted rookies who have signed", () => {
    const m = fcClassValues(raw, 2027);
    expect(m.has("djmoore")).toBe(false);
    expect(m.has("carsonbeck")).toBe(false);
  });

  it("keeps the higher value for a repeated name (FantasyCalc lists by value)", () => {
    const m = fcClassValues([fc("Kevin Coleman", "WR", 1500, { maybeYoe: 0 }), fc("Kevin Coleman", "RB", 300, { maybeYoe: 0 })], 2027);
    expect(m.get("kevincoleman")).toEqual({ value: 1500, position: "WR" });
  });

  it("survives junk", () => {
    expect(fcClassValues([null, 7, "x", {}, { value: 5 }], 2027).size).toBe(0);
  });
});

describe("fcValueFor", () => {
  const m = fcClassValues([
    fc("Jeremiah Smith", "WR", 7000, { maybeYoe: 0 }),
    fc("Bryce Underwood", "QB", 4000, { maybeYoe: 0 }),
    fc("Ryan Williams", "WR", 5000, { maybeYoe: 0 }),
  ], 2027);

  it("matches an exact name at any position", () => {
    expect(fcValueFor("Jeremiah Smith", "WR", m)).toBe(7000);
    expect(fcValueFor("Jeremiah Smith Jr.", "RB", m)).toBe(7000);
  });

  it("matches a near miss only at his own position", () => {
    expect(fcValueFor("Bryce Underwod", "QB", m)).toBe(4000);
    expect(fcValueFor("Bryce Underwod", "RB", m)).toBe(0);
    expect(fcValueFor("Ryan Wiliams", "WR", m)).toBe(5000);
  });

  it("never reaches a veteran (T.J. Moore isn't DJ Moore)", () => {
    const withVet = fcClassValues([fc("DJ Moore", "WR", 2014, { maybeYoe: 8, maybeTeam: "CHI", maybeDraftInfo: { year: 2018 } })], 2027);
    expect(fcValueFor("T.J. Moore", "WR", withVet)).toBe(0);
  });

  it("is 0 for no match or no name", () => {
    expect(fcValueFor("Nobody Here", "WR", m)).toBe(0);
    expect(fcValueFor("", "WR", m)).toBe(0);
  });
});

describe("draftBoardSnapshotRows", () => {
  it("saves each row's place, OVR, tier, FC, Dynasty, Dynasty+ and prospect id", () => {
    const board = [
      prospect("p1", "Cy First", 1, scores(1.234, undefined, 3.234), { draft_team: "NYJ", draft_round: 1, draft_pick: 3 }),
      prospect("p2", "Al Unranked", null, scores(null), { school: "" }),
    ];
    const rows = draftBoardSnapshotRows(board, new Map([["p1", { tier: 2 }]]), (p) => (p.id === "p1" ? 6500 : 0));
    expect(rows).toEqual([
      {
        prospect_id: "p1", player_id: null, name: "Cy First", position: "WR", school: "Ohio State", team: "NYJ",
        rank: 1, ovr: 1, tier: 2, fc_value: 6500, dynasty: 1.234, plus: 3.234,
        nfl_draft: { team: "NYJ", round: 1, pick: 3 },
      },
      {
        prospect_id: "p2", player_id: null, name: "Al Unranked", position: "WR", school: null, team: null,
        rank: 2, ovr: null, tier: null, fc_value: 0, dynasty: null, plus: null, nfl_draft: null,
      },
    ]);
  });
});

describe("draftBoardTiers (0.25 brackets from the top score)", () => {
  const tierOf = (rows: DraftBoardProspect[], drafted = false) => {
    const t = draftBoardTiers(rows, drafted);
    return Object.fromEntries(rows.map((p) => [p.id, t.get(p.id)?.tier ?? null]));
  };

  it("starts T1 at the top score's bracket and steps down 0.25 a tier", () => {
    // The 2027 board on 2026-11-17: Smith +2.199 shows +2.20, so T1 is +2.00 to +2.25.
    const rows = [
      prospect("smith", "Smith", 1, scores(2.199)),
      prospect("baugh", "Baugh", 2, scores(2.019)),
      prospect("overmyer", "Overmyer", 3, scores(1.843)),
      prospect("mestemaker", "Mestemaker", 5, scores(1.569)),
      prospect("mensah", "Mensah", 6, scores(1.409)),
      prospect("marsh", "Marsh", 10, scores(1.13)),
    ];
    expect(tierOf(rows)).toEqual({ smith: 1, baugh: 1, overmyer: 2, mestemaker: 3, mensah: 4, marsh: 5 });
    expect(draftBoardTiers(rows, false).get("smith")).toEqual({ tier: 1, low: 2, high: 2.25 });
  });

  it("skips the number of an empty bracket", () => {
    const rows = [prospect("a", "A", 1, scores(2.1)), prospect("b", "B", 2, scores(1.8)), prospect("c", "C", 3, scores(1.3))];
    expect(tierOf(rows)).toEqual({ a: 1, b: 2, c: 4 }); // nobody in +1.50 to +1.75, so no T3
  });

  it("puts a score on an edge in the bracket above, read at the board's two decimals", () => {
    const rows = [
      prospect("a", "A", 1, scores(2.2)),
      prospect("edge", "Edge", 2, scores(2)),
      prospect("shows200", "Shows 2.00", 3, scores(1.996)),
      prospect("shows199", "Shows 1.99", 4, scores(1.994)),
    ];
    expect(tierOf(rows)).toEqual({ a: 1, edge: 1, shows200: 1, shows199: 2 });
  });

  it("follows the top score up into a higher bracket", () => {
    const rows = [prospect("a", "A", 1, scores(2.6)), prospect("b", "B", 2, scores(2.2))];
    expect(tierOf(rows)).toEqual({ a: 1, b: 3 }); // T1 +2.50 to +2.75; +2.00 to +2.25 is T3
  });

  it("carries on below zero", () => {
    const rows = [prospect("a", "A", 1, scores(0.1)), prospect("b", "B", 2, scores(-0.1)), prospect("c", "C", 3, scores(-0.25))];
    expect(tierOf(rows)).toEqual({ a: 1, b: 2, c: 2 });
    expect(tierRangeLabel(draftBoardTiers(rows, false).get("b")!)).toBe("−0.25 to +0.00");
  });

  it("reads Dynasty before the draft and Dynasty+ after; no score, no tier", () => {
    const rows = [
      prospect("a", "A", 1, scores(1.1, undefined, 2.3)),
      prospect("b", "B", 2, scores(2.1, undefined, null)),
      prospect("c", "C", 3, scores(null)),
      prospect("d", "D", 4, null),
    ];
    expect(tierOf(rows, false)).toEqual({ a: 5, b: 1, c: null, d: null });
    expect(tierOf(rows, true)).toEqual({ a: 1, b: null, c: null, d: null });
    expect(tierScore(rows[0], true)).toBe(2.3);
    expect(draftBoardTiers([prospect("d", "D", 1, null)], false).size).toBe(0);
  });

  it("labels a bracket", () => {
    expect(tierRangeLabel({ low: 1.75, high: 2 })).toBe("+1.75 to +2.00");
  });
});

describe("readNotes", () => {
  it("keeps only non-empty notes", () => {
    expect(readNotes({ a: "fast", b: "  ", c: 4 })).toEqual({ a: "fast" });
  });

  it("reads anything else as empty", () => {
    expect(readNotes("x")).toEqual({});
  });
});

describe("live draft (Stage 4)", () => {
  const pool = (player_id: string | null, name: string, extra: Partial<RookieBoardPlayer> = {}): RookieBoardPlayer => ({
    player_id, name, position: "WR", team: "", adp: Number.MAX_SAFE_INTEGER, fcValue: 0, ...extra,
  });

  it("draftBoardRookies keeps board order and takes the pool's id, team, ADP and FC by name", () => {
    const board = [
      prospect("a", "Jeremiah Smith", 1),
      prospect("b", "Ryan Williams Jr.", 2, null, { draft_team: "NYJ" }),
      prospect("c", "Nobody Listed", null),
    ];
    const out = draftBoardRookies(board, [pool("9001", "Ryan Williams", { team: "", adp: 3.5, fcValue: 6000 }), pool("9000", "Jeremiah Smith", { team: "CLE", adp: 1.2, fcValue: 8000 })]);
    expect(out.map((r) => [r.player_id, r.name, r.team, r.adp, r.fcValue, r.boardRank])).toEqual([
      ["9000", "Jeremiah Smith", "CLE", 1.2, 8000, 1],
      ["9001", "Ryan Williams Jr.", "NYJ", 3.5, 6000, 2],
      [null, "Nobody Listed", "", Number.MAX_SAFE_INTEGER, 0, 3],
    ]);
  });

  it("unionRookies appends only rookies not already listed, by id or name", () => {
    const first = [pool("1", "Al One"), pool(null, "Bo Two")];
    const rest = [pool("1", "Al One Renamed"), pool("2", "Bo Two Jr."), pool("3", "Cy Three")];
    expect(unionRookies(first, rest).map((r) => r.name)).toEqual(["Al One", "Bo Two", "Cy Three"]);
  });

  it("sameRookie and isDraftedRookie match by Sleeper id or normalized name", () => {
    expect(sameRookie(pool("1", "A"), pool("1", "B"))).toBe(true);
    expect(sameRookie(pool(null, "Omar Cooper"), pool("7", "Omar Cooper Jr."))).toBe(true);
    expect(sameRookie(pool("1", "A"), pool("2", "B"))).toBe(false);
    const drafted = new Set(["42", `name:${normalizeRookieName("Omar Cooper")}`]);
    expect(isDraftedRookie(pool("42", "X"), drafted)).toBe(true);
    expect(isDraftedRookie(pool(null, "Omar Cooper Jr."), drafted)).toBe(true);
    expect(isDraftedRookie(pool("43", "Y"), drafted)).toBe(false);
  });
});
