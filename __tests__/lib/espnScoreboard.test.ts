import { describe, it, expect } from "vitest";
import { parseEspnScoreboard, findIncompleteLiveGames, type EspnEvent } from "@/lib/espnScoreboard";

// Payload shapes mirror real site.api.espn.com scoreboard responses (verified
// against a live week-2/3 pull: pre = STATUS_SCHEDULED, post = STATUS_FINAL).
const event = (opts: {
  name: string;
  state: string;
  period?: number;
  clock?: number;
  displayClock?: string;
  home: { id: string; abbr: string; score: string };
  away: { id: string; abbr: string; score: string };
  possession?: string;
}): EspnEvent => ({
  date: "2026-09-27T17:00Z",
  competitions: [{
    date: "2026-09-27T17:00Z",
    status: {
      clock: opts.clock ?? 0,
      displayClock: opts.displayClock ?? "0:00",
      period: opts.period ?? 0,
      type: { name: opts.name, state: opts.state },
    },
    competitors: [
      { id: opts.home.id, score: opts.home.score, team: { id: opts.home.id, abbreviation: opts.home.abbr } },
      { id: opts.away.id, score: opts.away.score, team: { id: opts.away.id, abbreviation: opts.away.abbr } },
    ],
    ...(opts.possession ? { situation: { possession: opts.possession } } : {}),
  }],
});

const SF = { id: "25", abbr: "SF" };
const ARI = { id: "22", abbr: "ARI" };

describe("parseEspnScoreboard", () => {
  it("maps a scheduled game to Upcoming with no live detail", () => {
    const out = parseEspnScoreboard([event({ name: "STATUS_SCHEDULED", state: "pre", home: { ...SF, score: "0" }, away: { ...ARI, score: "0" } })]);
    // Opponent is known before kickoff (same-game correlation needs it); score/clock are not.
    expect(out.SF).toEqual({ kickoffAt: Date.parse("2026-09-27T17:00Z"), state: "Upcoming", opponent: "ARI" });
    expect(out.ARI).toEqual({ kickoffAt: Date.parse("2026-09-27T17:00Z"), state: "Upcoming", opponent: "SF" });
  });

  it("captures period, clock, score, opponent and possession for a live game — from each team's own side", () => {
    const out = parseEspnScoreboard([event({
      name: "STATUS_IN_PROGRESS", state: "in", period: 3, clock: 252, displayClock: "4:12",
      home: { ...SF, score: "17" }, away: { ...ARI, score: "10" }, possession: "25",
    })]);
    expect(out.SF).toMatchObject({
      state: "Live", period: 3, clockSeconds: 252, clockDisplay: "4:12",
      score: 17, oppScore: 10, opponent: "ARI", hasPossession: true,
    });
    expect(out.ARI).toMatchObject({ state: "Live", score: 10, oppScore: 17, opponent: "SF" });
    expect(out.ARI.hasPossession).toBeUndefined();
  });

  it("flags halftime (ESPN reports it as state 'in')", () => {
    const out = parseEspnScoreboard([event({
      name: "STATUS_HALFTIME", state: "in", period: 2, home: { ...SF, score: "14" }, away: { ...ARI, score: "13" },
    })]);
    expect(out.SF).toMatchObject({ state: "Live", status: "halftime", period: 2 });
  });

  it("keeps the final score on a Final game and drops live-only fields", () => {
    const out = parseEspnScoreboard([event({
      name: "STATUS_FINAL", state: "post", period: 4, home: { ...SF, score: "24" }, away: { ...ARI, score: "20" },
    })]);
    expect(out.SF).toMatchObject({ state: "Final", score: 24, oppScore: 20, opponent: "ARI" });
    expect(out.SF.period).toBeUndefined();
    expect(out.SF.clockSeconds).toBeUndefined();
  });

  it("keeps a postponed game Upcoming (not Final, even if ESPN says post) and a canceled one Final", () => {
    const postponed = parseEspnScoreboard([event({ name: "STATUS_POSTPONED", state: "post", home: { ...SF, score: "0" }, away: { ...ARI, score: "0" } })]);
    expect(postponed.SF).toMatchObject({ state: "Upcoming", status: "postponed" });
    const canceled = parseEspnScoreboard([event({ name: "STATUS_CANCELED", state: "post", home: { ...SF, score: "0" }, away: { ...ARI, score: "0" } })]);
    expect(canceled.SF).toMatchObject({ state: "Final", status: "canceled" });
  });

  it("flags a delay while keeping the game's real Live/Upcoming state", () => {
    const live = parseEspnScoreboard([event({ name: "STATUS_DELAYED", state: "in", period: 2, clock: 400, home: { ...SF, score: "7" }, away: { ...ARI, score: "3" } })]);
    expect(live.SF).toMatchObject({ state: "Live", status: "delayed" });
    const pre = parseEspnScoreboard([event({ name: "STATUS_DELAYED", state: "pre", home: { ...SF, score: "0" }, away: { ...ARI, score: "0" } })]);
    expect(pre.SF).toMatchObject({ state: "Upcoming", status: "delayed" });
  });

  it("publishes WSH under Sleeper's WAS spelling too", () => {
    const out = parseEspnScoreboard([event({
      name: "STATUS_SCHEDULED", state: "pre", home: { id: "28", abbr: "WSH", score: "0" }, away: { id: "26", abbr: "SEA", score: "0" },
    })]);
    expect(out.WSH).toBeDefined();
    expect(out.WAS).toBe(out.WSH);
  });

  it("skips events with no usable date or state instead of throwing", () => {
    expect(parseEspnScoreboard([{}, { competitions: [{}] }, { date: "not-a-date", status: { type: { state: "in" } } }])).toEqual({});
  });
});

describe("findIncompleteLiveGames", () => {
  const live = (over: object) => ({ kickoffAt: 1, state: "Live" as const, ...over });

  it("flags live games missing a period or clock — the sign ESPN's shape drifted", () => {
    expect(findIncompleteLiveGames({
      SF: live({ period: 3, clockSeconds: 252 }),
      ARI: live({ period: 3 }),        // no clock
      DAL: live({ clockSeconds: 100 }), // no period
      SEA: live({}),
    }).sort()).toEqual(["ARI", "DAL", "SEA"]);
  });

  it("does not flag complete live games, halftime, or non-live games", () => {
    expect(findIncompleteLiveGames({
      SF: live({ period: 3, clockSeconds: 0 }),
      ARI: live({ status: "halftime", period: 2 }),
      DAL: { kickoffAt: 1, state: "Upcoming" },
      SEA: { kickoffAt: 1, state: "Final" },
    })).toEqual([]);
  });

  it("a parsed live payload with a clock comes back complete", () => {
    const out = parseEspnScoreboard([event({
      name: "STATUS_IN_PROGRESS", state: "in", period: 2, clock: 480, displayClock: "8:00",
      home: { ...SF, score: "7" }, away: { ...ARI, score: "3" },
    })]);
    expect(findIncompleteLiveGames(out)).toEqual([]);
  });
});
