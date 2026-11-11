import { describe, it, expect } from "vitest";
import {
  contractYearAt, contractKind, isRealSeason, splitOptionBonuses, cutMath, contractStatus,
} from "@/lib/contractStatus";
import type { ContractSeason, NflContractRow } from "@/lib/nflContracts";

// Yearly lines as nfl_contracts stores them (copied from the live table on 2026-11-11):
// s(year, base, signing proration, option proration, roster bonus, workout + per-game + other, guaranteed, cap, team, cash paid).
const s = (year: number, base: number, pror: number, opt: number, roster: number, other: number, g: number, cap: number, team = "Lions", cash: number | null = null): ContractSeason => ({
  year, team, base_salary: base, prorated_bonus: pror, option_bonus: opt, roster_bonus: roster, guaranteed_salary: g,
  cap_number: cap, cap_percent: null, cash_paid: cash, workout_bonus: other, per_game_roster_bonus: 0, other_bonus: null,
});

const GIBBS = [
  s(2023, 0.75, 2.49457, 0, 0, 0, 0.75, 3.24457),
  s(2024, 0.915, 2.49457, 0, 0.646143, 0, 1.561143, 4.055713),
  s(2025, 1.03, 2.49457, 0, 1.342286, 0, 2.372286, 4.866856),
  s(2026, 1.145, 5.49457, 0, 2.038429, 0, 3.183429, 8.677999, "Lions", 18.183429),
  s(2027, 1.26, 3, 2.0066, 0, 0, 11.293, 6.2666, "Lions", 11.293),
  s(2028, 1.305, 3, 3.7956, 0, 0.25, 8.25, 8.35066, "Lions", 10.5),
  s(2029, 9.75, 3, 6.2956, 0, 0.25, 0, 19.2956, "Lions", 22.5),
  s(2030, 9.3, 3, 8.6856, 1, 0.25, 0, 22.2356, "Lions", 22.5),
  s(2031, 0, 0, 8.6856, 0, 0, 0, 22.6446, "Lions", 0),
  s(2032, 0, 0, 6.679, 0, 0, 0, 0, "Lions", 0),
  s(2033, 0, 0, 4.89, 0, 0, 0, 0, "Lions", 0),
  s(2034, 0, 0, 2.39, 0, 0, 0, 0, "Lions", 0),
];
const CHASE = [
  s(2021, 0.66, 4.943571, 0, 0, 0, 0.66, 5.603571, "Bengals"),
  s(2022, 0.825, 4.943571, 0, 1.235893, 0, 2.060893, 7.004464, "Bengals"),
  s(2023, 0.94, 4.943571, 0, 2.521786, 0, 3.461786, 8.405357, "Bengals"),
  s(2024, 1.055, 4.943571, 0, 3.807679, 0, 4.862679, 9.80625, "Bengals"),
  s(2025, 8.07, 4.4, 0, 10, 1.1, 19.17, 23.121667, "Bengals"),
  s(2026, 17.73, 4.4, 3, 0, 1.1, 18.83, 26.171176, "Bengals", 33.73),
  s(2027, 23.9, 4.4, 4, 0, 1.1, 30, 33.4, "Bengals", 30),
  s(2028, 31.9, 4.4, 4, 0, 1.1, 0, 41.4, "Bengals", 33),
  s(2029, 43.316, 4.4, 4, 0, 1.1, 0, 53.216, "Bengals", 44.816),
  s(2030, 0, 0, 4, 0, 0, 0, 5, "Bengals", 0),
  s(2031, 0, 0, 1, 0, 0, 0, 0, "Bengals", 0),
];
const BURROW = [
  s(2020, 0.61, 5.970025, 0, 0, 0, 0.61, 6.580025, "Bengals"),
  s(2021, 0.78, 5.970025, 0, 1.475006, 0, 2.255006, 8.225035, "Bengals"),
  s(2022, 0.895, 5.970025, 0, 3.005012, 0, 3.900012, 9.870037, "Bengals"),
  s(2023, 1.01, 13.970025, 0, 4.535018, 0, 5.545018, 19.515043, "Bengals"),
  s(2024, 10.714982, 7.83613, 11, 0, 0, 10.714982, 29.551112, "Bengals"),
  s(2025, 25.25, 7.749784, 13, 0, 0, 25.25, 45.999784, "Bengals"),
  s(2026, 12.25, 10.349784, 15, 0, 0, 12.25, 37.599784, "Bengals", 35.25),
  s(2027, 27.25, 10.349784, 17, 0, 0, 18.3, 54.599784, "Bengals", 37.25),
  s(2028, 35.5, 2.6, 18, 0, 0, 0, 55.849784, "Bengals", 40.5),
  s(2029, 48.039018, 2.6, 7, 2.5, 0, 0, 60.052672, "Bengals", 50.539018),
  s(2030, 50, 2.6, 5, 0, 0, 0, 11.6, "Bengals", 0),
  s(2031, 50, 0, 3, 0, 0, 0, 0, "Bengals", 0),
  s(2032, 50, 0, 1, 0, 0, 0, 0, "Bengals", 0),
];
const BIJAN_2031 = s(2031, 7, 0, 11.1856, 0, 0, 0, 32.8466, "Falcons", 0);

const NOV_2026 = new Date("2026-11-11T12:00:00Z");

function row(extra: Partial<NflContractRow>): NflContractRow {
  return {
    otc_id: 1, gsis_id: null, sleeper_id: null, player: "Test", position: "WR", team: "Lions", is_active: true,
    contract_type: "Extension", year_signed: 2026, years: 3, value: 67.5, apy: 22.5, guaranteed: 37.7,
    apy_cap_pct: 0.07, draft_year: 2023, draft_round: 1, draft_overall: 12, seasons: [],
    source_updated_at: null, refreshed_at: "2026-11-11T00:00:00Z", ...extra,
  };
}

const close = (a: number | undefined, b: number) => expect(a).toBeCloseTo(b, 2);

describe("contractYearAt", () => {
  it("rolls over in mid-March", () => {
    expect(contractYearAt(new Date("2026-11-11T00:00:00Z"))).toBe(2026);
    expect(contractYearAt(new Date("2027-02-28T00:00:00Z"))).toBe(2026);
    expect(contractYearAt(new Date("2027-03-10T23:00:00Z"))).toBe(2026);
    expect(contractYearAt(new Date("2027-03-11T00:00:00Z"))).toBe(2027);
    expect(contractYearAt(new Date("2027-08-01T00:00:00Z"))).toBe(2027);
  });
});

describe("contractKind", () => {
  it("maps OTC's contract types", () => {
    expect(contractKind("Drafted")).toBe("rookie");
    expect(contractKind("UDFA")).toBe("udfa");
    expect(contractKind("Extension")).toBe("extension");
    expect(contractKind("Franchise")).toBe("tag");
    expect(contractKind("Transition")).toBe("tag");
    expect(contractKind("ERFA")).toBe("tender");
    expect(contractKind("SFA")).toBe("veteran");
    expect(contractKind("Practice")).toBe("practice");
    expect(contractKind(null)).toBe("other");
  });
});

describe("isRealSeason", () => {
  it("accepts seasons with a salary, a cap number and cash paid", () => {
    expect(isRealSeason(GIBBS[6])).toBe(true); // 2029
    expect(isRealSeason(BURROW[9])).toBe(true); // 2029
    // Real seasons whose cap number isn't the sum of the yearly columns (live data, 2026-11-11):
    expect(isRealSeason(s(2028, 49.3, 16.757731, 15.775, 0, 1.1, 0, 75.775, "Packers", 45))).toBe(true); // Love: $7M under
    expect(isRealSeason(s(2027, 1.19, 5.866775, 0, 3.601332, 0, 5.791332, 11.658107, "Patriots", 5.791332))).toBe(true); // Maye: $1M over
    expect(isRealSeason(s(2027, 35.5, 6.4, 0, 10, 0.2, 0, 44.9, "Seahawks", 35.5))).toBe(true); // Darnold
  });

  it("rejects void years: no salary, or a placeholder salary with no cash", () => {
    expect(isRealSeason(GIBBS[8])).toBe(false); // 2031: $0 salary, the accelerated proration
    expect(isRealSeason(BURROW[10])).toBe(false); // 2030: $50M placeholder, cap 11.6
    expect(isRealSeason(BIJAN_2031)).toBe(false); // $7M placeholder, cap 32.85 is option proration only
    expect(isRealSeason(CHASE[9])).toBe(false);
    expect(isRealSeason(s(2029, 1.435, 0, 15.775, 0, 0, 0, 31.55, "Packers", 0))).toBe(false); // Love 2029
  });

  it("without a cash figure, falls back to cap = salary + bonuses", () => {
    expect(isRealSeason(s(2025, 8.07, 4.4, 0, 10, 1.1, 19.17, 23.121667, "Bengals"))).toBe(true); // Chase: 0.45 under
    expect(isRealSeason(s(2031, 7, 0, 11.1856, 0, 0, 0, 32.8466, "Falcons"))).toBe(false); // Bijan's placeholder
  });
});

describe("splitOptionBonuses", () => {
  it("recovers each option bonus from the combined column", () => {
    expect(splitOptionBonuses(BURROW).map((b) => [b.start, b.end, +b.perYear.toFixed(3)])).toEqual([
      [2024, 2028, 11], [2025, 2029, 2], [2026, 2030, 2], [2027, 2031, 2], [2028, 2032, 1],
    ]);
    expect(splitOptionBonuses(CHASE).map((b) => [b.start, b.end, +b.perYear.toFixed(3)])).toEqual([[2026, 2030, 3], [2027, 2031, 1]]);
    expect(splitOptionBonuses(GIBBS)).toHaveLength(4);
    expect(splitOptionBonuses([s(2026, 1, 0, 0, 0, 0, 0, 1)])).toEqual([]);
  });
});

describe("cutMath — OverTheCap's published numbers (2026-11-11)", () => {
  it("Gibbs: unpaid option bonuses don't count", () => {
    const c27 = cutMath(GIBBS, 2027, 2026)!;
    close(c27.deadMoney, 31.543); close(c27.savings, -25.2764);
    close(c27.deadMoneyPostJune1, 22.543); close(c27.savingsPostJune1, -16.2764);
    close(cutMath(GIBBS, 2028, 2026)!.deadMoney, 17.25);
    const c29 = cutMath(GIBBS, 2029, 2026)!;
    close(c29.deadMoney, 6); close(c29.savings, 13.2956);
  });

  it("Chase: the option bonus paid in 2026 accelerates", () => {
    const c28 = cutMath(CHASE, 2028, 2026)!;
    close(c28.deadMoney, 17.8); close(c28.deadMoneyPostJune1, 7.4); close(c28.savings, 23.6);
    close(cutMath(CHASE, 2029, 2026)!.deadMoney, 10.4);
  });

  it("Burrow: three paid option bonuses plus void-year signing proration", () => {
    const c27 = cutMath(BURROW, 2027, 2026)!;
    close(c27.deadMoney, 72.45); close(c27.deadMoneyPostJune1, 43.65);
    close(cutMath(BURROW, 2028, 2026)!.deadMoney, 28.8);
    close(cutMath(BURROW, 2029, 2026)!.deadMoney, 11.2);
  });

  it("is null for a void or missing season", () => {
    expect(cutMath(GIBBS, 2031, 2026)).toBeNull();
    expect(cutMath(GIBBS, 2040, 2026)).toBeNull();
  });
});

describe("contractStatus", () => {
  it("Gibbs: ends 2030 (2031–34 void), guaranteed through 2028, long-term", () => {
    const st = contractStatus(row({ seasons: GIBBS }), NOV_2026);
    expect(st).toMatchObject({
      contractYear: 2026, active: true, kind: "extension", teamId: 8, endYear: 2030, yearsLeft: 4,
      expiring: false, longTerm: true, guaranteedThrough: 2028, yearlyBreakdown: true,
      voidYears: [2031, 2032, 2033, 2034], fifthYearOption: null, freeAgency: "UFA",
    });
    close(st.futureGuaranteed ?? undefined, 19.543);
    expect(st.cuts.map((c) => c.year)).toEqual([2027, 2028, 2029, 2030]);
  });

  it("Burrow: ends 2029, the $50M placeholder years are void", () => {
    const st = contractStatus(row({ team: "Bengals", seasons: BURROW, year_signed: 2023, years: 5, draft_year: 2020 }), NOV_2026);
    expect(st.endYear).toBe(2029);
    expect(st.voidYears).toEqual([2030, 2031, 2032]);
    expect(st.guaranteedThrough).toBe(2027);
  });

  it("a one-year deal OTC hasn't broken down falls back to year_signed + years − 1", () => {
    const melton = row({ contract_type: "SFA", year_signed: 2026, years: 1, draft_round: 7, draft_year: 2022, seasons: [s(2025, 1.1, 0, 0, 0, 0, 0, 1.1, "Packers")] });
    const st = contractStatus(melton, NOV_2026);
    expect(st).toMatchObject({ endYear: 2026, yearsLeft: 0, expiring: true, yearlyBreakdown: false, cuts: [], futureGuaranteed: null });
  });

  it("a 2026 rookie with no breakdown: end from the signing, guaranteed through it when the whole deal is", () => {
    const mendoza = row({
      team: "Raiders", contract_type: "Drafted", year_signed: 2026, years: 4, value: 57.27, guaranteed: 57.27,
      draft_year: 2026, draft_round: 1, draft_overall: 1, apy_cap_pct: 0.048, seasons: [],
    });
    expect(contractStatus(mendoza, NOV_2026)).toMatchObject({
      endYear: 2029, yearsLeft: 3, longTerm: true, guaranteedThrough: 2029, yearlyBreakdown: false,
      fifthYearOption: "pending", teamId: 13, kind: "rookie",
    });
  });

  it("5th-year options: exercised (an extra season), declined after the May deadline, pending before", () => {
    const rookie = (end: number) => row({
      contract_type: "Drafted", year_signed: 2023, years: 4, draft_year: 2023, draft_round: 1,
      seasons: Array.from({ length: end - 2022 }, (_, i) => s(2023 + i, 2, 1, 0, 0, 0, 2, 3)),
    });
    expect(contractStatus(rookie(2027), NOV_2026).fifthYearOption).toBe("exercised");
    expect(contractStatus(rookie(2026), NOV_2026).fifthYearOption).toBe("declined");
    expect(contractStatus(rookie(2026), new Date("2026-04-20T00:00:00Z")).fifthYearOption).toBe("pending");
    expect(contractStatus(row({ draft_round: 2, contract_type: "Drafted", seasons: [s(2026, 2, 1, 0, 0, 0, 2, 3)] }), NOV_2026).fifthYearOption).toBeNull();
  });

  it("free-agency type at the end of the deal from accrued seasons", () => {
    const deal = (draftYear: number) => contractStatus(row({ draft_year: draftYear, seasons: [s(2026, 1, 0, 0, 0, 0, 0, 1)] }), NOV_2026).freeAgency;
    expect(deal(2023)).toBe("UFA"); // 4th season
    expect(deal(2024)).toBe("RFA"); // 3rd
    expect(deal(2025)).toBe("ERFA"); // 2nd
    expect(contractStatus(row({ draft_year: null, seasons: [s(2026, 1, 0, 0, 0, 0, 0, 1)] }), NOV_2026).freeAgency).toBeNull();
  });

  it("a free agent has no end year, team or cuts", () => {
    const st = contractStatus(row({ is_active: false, contract_type: "UFA", seasons: GIBBS }), NOV_2026);
    expect(st).toMatchObject({ active: false, endYear: null, yearsLeft: null, expiring: false, longTerm: false, teamId: null, cuts: [] });
  });

  it("a trade ('A/B', either order) reads this season's line; a signing reads the latest contract's team", () => {
    // Live rows, 2026-11-11 (Sleeper agreed on all of these).
    const clark = row({ team: "GB/DAL", seasons: [s(2025, 1, 0, 0, 0, 0, 0, 1, "Packers"), s(2026, 1, 0, 0, 0, 0, 0, 1, "Cowboys")] });
    expect(contractStatus(clark, NOV_2026).teamId).toBe(6);
    const brown = row({ team: "NE/PHI", seasons: [s(2025, 1, 0, 0, 0, 0, 0, 1, "Eagles"), s(2026, 1, 0, 0, 0, 0, 0, 1, "Patriots")] });
    expect(contractStatus(brown, NOV_2026).teamId).toBe(17);
    const estime = row({ team: "Saints", contract_type: "SFA", seasons: [s(2026, 1, 0, 0, 0, 0, 0, 1, "Browns")] });
    expect(contractStatus(estime, NOV_2026).teamId).toBe(18);
    // A traded 2026 rookie OTC hasn't broken down: no season line, so no team.
    const rookie = row({ team: "WAS/MIA", contract_type: "Drafted", year_signed: 2026, years: 4, seasons: [] });
    expect(contractStatus(rookie, NOV_2026).teamId).toBeNull();
    expect(contractStatus(row({ team: "Packers", seasons: [] }), NOV_2026).teamId).toBe(9);
  });

  it("a season OTC shows unpaid (no cash) isn't part of the deal; the deal reads from the next real one", () => {
    const aiyuk = row({
      team: "49ers", year_signed: 2026, years: 3, draft_year: 2020, seasons: [
        s(2026, 1.215, 0, 0, 0, 0, 0, 12.45079, "49ers", 0), s(2027, 27.274, 0, 0, 0, 0, 0, 40.47479, "49ers", 28.124),
        s(2028, 29.15, 0, 0, 0, 0, 0, 42.35079, "49ers", 30), s(2029, 1.435, 0, 0, 0, 0, 0, 14.545, "49ers", 0),
      ],
    });
    expect(contractStatus(aiyuk, NOV_2026)).toMatchObject({ endYear: 2028, voidYears: [2029] });
  });

  it("flags minimum-level deals by cap share", () => {
    expect(contractStatus(row({ apy_cap_pct: 0.004, seasons: [s(2026, 1, 0, 0, 0, 0, 0, 1)] }), NOV_2026).minimumLevel).toBe(true);
    expect(contractStatus(row({ apy_cap_pct: 0.03, seasons: [s(2026, 1, 0, 0, 0, 0, 0, 1)] }), NOV_2026).minimumLevel).toBe(false);
    expect(contractStatus(row({ apy_cap_pct: null, apy: 1.2, seasons: [s(2026, 1, 0, 0, 0, 0, 0, 1)] }), NOV_2026).minimumLevel).toBe(true);
  });
});
