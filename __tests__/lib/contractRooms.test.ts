import { describe, it, expect } from "vitest";
import {
  leagueCapByYear, capHitIn, isInvested, cheapCutYear, buildContractRooms, STARTING_SPOTS, OFFSEASON_COUNT,
  INVESTED_APY, INVESTED_APY_CAP,
} from "@/lib/contractRooms";
import { contractStatus } from "@/lib/contractStatus";
import type { ContractSeason, NflContractRow } from "@/lib/nflContracts";

const NOV_2026 = new Date("2026-11-11T12:00:00Z");

/** A real season: salary + signing proration = cap, cash = salary. */
const line = (year: number, base: number, pror = 0, g = 0, extra: Partial<ContractSeason> = {}): ContractSeason => ({
  year, team: null, base_salary: base, prorated_bonus: pror, option_bonus: 0, roster_bonus: 0, guaranteed_salary: g,
  cap_number: base + pror, cap_percent: null, cash_paid: base, workout_bonus: 0, per_game_roster_bonus: 0, other_bonus: null, ...extra,
});

let nextId = 1;
function player(extra: Partial<NflContractRow>): NflContractRow {
  return {
    otc_id: nextId++, gsis_id: null, sleeper_id: null, player: `P${nextId}`, position: "WR", team: "Packers", is_active: true,
    contract_type: "UFA", year_signed: 2026, years: 1, value: 1, apy: 1, guaranteed: 0, apy_cap_pct: 0.003,
    draft_year: 2020, draft_round: 4, draft_overall: 120, seasons: [line(2026, 1)],
    source_updated_at: null, refreshed_at: "2026-11-11T00:00:00Z", ...extra,
  };
}

describe("leagueCapByYear", () => {
  it("backs the projected cap out of big cap hits, from the given year on", () => {
    const rows = Array.from({ length: 25 }, (_, i) => player({
      seasons: [
        line(2026, 30, 0, 0, { cap_percent: 0.095 }), // against a team's adjusted cap: ignored (before fromYear)
        line(2027, 30 + i * 0.1, 0, 0, { cap_percent: (30 + i * 0.1) / 327 }),
        line(2028, 3, 0, 0, { cap_percent: 3 / 352 }), // under 5%: too rounded to use
      ],
    }));
    const caps = leagueCapByYear(rows, 2027);
    expect(caps[2027]).toBeCloseTo(327, 6);
    expect(caps[2026]).toBeUndefined();
    expect(caps[2028]).toBeUndefined();
  });

  it("needs enough samples", () => {
    const rows = Array.from({ length: 5 }, () => player({ seasons: [line(2027, 30, 0, 0, { cap_percent: 30 / 327 })] }));
    expect(leagueCapByYear(rows, 2027)).toEqual({});
  });
});

describe("capHitIn", () => {
  it("reads the real season's cap number, APY when OTC has no breakdown, nothing past the deal", () => {
    const signed = player({ years: 3, seasons: [line(2026, 2, 1), line(2027, 3, 1), line(2028, 4, 1)] });
    const st = contractStatus(signed, NOV_2026);
    expect(capHitIn(signed, st, 2027)).toEqual({ hit: 4, estimated: false });
    expect(capHitIn(signed, st, 2029)).toBeNull();

    const rookie = player({ contract_type: "Drafted", year_signed: 2026, years: 4, apy: 2.5, seasons: [] });
    expect(capHitIn(rookie, contractStatus(rookie, NOV_2026), 2028)).toEqual({ hit: 2.5, estimated: true });

    const gone = player({ is_active: false });
    expect(capHitIn(gone, contractStatus(gone, NOV_2026), 2026)).toBeNull();
  });
});

describe("isInvested — the user's bars (2026-11-11)", () => {
  const st = (r: NflContractRow) => contractStatus(r, NOV_2026);
  const twoYears = { years: 2, seasons: [line(2026, 1), line(2027, 1)] };
  const at = (position: string, apyCapPct: number | null, apy = 1) => player({ ...twoYears, position, apy_cap_pct: apyCapPct, apy });

  it("a round 1–3 rookie deal, whatever it pays", () => {
    const r3 = player({ ...twoYears, contract_type: "Drafted", draft_round: 3, apy_cap_pct: 0.003 });
    expect(isInvested(r3, st(r3), 2027)).toBe(true);
    const r4 = player({ ...twoYears, contract_type: "Drafted", draft_round: 4, apy_cap_pct: 0.003 });
    expect(isInvested(r4, st(r4), 2027)).toBe(false);
  });

  it("a veteran deal at the position's bar as a share of the 2026 cap: QB $50M, WR $12.5M, RB $10M, TE $7.5M", () => {
    const share = (pos: keyof typeof INVESTED_APY) => INVESTED_APY[pos] / INVESTED_APY_CAP;
    for (const pos of ["QB", "RB", "WR", "TE"] as const) {
      const r = at(pos, share(pos));
      expect(isInvested(r, st(r), 2027)).toBe(true);
      const under = at(pos, share(pos) - 0.002);
      expect(isInvested(under, st(under), 2027)).toBe(false);
    }
    // Live examples: Jacobs's 2024 $12M was 4.7% of that cap ($14.2M today); Darnold's $33.5M is short of a QB's $50M.
    const jacobs = at("RB", 0.047, 12);
    expect(isInvested(jacobs, st(jacobs), 2027)).toBe(true);
    const darnold = at("QB", 0.12, 33.5);
    expect(isInvested(darnold, st(darnold), 2027)).toBe(false);
    // No cap percent: APY in today's dollars.
    const noPct = at("WR", null, 13);
    expect(isInvested(noPct, st(noPct), 2027)).toBe(true);
  });

  it("never a practice-squad deal, a deal that's over, or a position without a room", () => {
    const ps = player({ ...twoYears, contract_type: "Practice", apy_cap_pct: 0.2 });
    expect(isInvested(ps, st(ps), 2027)).toBe(false);
    const expiring = player({ apy_cap_pct: 0.2 });
    expect(isInvested(expiring, st(expiring), 2027)).toBe(false);
    const lb = at("LB", 0.2);
    expect(isInvested(lb, st(lb), 2027)).toBe(false);
  });
});

describe("cheapCutYear (before June 1 only)", () => {
  it("the first season a release saves at least its dead money", () => {
    // Jacobs-like: 2027 hit 16.6 with 3.1 of proration left → saves 13.5.
    const jacobs = player({ position: "RB", years: 2, seasons: [line(2026, 10.2, 3.1), line(2027, 13.5, 3.1)] });
    expect(cheapCutYear(contractStatus(jacobs, NOV_2026), 2027)).toBe(2027);
    // Watson-like: 7.4 a year of proration through 2030; 2027–28 cost more than they save, and 2029
    // (hit 30.4, dead 14.8) is the first that pays for itself.
    const watson = player({
      years: 4, seasons: [line(2026, 1.4, 7.4), line(2027, 1.5, 7.4), line(2028, 14, 7.4), line(2029, 23, 7.4), line(2030, 17.4, 7.4)],
    });
    expect(cheapCutYear(contractStatus(watson, NOV_2026), 2027)).toBe(2029);
    // Fully guaranteed through the end: never.
    const locked = player({ years: 2, seasons: [line(2026, 5, 0, 5), line(2027, 5, 0, 5)] });
    expect(cheapCutYear(contractStatus(locked, NOV_2026), 2027)).toBeNull();
  });
});

describe("buildContractRooms", () => {
  function league(): NflContractRow[] {
    nextId = 1;
    return [
      // Packers QB: signed through 2028.
      player({ player: "Love", position: "QB", contract_type: "Extension", years: 3, apy_cap_pct: 0.215, seasons: [line(2026, 30), line(2027, 40), line(2028, 50)] }),
      // Packers WRs: three invested for 2027 (two through 2028), a minimum vet and a practice-squad WR expiring.
      player({ player: "Watson", contract_type: "Extension", years: 3, apy_cap_pct: 0.07, seasons: [line(2026, 10), line(2027, 11), line(2028, 24)] }),
      player({ player: "Golden", contract_type: "Drafted", draft_round: 1, draft_year: 2025, years: 3, apy_cap_pct: 0.015, seasons: [line(2026, 4), line(2027, 4.8), line(2028, 5.6)] }),
      player({ player: "Reed", contract_type: "Extension", years: 2, apy_cap_pct: 0.05, seasons: [line(2026, 10), line(2027, 10.9)] }),
      player({ player: "Moore", contract_type: "UFA", apy_cap_pct: 0.008, seasons: [line(2026, 2.5)] }),
      player({ player: "Skinner", contract_type: "Practice", draft_year: 2025, apy_cap_pct: 0.001, seasons: [line(2026, 0.25)] }),
      // A void year booked in 2027 (the deal ends 2026): no cash, a placeholder salary.
      player({ player: "Voided", position: "LB", apy_cap_pct: 0.02, seasons: [line(2026, 5), line(2027, 99.999999, 0, 0, { cap_number: 6, cash_paid: 0, option_bonus: 6 })] }),
      // A Bengals TE OTC still has on the Bengals; the app knows he's a Packer now.
      player({ player: "Moved", position: "TE", team: "Bengals", sleeper_id: "moved", years: 2, apy_cap_pct: 0.03, seasons: [line(2026, 8), line(2027, 9)] }),
      // A free agent: in no room.
      player({ player: "Gone", position: "WR", is_active: false }),
    ];
  }

  it("builds every team's rooms: who's signed, invested, open spots, who's leaving", () => {
    const res = buildContractRooms(league(), NOV_2026);
    expect(res).toMatchObject({ contractYear: 2026, season: 2027 });
    expect(res.teams).toHaveLength(32);
    const gb = res.teams.find((t) => t.teamId === 9)!;

    const wr = gb.rooms.WR;
    expect(wr.players.map((p) => p.name)).toEqual(["Watson", "Reed", "Golden", "Moore", "Skinner"]);
    expect(wr.players.find((p) => p.name === "Golden")).toMatchObject({ capHit: 4.8, invested: true });
    expect(wr.outlook).toEqual([
      { year: 2027, underContract: 3, invested: 3, openSpots: 0, capCommitted: 26.7 },
      { year: 2028, underContract: 2, invested: 2, openSpots: 1, capCommitted: 29.6 },
      { year: 2029, underContract: 0, invested: 0, openSpots: STARTING_SPOTS.WR, capCommitted: 0 },
    ].map((o) => ({ ...o, capCommitted: expect.closeTo(o.capCommitted, 6) })));
    expect(wr.leaving.map((p) => [p.name, p.status.freeAgency])).toEqual([["Moore", "UFA"], ["Skinner", "ERFA"]]);

    expect(gb.rooms.QB.outlook.map((o) => o.openSpots)).toEqual([0, 0, 1]);
    expect(gb.rooms.TE.players).toEqual([]);
    expect(res.teams.find((t) => t.teamId === 4)!.rooms.TE.players.map((p) => p.name)).toEqual(["Moved"]);
  });

  it("team cap: cap hits plus void money; space when the league cap is known", () => {
    const gb = buildContractRooms(league(), NOV_2026).teams.find((t) => t.teamId === 9)!;
    // 2027: Love 40 + Watson 11 + Golden 4.8 + Reed 10.9 = 66.7, + 6 of void money.
    expect(gb.cap[0]).toMatchObject({ year: 2027, contracts: 4, voidMoney: 6, estimated: 0, leagueCap: null, space: null });
    expect(gb.cap[0].committed).toBeCloseTo(72.7, 6);
  });

  it("teamOf overrides OTC's team (Sleeper knows about a move OTC hasn't caught up with)", () => {
    const res = buildContractRooms(league(), NOV_2026, { teamOf: (r) => (r.sleeper_id === "moved" ? 9 : null) });
    expect(res.teams.find((t) => t.teamId === 9)!.rooms.TE.players.map((p) => p.name)).toEqual(["Moved"]);
    expect(res.teams.find((t) => t.teamId === 4)!.rooms.TE.players).toEqual([]);
  });

  it("only the top 51 cap hits count in the offseason", () => {
    nextId = 1;
    const rows = Array.from({ length: OFFSEASON_COUNT + 2 }, (_, i) =>
      player({ position: "LB", years: 2, apy_cap_pct: 0.01, seasons: [line(2026, 1), line(2027, i + 1)] }));
    const cap = buildContractRooms(rows, NOV_2026).teams.find((t) => t.teamId === 9)!.cap[0];
    expect(cap.contracts).toBe(53);
    // 53 hits of 1..53: the two smallest (1 and 2) drop out.
    expect(cap.committed).toBe((53 * 54) / 2 - 3);
  });

  it("can look at another season first", () => {
    expect(buildContractRooms(league(), NOV_2026, { season: 2028 }).teams[0].cap.map((c) => c.year)).toEqual([2028, 2029, 2030]);
  });
});
