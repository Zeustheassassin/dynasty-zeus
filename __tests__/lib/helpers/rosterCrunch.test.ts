import { describe, expect, it } from "vitest";
import {
  DANGER_CUSHION,
  getDangerIdsByLeague,
  getRosterCrunch,
  playersHaveValues,
  withDangerTags,
} from "../../../lib/helpers/rosterCrunch";
import { ownedPicksByRound } from "../../../lib/helpers/picks";
import { CURRENT_YEAR } from "../../../lib/helpers/season";
import type {
  LeagueAssetDispositions,
  LeagueOverviewEntry,
  SleeperDraft,
  SleeperLeague,
  SleeperPlayer,
  SleeperRoster,
  SleeperTradedPick,
} from "../../../lib/types";

// The pick window starts at the real current season, so these stay relative to it: this season's
// rookie draft is done, which makes next season's the next one.
const SEASON = CURRENT_YEAR;
const NEXT_SEASON = String(Number(CURRENT_YEAR) + 1);
const DRAFTS = [{ season: SEASON, status: "complete", settings: { rounds: 4 } }] as unknown as SleeperDraft[];

const player = (id: string, value: number, years_exp = 5, position = "WR") =>
  ({ player_id: id, full_name: id, position, value, years_exp }) as unknown as SleeperPlayer;

/** n players named `${prefix}1..n`, worth 100 per position in the list. */
const squad = (prefix: string, n: number, years_exp = 5): SleeperPlayer[] =>
  Array.from({ length: n }, (_, i) => player(`${prefix}${i + 1}`, (i + 1) * 100, years_exp));

const mapOf = (...lists: SleeperPlayer[][]): Record<string, SleeperPlayer> =>
  Object.fromEntries(lists.flat().map((p) => [p.player_id, p]));

const ids = (list: SleeperPlayer[]) => list.map((p) => p.player_id);

// FantasyCalc's own baseline scoring, so every position multiplier is 1 unless a test says otherwise.
const BASELINE_SCORING = { rec: 1, pass_td: 4 };

const leagueWith = (
  activeCap: number,
  settings: Partial<SleeperLeague["settings"]> = {},
  scoring_settings: Record<string, number> = BASELINE_SCORING
): Pick<SleeperLeague, "roster_positions" | "settings" | "scoring_settings"> => ({
  roster_positions: Array(activeCap).fill("BN"),
  scoring_settings,
  settings: { taxi_slots: 4, reserve_slots: 3, taxi_years: 2, taxi_allow_vets: 1, draft_rounds: 4, ...settings } as SleeperLeague["settings"],
});

const rosterOf = (active: SleeperPlayer[], ir: SleeperPlayer[], taxi: SleeperPlayer[], roster_id = 1) => ({
  roster_id,
  players: [...ids(active), ...ids(ir), ...ids(taxi)],
  reserve: ids(ir),
  taxi: ids(taxi),
});

const traded = (round: number, roster_id: number, owner_id: number, season = NEXT_SEASON) =>
  ({ season, round, roster_id, owner_id, previous_owner_id: roster_id }) as SleeperTradedPick;

const ROSTERS = Array.from({ length: 12 }, (_, i) => ({ roster_id: i + 1 }));

const crunchOf = (
  league: Pick<SleeperLeague, "roster_positions" | "settings" | "scoring_settings">,
  roster: ReturnType<typeof rosterOf>,
  players: Record<string, SleeperPlayer>,
  tradedPicks: SleeperTradedPick[] = []
) => getRosterCrunch(league, roster, ROSTERS, tradedPicks, DRAFTS, players, SEASON);

/** Makes roster 1 own exactly `want` picks per round: extras come from other teams' picks, and its
 *  own pick is traded away in a round it should own 0 of. */
const picksOwned = (want: number[]): SleeperTradedPick[] =>
  want.flatMap((count, i) => {
    const round = i + 1;
    if (count === 0) return [traded(round, 1, 2)];
    return Array.from({ length: count - 1 }, (_, n) => traded(round, n + 2, 1));
  });

describe("ownedPicksByRound", () => {
  it("counts your own picks, picks traded in and picks traded away", () => {
    const tradedPicks = [traded(1, 2, 1), traded(1, 3, 1), traded(2, 1, 5), traded(3, 4, 1), traded(3, 1, 4)];
    expect(ownedPicksByRound(ROSTERS, tradedPicks, NEXT_SEASON, 4, 1)).toEqual([3, 0, 1, 1]);
  });

  it("ignores other seasons", () => {
    expect(ownedPicksByRound(ROSTERS, [traded(1, 1, 2, String(Number(NEXT_SEASON) + 1))], NEXT_SEASON, 4, 1)).toEqual([1, 1, 1, 1]);
  });

  it("counts a 5th round when the league drafts one", () => {
    expect(ownedPicksByRound(ROSTERS, [traded(5, 2, 1)], NEXT_SEASON, 5, 1)).toEqual([1, 1, 1, 1, 2]);
  });

  it("a pick traded back to its original owner counts as theirs", () => {
    expect(ownedPicksByRound(ROSTERS, [traded(1, 1, 1)], NEXT_SEASON, 4, 1)).toEqual([1, 1, 1, 1]);
  });
});

describe("getRosterCrunch: the count", () => {
  // The user's example: 26 active, 3 IR, 4 taxi and 8 picks means 11 to cut, 13 listed.
  const active = squad("a", 26);
  const ir = squad("i", 3);
  const taxi = squad("t", 4, 0);
  const players = mapOf(active, ir, taxi);
  const roster = rosterOf(active, ir, taxi);
  const eightPicks = picksOwned([2, 2, 1, 3]);

  it("3 players over from IR alone, before any picks", () => {
    const noPicks = [1, 2, 3, 4].map((round) => traded(round, 1, 2));
    expect(crunchOf(leagueWith(26), roster, players, noPicks).mustCut).toBe(3);
  });

  it("11 to cut with 8 picks, and lists 13", () => {
    const crunch = crunchOf(leagueWith(26), roster, players, eightPicks);
    expect(crunch.picksByRound).toEqual([2, 2, 1, 3]);
    expect(crunch.picks).toBe(8);
    expect(crunch.draftSeason).toBe(NEXT_SEASON);
    expect(crunch.mustCut).toBe(11);
    expect(crunch.danger).toHaveLength(11 + DANGER_CUSHION);
    expect(crunch.waiverRoomCut).toBe(0);
  });

  it("an open active spot lowers the count by one", () => {
    const roomy = rosterOf(active.slice(1), ir, taxi);
    expect(crunchOf(leagueWith(26), roomy, players, eightPicks).mustCut).toBe(10);
  });

  it("uses players actually on IR, not the IR spots", () => {
    const oneOnIr = rosterOf(active, ir.slice(0, 1), taxi);
    expect(crunchOf(leagueWith(26), oneOnIr, players, eightPicks).mustCut).toBe(9);
  });

  it("never goes below 0, and still lists the 2 extra names", () => {
    const small = rosterOf(active.slice(0, 10), [], taxi);
    const crunch = crunchOf(leagueWith(26), small, players);
    expect(crunch.mustCut).toBe(0);
    expect(crunch.danger).toHaveLength(DANGER_CUSHION);
    expect(crunch.danger.every((d) => d.cushion)).toBe(true);
  });

  it("gives one picksByRound entry per round the league drafts", () => {
    expect(crunchOf(leagueWith(26, { draft_rounds: 5 }), roster, players).picksByRound).toHaveLength(5);
    expect(crunchOf(leagueWith(26, { draft_rounds: 3 }), roster, players).picksByRound).toHaveLength(3);
  });

  it("works with no taxi at all", () => {
    const crunch = crunchOf(leagueWith(26, { taxi_slots: 0 }), rosterOf(active, ir, []), players, eightPicks);
    expect(crunch.taxiShort).toBe(0);
    expect(crunch.mustCut).toBe(3 + 8);
  });
});

describe("getRosterCrunch: who can be on taxi next season", () => {
  const active = squad("a", 26);
  const ir = squad("i", 3);
  const twoPicks = picksOwned([1, 1, 0, 0]);

  it("rookies-only: this year's rookies stay inside the limit, so 2 picks don't leave taxi short", () => {
    const taxi = squad("t", 4, 0);
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 0, taxi_years: 1 }),
      rosterOf(active, ir, taxi), mapOf(active, ir, taxi), twoPicks
    );
    expect(crunch.rookiesOnly).toBe(true);
    expect(crunch.taxiAgingOff).toEqual([]);
    expect(crunch.taxiShort).toBe(0);
    expect(crunch.mustCut).toBe(5);
  });

  it("rookies-only, everyone ages off, 2 picks and 4 spots: one extra cut for waiver room", () => {
    // 26 + 3 + 4 + 2 = 35. Taxi holds only the 2 new rookies, so 26 + 2 = 28 fit and 7 go. The user's
    // 1 extra makes it 8: an open active spot to bring in a free agent rookie for taxi.
    const taxi = squad("t", 4, 1);
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 0, taxi_years: 1 }),
      rosterOf(active, ir, taxi), mapOf(active, ir, taxi), twoPicks
    );
    expect(crunch.taxiAgingOff).toEqual(ids(taxi));
    expect(crunch.taxiFillable).toBe(2);
    expect(crunch.taxiShort).toBe(2);
    expect(crunch.waiverRoomCut).toBe(1);
    expect(crunch.mustCut).toBe(8);
  });

  it("buying enough picks removes the extra cut", () => {
    const taxi = squad("t", 4, 1);
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 0, taxi_years: 1 }),
      rosterOf(active, ir, taxi), mapOf(active, ir, taxi), picksOwned([1, 1, 1, 1])
    );
    expect(crunch.taxiShort).toBe(0);
    expect(crunch.waiverRoomCut).toBe(0);
    expect(crunch.mustCut).toBe(26 + 3 + 4 + 4 - 26 - 4);
  });

  it("rookies-only: a second-year player on the active roster can't go down", () => {
    const youngActive = squad("y", 26, 0);
    const taxi = squad("t", 4, 1);
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 0, taxi_years: 1 }),
      rosterOf(youngActive, ir, taxi), mapOf(youngActive, ir, taxi), twoPicks
    );
    expect(crunch.taxiFillable).toBe(2);
  });

  it("rookies-only with a 2-year limit keeps a second-year player one more season", () => {
    const taxi = squad("t", 4, 1);
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 0, taxi_years: 2 }),
      rosterOf(active, ir, taxi), mapOf(active, ir, taxi), twoPicks
    );
    expect(crunch.taxiAgingOff).toEqual([]);
    expect(crunch.taxiFillable).toBe(4);
  });

  it("No Max: nobody ages off", () => {
    const taxi = squad("t", 4, 12);
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 0, taxi_years: 0 }),
      rosterOf(active, ir, taxi), mapOf(active, ir, taxi), twoPicks
    );
    expect(crunch.taxiYearsLimit).toBe(0);
    expect(crunch.taxiAgingOff).toEqual([]);
    expect(crunch.taxiShort).toBe(0);
  });

  it("non-rookies allowed: someone young enough on the roster can fill taxi", () => {
    const mixed = [...squad("y", 2, 0), ...squad("a", 24, 5)];
    const taxi = squad("t", 4, 2);
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 1, taxi_years: 2 }),
      rosterOf(mixed, ir, taxi), mapOf(mixed, ir, taxi), [1, 2, 3, 4].map((round) => traded(round, 1, 2))
    );
    expect(crunch.rookiesOnly).toBe(false);
    expect(crunch.taxiAgingOff).toEqual(ids(taxi));
    expect(crunch.taxiFillable).toBe(2);
    expect(crunch.taxiShort).toBe(2);
  });

  it("non-rookies allowed with No Max: taxi always fills", () => {
    const taxi = squad("t", 1, 9);
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 1, taxi_years: 0 }),
      rosterOf(active, ir, taxi), mapOf(active, ir, taxi), [1, 2, 3, 4].map((round) => traded(round, 1, 2))
    );
    expect(crunch.taxiFillable).toBe(4);
    expect(crunch.taxiShort).toBe(0);
  });

  it("no extra cut when a spot is already going to be open", () => {
    const small = squad("a", 20);
    const taxi = squad("t", 4, 1);
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 0, taxi_years: 1 }),
      rosterOf(small, [], taxi), mapOf(small, taxi), twoPicks
    );
    expect(crunch.taxiShort).toBe(2);
    expect(crunch.waiverRoomCut).toBe(0);
    expect(crunch.mustCut).toBe(0);
  });

  it("the extra cut applies when the roster would otherwise just fit", () => {
    const exact = squad("a", 22);
    const taxi = squad("t", 4, 1);
    // 22 + 4 + 2 picks = 28; 26 active + 2 taxi = 28, so nobody has to go without the waiver spot.
    const crunch = crunchOf(
      leagueWith(26, { taxi_allow_vets: 0, taxi_years: 1 }),
      rosterOf(exact, [], taxi), mapOf(exact, taxi), twoPicks
    );
    expect(crunch.waiverRoomCut).toBe(1);
    expect(crunch.mustCut).toBe(1);
  });

  it("doesn't look a year ahead once the draft is in the current season", () => {
    const taxi = squad("t", 4, 1);
    const drafts = [{ season: SEASON, status: "pre_draft", settings: { rounds: 4 } }] as unknown as SleeperDraft[];
    const crunch = getRosterCrunch(
      leagueWith(26, { taxi_allow_vets: 0, taxi_years: 1 }),
      rosterOf(active, ir, taxi), ROSTERS, [], drafts, mapOf(active, ir, taxi), SEASON
    );
    expect(crunch.draftSeason).toBe(SEASON);
    expect(crunch.taxiAgingOff).toEqual([]);
  });
});

describe("getRosterCrunch: the danger list", () => {
  it("is lowest value first across active, IR and taxi, with the last 2 as the cushion", () => {
    const active = [player("high", 5000), player("mid", 1000), player("zero", 0)];
    const ir = [player("hurt", 500)];
    const taxi = [player("stash", 300, 0)];
    const crunch = crunchOf(leagueWith(2, { taxi_slots: 1 }), rosterOf(active, ir, taxi), mapOf(active, ir, taxi), [1, 2, 3, 4].map((round) => traded(round, 1, 2)));
    // 5 players against 2 active + 1 taxi = 2 to cut.
    expect(crunch.mustCut).toBe(2);
    expect(crunch.danger.map((d) => d.playerId)).toEqual(["zero", "stash", "hurt", "mid"]);
    expect(crunch.danger.map((d) => d.where)).toEqual(["ACTIVE", "TAXI", "IR", "ACTIVE"]);
    expect(crunch.danger.map((d) => d.cushion)).toEqual([false, false, true, true]);
  });

  it("breaks ties by name", () => {
    const active = [player("zed", 100), player("amy", 100), player("bob", 100)];
    const crunch = crunchOf(leagueWith(3, { taxi_slots: 0 }), rosterOf(active, [], []), mapOf(active), [1, 2, 3, 4].map((round) => traded(round, 1, 2)));
    expect(crunch.danger.map((d) => d.playerId)).toEqual(["amy", "bob"]);
  });

  it("ranks by the league's scoring: a TE premium lifts a tight end past a cheaper receiver", () => {
    const active = [player("te", 950, 5, "TE"), player("wr", 1000), player("keep", 9000)];
    const noPicks = [1, 2, 3, 4].map((round) => traded(round, 1, 2));
    const plain = crunchOf(leagueWith(3, { taxi_slots: 0 }), rosterOf(active, [], []), mapOf(active), noPicks);
    expect(plain.danger.map((d) => d.playerId)).toEqual(["te", "wr"]);
    expect(plain.danger[0].value).toBe(950);
    const tep = crunchOf(
      leagueWith(3, { taxi_slots: 0 }, { ...BASELINE_SCORING, bonus_rec_te: 0.5 }),
      rosterOf(active, [], []), mapOf(active), noPicks
    );
    expect(tep.danger.map((d) => d.playerId)).toEqual(["wr", "te"]);
    expect(tep.danger[1].value).toBe(Math.round(950 * (1 + (0.5 * 55) / 260)));
  });

  it("counts a kicker as a body but doesn't list him", () => {
    const active = [player("kick", 0, 5, "K"), player("cheap", 100), player("dear", 900)];
    const crunch = crunchOf(leagueWith(2, { taxi_slots: 0 }), rosterOf(active, [], []), mapOf(active), [1, 2, 3, 4].map((round) => traded(round, 1, 2)));
    expect(crunch.mustCut).toBe(1);
    expect(crunch.danger.map((d) => d.playerId)).toEqual(["cheap", "dear"]);
  });
});

describe("playersHaveValues", () => {
  it("is false until a value has merged in", () => {
    expect(playersHaveValues({})).toBe(false);
    expect(playersHaveValues({ a: player("a", 0) })).toBe(false);
    expect(playersHaveValues({ a: player("a", 0), b: player("b", 1) })).toBe(true);
  });
});

describe("getDangerIdsByLeague", () => {
  const active = [player("b", 200), player("a", 100), player("c", 300)];
  const players = mapOf(active);
  const entry = (overrides: Partial<LeagueOverviewEntry> = {}): LeagueOverviewEntry => ({
    league: leagueWith(3, { taxi_slots: 0 }) as SleeperLeague,
    rosters: [{ ...rosterOf(active, [], []), owner_id: "me" } as unknown as SleeperRoster],
    picks: [],
    userMap: {},
    tradedPicks: [1, 2, 3, 4].map((round) => traded(round, 1, 2)),
    drafts: DRAFTS,
    ...overrides,
  });

  it("gives each league's list as sorted ids", () => {
    // 3 fit, nobody has to go, so just the 2 extra names: a (100) and b (200).
    expect(getDangerIdsByLeague({ L1: entry() }, "me", players)).toEqual({ L1: ["a", "b"] });
  });

  it("is empty before values load, or without a user", () => {
    const noValues = mapOf([player("a", 0), player("b", 0), player("c", 0)]);
    expect(getDangerIdsByLeague({ L1: entry() }, "me", noValues)).toEqual({});
    expect(getDangerIdsByLeague({ L1: entry() }, null, players)).toEqual({});
  });

  it("skips a league the user has no roster in, or missing its pick data", () => {
    expect(getDangerIdsByLeague({ L1: entry() }, "someone-else", players)).toEqual({});
    expect(getDangerIdsByLeague({ L1: entry({ tradedPicks: undefined }) }, "me", players)).toEqual({});
  });
});

describe("withDangerTags", () => {
  const tags: LeagueAssetDispositions = {
    L1: { core: "CORE", pricey: "PRICEY", shop: "SHOPPING", legacy: "WANT_TO_TRADE", off: "OFFLOAD", safe: "CORE", "x::2": "SELL_NO" },
    L2: { core: "CORE" },
  };

  it("lays Danger over Core, Pricey and untagged players", () => {
    const out = withDangerTags(tags, { L1: ["core", "pricey", "plain"] });
    expect(out.L1.core).toBe("DANGER");
    expect(out.L1.pricey).toBe("DANGER");
    expect(out.L1.plain).toBe("DANGER");
  });

  it("leaves Shopping and Offload alone, they already say sell", () => {
    const out = withDangerTags(tags, { L1: ["shop", "legacy", "off"] });
    expect(out).toBe(tags);
  });

  it("only touches the listed league and players", () => {
    const out = withDangerTags(tags, { L1: ["core"] });
    expect(out.L1.safe).toBe("CORE");
    expect(out.L1["x::2"]).toBe("SELL_NO");
    expect(out.L2).toBe(tags.L2);
  });

  it("never changes the stored map, so a real tag is back once a player is off the list", () => {
    const stored = JSON.parse(JSON.stringify(tags));
    withDangerTags(tags, { L1: ["core", "plain"] });
    expect(tags).toEqual(stored);
    expect(withDangerTags(tags, { L1: [] }).L1.core).toBe("CORE");
  });

  it("returns the same map when nothing is listed", () => {
    expect(withDangerTags(tags, {})).toBe(tags);
  });

  it("adds a league that has no tags yet", () => {
    expect(withDangerTags(tags, { L3: ["plain"] }).L3).toEqual({ plain: "DANGER" });
  });
});
