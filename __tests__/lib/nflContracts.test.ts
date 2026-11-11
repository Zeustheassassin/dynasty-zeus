import { describe, it, expect } from "vitest";
import {
  cleanSeasons, pickLatestContracts, contractTypeOf, keepContract, parseCsv, parsePlayerIdsCsv,
  parseNflverseTimestamp, buildContractRows, type RawContract, type RawContractSeason,
} from "@/lib/nflContracts";

const NOV_2026 = new Date("2026-11-11T12:00:00Z");

const season = (year: string, extra: Partial<RawContractSeason> = {}): RawContractSeason => ({
  year, team: "Bengals", base_salary: 1, prorated_bonus: 0.5, option_bonus: 0, roster_bonus: 0,
  guaranteed_salary: 0, cap_number: 1.5, cap_percent: 0.005, cash_paid: 1, workout_bonus: 0,
  per_game_roster_bonus: 0, other_bonus: null, ...extra,
});

const contract = (extra: Partial<RawContract> = {}): RawContract => ({
  player: "Test Player", position: "WR", team: "Bengals", is_active: true, year_signed: 2025, years: 4,
  value: 10, apy: 2.5, guaranteed: 4, apy_cap_pct: 0.01, otc_id: 1, gsis_id: "00-0000001",
  draft_year: 2025, draft_round: 2, draft_overall: 40, season_history: [season("2025"), season("Total")],
  contract_history: [{ team: "Bengals", contract_type: "Drafted", status: "Active", year_signed: 2025, yrs: 4 }],
  ...extra,
});

describe("cleanSeasons", () => {
  it("drops the Total row and the empty placeholder, parses years, sorts oldest first", () => {
    const out = cleanSeasons([season("2027"), season("Total"), season("2025"), { year: null, team: null }]);
    expect(out.map((s) => s.year)).toEqual([2025, 2027]);
    expect(out[0]).toMatchObject({ year: 2025, team: "Bengals", base_salary: 1, cap_number: 1.5, other_bonus: null });
  });

  it("keeps void years (placeholder salaries) — step 3 decides which years are real", () => {
    const out = cleanSeasons([season("2029", { base_salary: 99.999999, cap_number: 0 })]);
    expect(out).toHaveLength(1);
    expect(out[0].base_salary).toBe(99.999999);
  });

  it("turns missing or non-finite money into null", () => {
    const out = cleanSeasons([season("2026", { guaranteed_salary: undefined, cap_number: Number.NaN })]);
    expect(out[0].guaranteed_salary).toBeNull();
    expect(out[0].cap_number).toBeNull();
  });

  it("handles a null history", () => {
    expect(cleanSeasons(null)).toEqual([]);
  });
});

describe("pickLatestContracts", () => {
  it("prefers the active deal, then the later signing, then the bigger APY", () => {
    const rookie = contract({ otc_id: 7, is_active: false, year_signed: 2021, apy: 7.7 });
    const ext = contract({ otc_id: 7, is_active: true, year_signed: 2025, apy: 40.25 });
    expect(pickLatestContracts([ext, rookie]).get(7)?.year_signed).toBe(2025);
    expect(pickLatestContracts([rookie, ext]).get(7)?.year_signed).toBe(2025);

    const ps = contract({ otc_id: 8, year_signed: 2026, apy: 0.46 });
    const roster = contract({ otc_id: 8, year_signed: 2026, apy: 1.3 });
    expect(pickLatestContracts([ps, roster]).get(8)?.apy).toBe(1.3);

    const old = contract({ otc_id: 9, is_active: false, year_signed: 2019 });
    const newer = contract({ otc_id: 9, is_active: false, year_signed: 2023 });
    expect(pickLatestContracts([old, newer]).get(9)?.year_signed).toBe(2023);
  });

  it("drops rows without an otc_id or a name", () => {
    const out = pickLatestContracts([contract({ otc_id: null }), contract({ otc_id: 3, player: "  " })]);
    expect(out.size).toBe(0);
  });
});

describe("contractTypeOf", () => {
  it("reads the history entry signed the same year with the same team", () => {
    const r = contract({
      year_signed: 2025,
      contract_history: [
        { team: "Bengals", contract_type: "Drafted", status: "Expired", year_signed: 2021 },
        { team: "Bengals", contract_type: "Extension", status: "Active", year_signed: 2025 },
      ],
    });
    expect(contractTypeOf(r)).toBe("Extension");
  });

  it("falls back to the Active entry, then the latest one", () => {
    expect(contractTypeOf(contract({
      team: "MIA/DEN",
      contract_history: [{ team: "Dolphins", contract_type: "UDFA", status: "Active", year_signed: 2025 }],
    }))).toBe("UDFA");
    expect(contractTypeOf(contract({
      is_active: false, team: "Jets", year_signed: 2024,
      contract_history: [
        { team: "Bills", contract_type: "Drafted", status: "Expired", year_signed: 2019 },
        { team: "Bills", contract_type: "Extension", status: "Released", year_signed: 2022 },
      ],
    }))).toBe("Extension");
    expect(contractTypeOf(contract({ contract_history: null }))).toBeNull();
  });
});

describe("keepContract", () => {
  it("keeps every active deal, however old (a 10-year extension signed in 2020)", () => {
    const r = contract({ is_active: true, year_signed: 2020 });
    expect(keepContract(r, cleanSeasons([season("2020")]), NOV_2026)).toBe(true);
  });

  it("keeps an ended deal that reached last season or was signed since (this year's FAs, recent cuts)", () => {
    expect(keepContract(contract({ is_active: false, year_signed: 2022 }), cleanSeasons([season("2025")]), NOV_2026)).toBe(true);
    expect(keepContract(contract({ is_active: false, year_signed: 2026 }), [], NOV_2026)).toBe(true);
  });

  it("leaves out long-retired players", () => {
    expect(keepContract(contract({ is_active: false, year_signed: 2015 }), cleanSeasons([season("2018")]), NOV_2026)).toBe(false);
  });
});

describe("parseCsv / parsePlayerIdsCsv", () => {
  it("keeps commas, doubled quotes and line breaks inside quoted fields", () => {
    const rows = parseCsv('a,b,c\r\n1,"Miami, O.","say ""hi"""\n2,"two\nlines",x');
    expect(rows).toEqual([["a", "b", "c"], ["1", "Miami, O.", 'say "hi"'], ["2", "two\nlines", "x"]]);
  });

  it("maps gsis_id to sleeper_id, skipping NA and blanks, by header position", () => {
    const csv = [
      "mfl_id,gsis_id,sleeper_id,name,college",
      '1,00-0036900,7564,Ja\'Marr Chase,"Baton Rouge, La."',
      "2,00-0000002,NA,No Sleeper,X",
      "3,NA,123,No Gsis,X",
      "4,00-0041562,13269,Fernando Mendoza,Indiana",
    ].join("\n");
    const map = parsePlayerIdsCsv(csv);
    expect([...map.entries()]).toEqual([["00-0036900", "7564"], ["00-0041562", "13269"]]);
  });

  it("returns an empty map when a column is missing", () => {
    expect(parsePlayerIdsCsv("mfl_id,name\n1,x").size).toBe(0);
  });
});

describe("parseNflverseTimestamp", () => {
  it("reads nflverse's EST/EDT/UTC stamps", () => {
    expect(parseNflverseTimestamp("2026-11-10 10:31:04 EST")).toBe("2026-11-10T15:31:04.000Z");
    expect(parseNflverseTimestamp("2026-07-01 10:00:00 EDT")).toBe("2026-07-01T14:00:00.000Z");
    expect(parseNflverseTimestamp("2026-07-01 10:00:00 UTC")).toBe("2026-07-01T10:00:00.000Z");
  });

  it("returns null for anything else", () => {
    expect(parseNflverseTimestamp(undefined)).toBeNull();
    expect(parseNflverseTimestamp("yesterday")).toBeNull();
    expect(parseNflverseTimestamp("2026-11-10 10:31:04 PST")).toBeNull();
  });
});

describe("buildContractRows", () => {
  it("builds one row per kept player with his Sleeper id, cleaned seasons and contract type", () => {
    const raw: RawContract[] = [
      contract({ otc_id: 9469, player: "Ja'Marr Chase", gsis_id: "00-0036900", is_active: false, year_signed: 2021, apy: 7.7 }),
      contract({
        otc_id: 9469, player: "Ja'Marr Chase", gsis_id: "00-0036900", year_signed: 2025, apy: 40.25,
        season_history: [season("2026"), season("2025"), season("Total")],
        contract_history: [{ team: "Bengals", contract_type: "Extension", status: "Active", year_signed: 2025 }],
      }),
      contract({ otc_id: 2, player: "Unmatched Rookie", gsis_id: null, year_signed: 2026, season_history: [{ year: null }] }),
      contract({ otc_id: 3, player: "Retired Guy", is_active: false, year_signed: 2012, season_history: [season("2014")] }),
    ];
    const ids = new Map([["00-0036900", "7564"]]);
    const rows = buildContractRows(raw, ids, { now: NOV_2026, sourceUpdatedAt: "2026-11-10T15:31:04.000Z" });

    expect(rows.map((r) => r.otc_id).sort()).toEqual([2, 9469]);
    const chase = rows.find((r) => r.otc_id === 9469)!;
    expect(chase).toMatchObject({
      sleeper_id: "7564", gsis_id: "00-0036900", is_active: true, year_signed: 2025, apy: 40.25,
      contract_type: "Extension", source_updated_at: "2026-11-10T15:31:04.000Z",
      refreshed_at: "2026-11-11T12:00:00.000Z",
    });
    expect(chase.seasons.map((s) => s.year)).toEqual([2025, 2026]);

    const rookie = rows.find((r) => r.otc_id === 2)!;
    expect(rookie.sleeper_id).toBeNull();
    expect(rookie.gsis_id).toBeNull();
    expect(rookie.seasons).toEqual([]);
  });
});
