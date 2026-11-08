import { describe, it, expect } from "vitest";
import {
  buildPublicRoster,
  fcValuesBySleeperId,
  publicTeamName,
  type BuildPublicRosterInput,
} from "@/lib/helpers/publicRoster";
import { CURRENT_YEAR } from "@/lib/helpers/season";
import type { SleeperLeague, SleeperRoster, SleeperUser, SleeperTradedPick, SleeperDraft } from "@/lib/types";

const CY = CURRENT_YEAR;
const NY = String(Number(CY) + 1);
const NNY = String(Number(CY) + 2);

const league = {
  league_id: "L1",
  name: "Zeus League",
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN"],
  // FC baseline except a 0.5 TE premium → TE values scale by 1 + 0.5*55/260; every other position by 1.
  scoring_settings: { rec: 1, pass_td: 4, bonus_rec_te: 0.5 },
} as unknown as SleeperLeague;

const roster = (roster_id: number, owner_id: string, players: string[], extra: Partial<SleeperRoster> = {}) =>
  ({ roster_id, owner_id, players, starters: [], reserve: null, taxi: null, settings: {}, ...extra }) as unknown as SleeperRoster;

const rosters: SleeperRoster[] = [
  roster(1, "u1", ["q1", "q2", "r1", "r2", "r3", "w1", "t1", "k1", "x9"], {
    starters: ["q1", "w1", "t1", "0"],
    taxi: ["r1"],
    reserve: ["r2"],
  }),
  roster(2, "u2", ["q3"]),
  roster(3, "u3", []),
];

const users = [
  { user_id: "u1", display_name: "Zeus", metadata: { team_name: "Zeus Dynasty" } },
  { user_id: "u2", display_name: "Bob" },
  { user_id: "u3", display_name: "Carol" },
] as unknown as SleeperUser[];

const players: BuildPublicRosterInput["players"] = {
  q1: { full_name: "Joe Starter", position: "QB", age: 27 },
  q2: { full_name: "Jim Bench", position: "QB", age: 30 },
  q3: { full_name: "Other Qb", position: "QB", age: 25 },
  r1: { full_name: "Taxi Back", position: "RB", age: 21 },
  r2: { full_name: "Hurt Back", position: "RB", age: 26 },
  r3: { full_name: "No Value", position: "RB", age: null },
  w1: { full_name: "Wide Out", position: "WR", age: 24 },
  t1: { full_name: "Tight End", position: "TE", age: 25 },
  k1: { full_name: "Kicker Guy", position: "K", age: 33 },
};

const fcValues = { q1: 5000, q2: 7000, q3: 20000, r1: 3000, r2: 2000, w1: 4000, t1: 1000, k1: 50 };

const tradedPicks = [
  { season: NY, round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 },  // acquired Bob's next-year 1st
  { season: NNY, round: 2, roster_id: 1, owner_id: 3, previous_owner_id: 1 }, // traded own 2nd away
  { season: CY, round: 1, roster_id: 3, owner_id: 1, previous_owner_id: 3 },  // acquired Carol's current 1st
] as unknown as SleeperTradedPick[];

// Current-season rookie draft not run yet; Zeus and Bob have a draft slot, Carol doesn't.
const drafts = [
  { season: CY, status: "pre_draft", type: "linear", settings: { rounds: 4 }, draft_order: { u1: 2, u2: 1 } },
] as unknown as SleeperDraft[];

const input: BuildPublicRosterInput = { league, rosters, users, tradedPicks, drafts, players, fcValues, rosterId: 1 };

describe("buildPublicRoster", () => {
  const view = buildPublicRoster(input)!;
  const col = (pos: string) => view.columns.find((c) => c.pos === pos)!;

  it("names the team, owner, league and lineup", () => {
    expect(view.teamName).toBe("Zeus Dynasty");
    expect(view.ownerName).toBe("Zeus");
    expect(view.leagueName).toBe("Zeus League");
    expect(view.lineup).toBe("QB 1 • RB 2 • WR 2 • TE 1 • FLEX 1 • SFLEX 1");
    expect(view.teamCount).toBe(3);
  });

  it("orders each position by value, not by starter/bench", () => {
    expect(col("QB").players.map((p) => p.name)).toEqual(["Jim Bench", "Joe Starter"]);
    expect(col("RB").players.map((p) => p.name)).toEqual(["Taxi Back", "Hurt Back", "No Value"]);
  });

  it("labels Starter, Bench, Taxi and IR", () => {
    expect(col("QB").players.map((p) => p.role)).toEqual(["Bench", "Starter"]);
    expect(col("RB").players.map((p) => p.role)).toEqual(["Taxi", "IR", "Bench"]);
  });

  it("only shows QB/RB/WR/TE players that are in the player map", () => {
    expect(view.columns.map((c) => c.pos)).toEqual(["QB", "RB", "WR", "TE"]);
    const names = view.columns.flatMap((c) => c.players.map((p) => p.name));
    expect(names).not.toContain("Kicker Guy");
    expect(names).toHaveLength(7);
  });

  it("applies the league's scoring to values (TE premium)", () => {
    expect(col("TE").players[0].value).toBe(Math.round(1000 * (1 + (0.5 * 55) / 260)));
    expect(col("WR").players[0].value).toBe(4000);
    expect(col("RB").players[2].value).toBe(0);
  });

  it("totals value, averages known ages, and ranks each position against the league", () => {
    expect(col("QB").totalValue).toBe(12000);
    expect(col("QB").avgAge).toBe(28.5);
    expect(col("RB").avgAge).toBe(23.5); // the player with no age is left out
    expect(col("QB").rank).toBe(2); // Bob's 20,000 QB room is first
    expect(col("RB").rank).toBe(1);
  });

  it("lists owned picks by year: own vs acquired, traded-away picks gone", () => {
    expect(view.picksByYear.map((g) => g.year)).toEqual([CY, NY, NNY]);
    const [cy, ny, nny] = view.picksByYear;
    expect(cy.picks.map((p) => [p.label, p.fromName])).toEqual([
      ["1.02", null],
      ["1st", "Carol"], // no draft slot for Carol yet, so no made-up "1.03"
      ["2.02", null],
      ["3.02", null],
      ["4.02", null],
    ]);
    expect(ny.picks.map((p) => [p.label, p.fromName])).toEqual([
      ["1st", null], ["1st", "Bob"], ["2nd", null], ["3rd", null], ["4th", null],
    ]);
    expect(nny.picks.map((p) => p.label)).toEqual(["1st", "3rd", "4th"]);
    expect(view.pickCount).toBe(13);
  });

  it("returns null for a roster id the league doesn't have", () => {
    expect(buildPublicRoster({ ...input, rosterId: 99 })).toBeNull();
  });
});

describe("fcValuesBySleeperId", () => {
  it("keys values by Sleeper id and drops entries without one", () => {
    const raw = [
      { player: { sleeperId: "123" }, value: 5000 },
      { player: { sleeperId: 456 }, value: 300 },
      { player: { name: "2027 1st" }, value: 4000 },
      { player: { sleeperId: "789" } },
    ];
    expect(fcValuesBySleeperId(raw)).toEqual({ "123": 5000, "456": 300 });
  });

  it("returns an empty map for a non-array body", () => {
    expect(fcValuesBySleeperId({ error: "x" })).toEqual({});
  });
});

describe("publicTeamName", () => {
  const r = roster(4, "u9", []);
  it("prefers the owner's team name, then their display name, then the roster number", () => {
    expect(publicTeamName(r, { display_name: "Al", metadata: { team_name: "Al's Army" } } as unknown as SleeperUser)).toBe("Al's Army");
    expect(publicTeamName(r, { display_name: "Al" } as unknown as SleeperUser)).toBe("Al");
    expect(publicTeamName(r, undefined)).toBe("Team 4");
  });
});
