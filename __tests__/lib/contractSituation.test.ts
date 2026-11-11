// contractSituation: the joined contract picture (stages 3–6) and the user's
// stays / goes calls on top of it (contracts plan stage 7).

import { describe, it, expect } from "vitest";
import {
  buildContractSituation, callFor, contractChip, contractPathHint, coreWith, latestNflSeason, overrideFor, pressureRank,
  roomOpenWith, sameName, situationSeason, standingsFromEspn, CLOSES_RANK,
  type ContractSituationResponse, type PlayerSituation, type SituationInput, type TeamSituation,
} from "@/lib/contractSituation";
import { draftCapital, parseDraftTrades } from "@/lib/nflDraftPicks";
import type { ContractSeason, NflContractRow } from "@/lib/nflContracts";
import type { PffOffenseRow } from "@/lib/nflRooms";

const NOV_2026 = new Date("2026-11-11T12:00:00Z");
const GB = 9;

const line = (year: number, base: number, pror = 0, g = 0): ContractSeason => ({
  year, team: "Packers", base_salary: base, prorated_bonus: pror, option_bonus: 0, roster_bonus: 0, guaranteed_salary: g,
  cap_number: base + pror, cap_percent: null, cash_paid: base, workout_bonus: 0, per_game_roster_bonus: 0, other_bonus: null,
});
let nextId = 1;
const row = (extra: Partial<NflContractRow>): NflContractRow => ({
  otc_id: nextId++, gsis_id: null, sleeper_id: null, player: `P${nextId}`, position: "WR", team: "Packers", is_active: true,
  contract_type: "UFA", year_signed: 2025, years: 3, value: 3, apy: 1, guaranteed: 0, apy_cap_pct: 0.004,
  draft_year: 2018, draft_round: 4, draft_overall: 120, seasons: [], source_updated_at: "2026-11-10T15:31:04.000Z",
  refreshed_at: "2026-11-11T00:00:00Z", ...extra,
});

// The Packers' WRs: a star signed long with 2027 guaranteed, an expiring young starter, an old depth WR whose
// 2027 release saves $12M for $1M dead.
const star = row({ player: "Long Star", sleeper_id: "s1", gsis_id: "g1", contract_type: "Extension", apy: 30, apy_cap_pct: 0.1, draft_round: 1, draft_year: 2020,
  seasons: [line(2026, 10, 5, 10), line(2027, 20, 5, 20), line(2028, 25, 5), line(2029, 25, 5)] });
const expiring = row({ player: "Young Starter", sleeper_id: "s2", gsis_id: "g2", contract_type: "Drafted", draft_year: 2023, draft_round: 4, seasons: [line(2026, 1.2)] });
const old = row({ player: "Old Depth", sleeper_id: "s3", gsis_id: "g3", apy: 6, apy_cap_pct: 0.02, seasons: [line(2026, 5, 1), line(2027, 12, 1)] });
const noSleeper = row({ player: "Unmapped", position: "TE", seasons: [line(2026, 1), line(2027, 1)] });
const ROWS = [star, expiring, old, noSleeper];

const input = (extra: Partial<SituationInput> = {}): SituationInput => ({
  now: NOV_2026,
  rows: ROWS,
  sleeper: new Map([
    ["s1", { team: "GB", depthOrder: 2, birthDate: "1999-05-01" }],
    ["s2", { team: "GB", depthOrder: 1, birthDate: "2001-03-01" }],
    ["s3", { team: "GB", depthOrder: 4, birthDate: "1994-01-01" }],
  ]),
  crosswalk: new Map(),
  pff: null,
  records: [{ teamId: GB, winPct: 0.667, pointDiff: 40, gamesPlayed: 9 }],
  capital: new Map([[2027, draftCapital(parseDraftTrades("", 2027))], [2028, null]]),
  ...extra,
});

describe("seasons", () => {
  it("looks at the next draft's class season; the latest NFL season turns over in September", () => {
    expect(situationSeason(NOV_2026)).toBe(2027);
    expect(situationSeason(new Date("2027-04-20T00:00:00Z"))).toBe(2027);
    expect(situationSeason(new Date("2027-05-02T00:00:00Z"))).toBe(2028);
    expect(latestNflSeason(NOV_2026)).toBe(2026);
    expect(latestNflSeason(new Date("2027-03-01T00:00:00Z"))).toBe(2026);
  });
});

describe("standingsFromEspn", () => {
  it("reads win percentage, point differential and games by ESPN id, skipping unknown teams", () => {
    const stats = (w: number, l: number, t: number, pct: number, pd: number) => [
      { name: "wins", value: w }, { name: "losses", value: l }, { name: "ties", value: t }, { name: "winPercent", value: pct }, { name: "pointDifferential", value: pd },
    ];
    const body = { children: [
      { standings: { entries: [{ team: { id: "2" }, stats: stats(7, 1, 0, 0.875, 69) }, { team: { id: "99" }, stats: stats(1, 1, 0, 0.5, 0) }] } },
      { standings: { entries: [{ team: { id: "9" }, stats: stats(6, 2, 1, 0.722, 40) }] } },
    ] };
    expect(standingsFromEspn(body)).toEqual([
      { teamId: 2, winPct: 0.875, pointDiff: 69, gamesPlayed: 8 },
      { teamId: 9, winPct: 0.722, pointDiff: 40, gamesPlayed: 9 },
    ]);
    expect(standingsFromEspn(null)).toEqual([]);
  });
});

describe("buildContractSituation", () => {
  const s = buildContractSituation(input());
  const p = (r: NflContractRow) => s.players[r.otc_id];

  it("judges every skill player on an active deal for the coming season, keyed by OTC id and Sleeper id", () => {
    expect(s.season).toBe(2027);
    expect(Object.keys(s.players)).toHaveLength(4);
    expect(s.bySleeper).toEqual({ s1: star.otc_id, s2: expiring.otc_id, s3: old.otc_id });
    expect(p(star)).toMatchObject({ teamId: GB, pos: "WR", endYear: 2029, invested: true, guaranteedThrough: 2027, capHit: 25 });
    expect(p(expiring)).toMatchObject({ endYear: 2026, freeAgency: "UFA", cut: null, stay: { call: "stays" }, core: true });
    expect(p(old).cut).toMatchObject({ level: "likely", savings: 12, deadMoney: 1 });
    expect(p(old)).toMatchObject({ importance: "depth", core: false });
    expect(p(old).age).toBeCloseTo(33.7, 1);
  });

  it("gives each room its contract-only and expected open spots and its competition odds", () => {
    const wr = s.teams.find((t) => t.teamId === GB)!.rooms.WR;
    expect(wr.outlook[0]).toMatchObject({ year: 2027, invested: 1, openSpots: 2 });
    expect(wr).toMatchObject({ expectedCore: 2, openSpots: 1 });
    expect(wr.pressure.picks).toEqual([1, 2, 4]);
    expect(wr.pressure.day12).toBeGreaterThan(0);
    expect(s.teams.find((t) => t.teamId === GB)!.picks).toEqual([{ year: 2027, byRound: [1, 1, 1, 1, 1, 1, 1], byDay: [1, 2, 4], conditional: 0 }]);
    expect(s.teams).toHaveLength(32);
  });

  it("notes what it couldn't read", () => {
    expect(s.notes.join(" ")).toMatch(/PFF wasn't read/);
    const bare = buildContractSituation(input({ records: [], capital: new Map() }));
    expect(bare.notes.join(" ")).toMatch(/standings weren't read/);
    expect(bare.notes.join(" ")).toMatch(/2027 draft page wasn't read/);
    expect(bare.teams.find((t) => t.teamId === GB)!.rooms.WR.pressure.day12).toBeNull();
  });

  it("reads PFF lines through the crosswalk: games played drive the missed-time rule", () => {
    const regulars: PffOffenseRow[] = [100, 101, 102, 103, 104].map((id, i) => ({ player_id: id, franchise_id: 50 + i, position: "WR", grades_offense: 60 + i * 5, snap_counts_total: 900, player_game_count: 9 }));
    const pffRows = (games: number): PffOffenseRow[] => [...regulars, { player_id: 7, franchise_id: 9, position: "WR", grades_offense: 85, snap_counts_total: games * 60, player_game_count: games }, { player_id: 8, franchise_id: 9, position: "WR", grades_offense: 50, snap_counts_total: 600, player_game_count: 9 }];
    const crosswalk = new Map([["g1", { pffId: 7, birthDate: null }]]);
    const healthy = buildContractSituation(input({ crosswalk, pff: { current: pffRows(9), prior: pffRows(17), seasons: { current: 2026, prior: 2025 } } }));
    expect(healthy.players[star.otc_id]).toMatchObject({ importance: "star", unavailable: false });
    const hurt = buildContractSituation(input({ crosswalk, pff: { current: pffRows(3), prior: pffRows(17), seasons: { current: 2026, prior: 2025 } } }));
    expect(hurt.players[star.otc_id]).toMatchObject({ unavailable: true });
  });
});

describe("the user's calls", () => {
  const s = buildContractSituation(input());
  const wr = s.teams.find((t) => t.teamId === GB)!.rooms.WR;

  it("count for their season only", () => {
    const o = { [String(old.otc_id)]: { call: "stays" as const, season: 2027 } };
    expect(overrideFor(o, old.otc_id, 2027)).toBe("stays");
    expect(overrideFor(o, old.otc_id, 2028)).toBeNull();
    expect(overrideFor(null, old.otc_id, 2027)).toBeNull();
  });

  it("change who counts in the room: 'goes' takes a core player out; 'stays' keeps only a player who'd count", () => {
    expect(coreWith(s.players[expiring.otc_id], "goes")).toBe(false);
    expect(coreWith(s.players[old.otc_id], "stays")).toBe(false); // a depth player kept is still depth
    expect(coreWith(s.players[star.otc_id], null)).toBe(true);
    expect(roomOpenWith(wr, s.players, { [String(expiring.otc_id)]: { call: "goes", season: 2027 } }, 2027)).toEqual({ expectedCore: 1, openSpots: 2 });
    expect(roomOpenWith(wr, s.players, { [String(expiring.otc_id)]: { call: "goes", season: 2026 } }, 2027)).toEqual({ expectedCore: 2, openSpots: 1 });
  });

  it("label the season: the user's call first, else cut risk or re-sign odds", () => {
    expect(callFor(s.players[old.otc_id], null)).toMatchObject({ label: "Likely cut", tone: "bad", source: "model" });
    expect(callFor(s.players[expiring.otc_id], null)).toMatchObject({ label: "Likely back", tone: "good" });
    expect(callFor(s.players[star.otc_id], null)).toBeNull();
    expect(callFor(s.players[old.otc_id], "stays")).toMatchObject({ label: "Stays", source: "yours" });
  });
});

describe("contractChip", () => {
  it("says when the deal ends, what he'll be, and how long it's guaranteed", () => {
    expect(contractChip({ endYear: 2029, freeAgency: "UFA", guaranteedThrough: 2027 }, 2027)).toBe("thru '29 · gtd '27");
    expect(contractChip({ endYear: 2029, freeAgency: "UFA", guaranteedThrough: 2026 }, 2027)).toBe("thru '29");
    expect(contractChip({ endYear: 2026, freeAgency: "RFA", guaranteedThrough: null }, 2027)).toBe("Exp '26 RFA");
    expect(contractChip({ endYear: 2026, freeAgency: "UFA", guaranteedThrough: null }, 2027)).toBe("Exp '26");
    expect(contractChip({ endYear: null, freeAgency: null, guaranteedThrough: null }, 2027)).toBe("FA");
  });
});

describe("contractPathHint (Dynasty+'s path by year 2)", () => {
  const s = buildContractSituation(input());
  const P = (r: NflContractRow) => s.players[r.otc_id];

  it("opens when a vet ahead is a likely cut or likely leaves, or the user says he goes", () => {
    expect(contractPathHint({ classYear: 2026, pos: "WR", teamId: GB, ahead: [P(star), P(old)], situation: s })).toMatchObject({ season: 2027, call: "opens", why: "Old Depth: a likely cut before 2027" });
    const leaving: PlayerSituation = { ...P(expiring), stay: { call: "leaves", score: -1, reasons: [] } };
    expect(contractPathHint({ classYear: 2026, pos: "WR", teamId: GB, ahead: [leaving], situation: s })?.call).toBe("opens");
    const goes = { [String(star.otc_id)]: { call: "goes" as const, season: 2027 } };
    expect(contractPathHint({ classYear: 2026, pos: "WR", teamId: GB, ahead: [P(star)], situation: s, overrides: goes })?.why).toBe("Long Star: your call, gone in 2027");
    const stays = { [String(old.otc_id)]: { call: "stays" as const, season: 2027 } };
    expect(contractPathHint({ classYear: 2026, pos: "WR", teamId: GB, ahead: [P(old)], situation: s, overrides: stays })).toBeNull();
  });

  it("only reads the season it was judged for", () => {
    expect(contractPathHint({ classYear: 2027, pos: "WR", teamId: GB, ahead: [P(old)], situation: s })).toBeNull();
  });

  it("closes when the team is in the top quarter for adding competition at his position", () => {
    const team = (teamId: number, any: number) => ({ teamId, rooms: { WR: { pressure: { any } } } }) as unknown as TeamSituation;
    const teams = [team(1, 0.2), team(2, 0.3), team(3, 0.4), team(GB, 0.7)];
    const fake = { season: 2027, asOf: "x", teams } as Pick<ContractSituationResponse, "season" | "teams" | "asOf">;
    expect(pressureRank(teams, GB, "WR")).toBe(1);
    expect(pressureRank(teams, 2, "WR")).toBe(0.5);
    expect(contractPathHint({ classYear: 2026, pos: "WR", teamId: GB, ahead: [], situation: fake })).toMatchObject({ call: "closes" });
    expect(contractPathHint({ classYear: 2026, pos: "WR", teamId: 3, ahead: [], situation: fake })).toBeNull(); // 0.75 is not above CLOSES_RANK
    expect(CLOSES_RANK).toBe(0.75);
  });
});

describe("sameName", () => {
  it("ignores case, punctuation and suffixes", () => {
    expect(sameName("Marvin Harrison Jr.", "marvin harrison")).toBe(true);
    expect(sameName("A.J. Brown", "AJ Brown")).toBe(true);
    expect(sameName("Michael Pittman Jr.", "Michael Thomas")).toBe(false);
  });
});
