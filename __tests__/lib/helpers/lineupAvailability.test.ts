import { describe, it, expect } from "vitest";
import {
  INACTIVES_LEAD_MS,
  isAvailabilityExcluded,
  isLateScratchRisk,
  getLatePivotRisks,
  getLineupAvailabilityChecks,
  lineupWeekKey,
  type LatePivotRiskInput,
} from "@/lib/helpers/lineupAvailability";
import type { InjuryNewsFlag } from "@/lib/helpers/injuryNews";
import type { LineupCoachRow, SleeperPlayer } from "@/lib/types";

const mk = (id: string, position: string, injury: string | null = null): SleeperPlayer =>
  ({ player_id: id, full_name: id, position, team: "T", injury_status: injury } as SleeperPlayer);

const outNote: InjuryNewsFlag = { lean: "likely-out", comment: "X is unlikely to suit up.", date: null };
const inNote: InjuryNewsFlag = { lean: "likely-in", comment: "X is expected to play.", date: null };
const unsureNote: InjuryNewsFlag = { lean: "uncertain", comment: "X is a game-time decision.", date: null };

describe("lineupWeekKey", () => {
  it("joins season and week", () => {
    expect(lineupWeekKey("2026", 5)).toBe("2026:5");
    expect(lineupWeekKey(2026, 5)).toBe("2026:5");
  });
});

describe("isAvailabilityExcluded", () => {
  it("excludes a player the user marked out", () => {
    expect(isAvailabilityExcluded("a", { a: "OUT" }, {})).toBe(true);
  });
  it("excludes a player whose ESPN note says he's likely out", () => {
    expect(isAvailabilityExcluded("a", {}, { a: outNote })).toBe(true);
  });
  it("lets 'start anyway' override the news", () => {
    expect(isAvailabilityExcluded("a", { a: "IN" }, { a: outNote })).toBe(false);
  });
  it("leaves uncertain and likely-in reads alone", () => {
    expect(isAvailabilityExcluded("a", {}, { a: unsureNote })).toBe(false);
    expect(isAvailabilityExcluded("a", {}, { a: inNote })).toBe(false);
    expect(isAvailabilityExcluded("a", {}, {})).toBe(false);
  });
});

describe("isLateScratchRisk", () => {
  it("flags Questionable and Doubtful players", () => {
    expect(isLateScratchRisk(mk("a", "WR", "Questionable"), undefined, undefined)).toBe(true);
    expect(isLateScratchRisk(mk("a", "WR", "Doubtful"), undefined, undefined)).toBe(true);
  });
  it("does not flag a healthy player", () => {
    expect(isLateScratchRisk(mk("a", "WR"), undefined, undefined)).toBe(false);
  });
  it("does not flag a Questionable player whose note says he'll play", () => {
    expect(isLateScratchRisk(mk("a", "WR", "Questionable"), undefined, inNote)).toBe(false);
  });
  it("does not flag a player the user already made a call on", () => {
    expect(isLateScratchRisk(mk("a", "WR", "Questionable"), "IN", undefined)).toBe(false);
    expect(isLateScratchRisk(mk("a", "WR", "Questionable"), "OUT", undefined)).toBe(false);
  });
});

describe("getLatePivotRisks", () => {
  // Sunday 2026-10-04 (UTC): 1 PM ET games at 17:00, SNF at 00:20 the next day.
  const early = Date.parse("2026-10-04T17:00:00Z");
  const late = Date.parse("2026-10-05T00:20:00Z");
  const now = Date.parse("2026-10-04T15:45:00Z");

  const players: Record<string, SleeperPlayer> = {
    coker: mk("coker", "WR", "Questionable"),
    wrEarly: mk("wrEarly", "WR"),
    wrLate: mk("wrLate", "WR"),
    rbEarly: mk("rbEarly", "RB"),
  };
  const kickoffs: Record<string, number> = { coker: late, wrEarly: early, wrLate: late, rbEarly: early };
  const scores: Record<string, number> = { coker: 12, wrEarly: 8, wrLate: 6, rbEarly: 9 };
  const row = (slot: string, id: string): LineupCoachRow =>
    ({ slot, player: players[id], score: scores[id], kickoffAt: kickoffs[id] });

  const base = (over: Partial<LatePivotRiskInput>): LatePivotRiskInput => ({
    lineup: [row("WR", "coker")],
    playerIds: ["coker", "wrEarly", "rbEarly"],
    players,
    scoreFn: (id) => scores[id] ?? 0,
    kickoffFn: (id) => kickoffs[id] ?? null,
    isRiskFn: (id) => id === "coker",
    isUnavailableFn: () => false,
    ...over,
  });

  it("warns when every bench player who fits the slot kicks off before inactives", () => {
    const risks = getLatePivotRisks(base({}), now);
    expect(risks).toHaveLength(1);
    expect(risks[0].player.player_id).toBe("coker");
    expect(risks[0].decisionAt).toBe(late - INACTIVES_LEAD_MS);
    expect(risks[0].pivots).toEqual([]); // wrEarly locks first; rbEarly can't play WR
  });

  it("lists a bench player in the same late window as the pivot", () => {
    const risks = getLatePivotRisks(base({ playerIds: ["coker", "wrEarly", "wrLate"] }), now);
    expect(risks[0].pivots.map((p) => p.player_id)).toEqual(["wrLate"]);
  });

  it("counts flex-eligible bench players for a FLEX slot", () => {
    const risks = getLatePivotRisks(base({
      lineup: [row("FLEX", "coker")],
      kickoffFn: (id) => (id === "rbEarly" ? late : kickoffs[id] ?? null),
    }), now);
    expect(risks[0].pivots.map((p) => p.player_id)).toEqual(["rbEarly"]);
  });

  it("skips pivots who are out, marked out, or projected for nothing", () => {
    const withLate = { playerIds: ["coker", "wrLate"] };
    expect(getLatePivotRisks(base({ ...withLate, isUnavailableFn: (id) => id === "wrLate" }), now)[0].pivots).toEqual([]);
    expect(getLatePivotRisks(base({ ...withLate, scoreFn: (id) => (id === "wrLate" ? 0 : scores[id]) }), now)[0].pivots).toEqual([]);
  });

  it("never offers another starter as a pivot", () => {
    const risks = getLatePivotRisks(base({
      lineup: [row("WR", "coker"), row("WR", "wrLate")],
      playerIds: ["coker", "wrLate"],
    }), now);
    expect(risks[0].pivots).toEqual([]);
  });

  it("drops off once the inactive call is due", () => {
    expect(getLatePivotRisks(base({}), late - INACTIVES_LEAD_MS)).toEqual([]);
  });

  it("ignores healthy starters and players with no known kickoff", () => {
    expect(getLatePivotRisks(base({ isRiskFn: () => false }), now)).toEqual([]);
    expect(getLatePivotRisks(base({ kickoffFn: () => null }), now)).toEqual([]);
  });
});

describe("getLineupAvailabilityChecks", () => {
  const players: Record<string, SleeperPlayer> = {
    q: mk("q", "WR", "Questionable"),
    out: mk("out", "WR", "Out"),
    ok: mk("ok", "WR"),
  };

  it("builds the exclusion, risk and unavailable checks from one source", () => {
    const checks = getLineupAvailabilityChecks({ players, news: { q: outNote }, overrides: { ok: "OUT" } });
    expect(checks.isExcludedFn("q")).toBe(true); // news says out
    expect(checks.isExcludedFn("ok")).toBe(true); // marked out
    expect(checks.isExcludedFn("out")).toBe(false); // the official tag is the optimizer's own gate
    expect(checks.isUnavailableFn("out")).toBe(true);
    expect(checks.isUnavailableFn("q")).toBe(true);
    expect(checks.isRiskFn("q")).toBe(true);
    expect(checks.isRiskFn("ok")).toBe(false);
    expect(checks.isRiskFn("missing")).toBe(false);
  });
});
