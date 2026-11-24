import { describe, it, expect } from "vitest";
import { hubHeaderBreakdown, type HubHeaderProspect } from "../../../lib/scouting/hubHeaderCounts";
import type { ChartingDecision } from "../../../lib/types";

// 2026-11-24, the user: the Scouting Hub header as
// "RB: Prospects · Full · Partial · Logged · (Actual Charted Games) · (Actual
// Charted Snaps)" under one colour key. "Only mark Partial if i hand charted a
// Snap. If it only has logged games … then put in logged."

const P = ["QB", "RB", "WR", "TE"];
const prospect = (id: string, position: string, charting_decision: ChartingDecision, draft_class_year = 2027): HubHeaderProspect =>
  ({ id, position, draft_class_year, charting_decision });

describe("hubHeaderBreakdown", () => {
  it("splits Partial Chart into Partial (a charted snap) and Logged (logged games only)", () => {
    const prospects = [
      prospect("full", "RB", "fully_charted"),
      prospect("charted", "RB", "partial_chart"),
      prospect("snapsOnly", "RB", "partial_chart"),
      prospect("logged1", "RB", "partial_chart"),
      prospect("logged2", "RB", "partial_chart"),
      prospect("undecided", "RB", "pending"),
    ];
    const chartedGames = new Map([["full", 10], ["charted", 2]]);
    const snaps = new Map([["full", 400], ["charted", 60], ["snapsOnly", 5]]);
    const [{ year, positions }] = hubHeaderBreakdown(prospects, chartedGames, snaps, P);
    expect(year).toBe(2027);
    expect(positions.find((r) => r.pos === "RB")).toEqual(
      { pos: "RB", prospects: 6, full: 1, partial: 2, logged: 2, games: 12, snaps: 465 },
    );
  });

  it("counts charted games only, and reads Games as null when the per-game counts didn't load", () => {
    const prospects = [prospect("a", "WR", "partial_chart"), prospect("b", "WR", "partial_chart")];
    const snaps = new Map([["a", 30]]);
    const wr = (rows: ReturnType<typeof hubHeaderBreakdown>) => rows[0].positions.find((r) => r.pos === "WR");
    expect(wr(hubHeaderBreakdown(prospects, new Map([["a", 1]]), snaps, P))).toMatchObject({ games: 1, partial: 1, logged: 1 });
    expect(wr(hubHeaderBreakdown(prospects, null, snaps, P))).toMatchObject({ games: null, partial: 1, logged: 1, snaps: 30 });
  });

  // "probably should have TE 0 · 0 · 0 · 0 · 0 · 0 For 2026 TE's also to look clean"
  it("orders classes oldest first and lists every position as given, all zeros where the class has none", () => {
    const prospects = [
      prospect("te", "TE", "pending", 2028),
      prospect("qb", "QB", "pending", 2026),
      prospect("wr", "WR", "pending", 2028),
    ];
    const out = hubHeaderBreakdown(prospects, new Map(), new Map(), P);
    expect(out.map((y) => y.year)).toEqual([2026, 2028]);
    expect(out[0].positions.map((r) => r.pos)).toEqual(["QB", "RB", "WR", "TE"]);
    expect(out[0].positions[3]).toEqual({ pos: "TE", prospects: 0, full: 0, partial: 0, logged: 0, games: 0, snaps: 0 });
  });
});
