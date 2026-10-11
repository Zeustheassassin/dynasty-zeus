import { describe, it, expect } from "vitest";
import { parseEspnScoreboard, findIncompleteLiveGames, type EspnEvent } from "@/lib/espnScoreboard";
import fixture from "../fixtures/espn-scoreboard-mnf-2026-09-21.json";

// Contract test against what ESPN ACTUALLY sent during a real game — NYG @ LAR, Monday Night Football
// 2026-09-21, recorded every 90s by scripts/capture-live-fixtures.mjs (the Gameday live-accuracy work
// had only documented shapes until this capture was checked, 2026-10-11). What the capture showed:
//   - every live snapshot carried period, clock (seconds) and displayClock;
//   - halftime is STATUS_HALFTIME and the break between quarters STATUS_END_PERIOD, both state "in";
//   - situation.possession is the team id as a STRING ("19" = NYG, "14" = LAR) and is missing
//     between some plays.
// If ESPN changes any of that, these fail here instead of the Gameday model quietly falling back.

const parse = (e: unknown) => parseEspnScoreboard([e as EspnEvent]);

describe("ESPN scoreboard contract (real MNF capture)", () => {
  it("reads a live game's quarter, clock, score and who has the ball", () => {
    const byTeam = parse(fixture.live);
    expect(byTeam.NYG).toMatchObject({
      state: "Live", period: 1, clockSeconds: 894, clockDisplay: "14:54",
      score: 0, oppScore: 0, opponent: "LAR", hasPossession: true,
    });
    expect(byTeam.LAR).toMatchObject({ state: "Live", period: 1, clockSeconds: 894, opponent: "NYG" });
    expect(byTeam.LAR.hasPossession).toBeUndefined();
    expect(byTeam.NYG.kickoffAt).toBe(Date.parse("2026-09-22T00:15Z"));
    expect(findIncompleteLiveGames(byTeam)).toEqual([]);
  });

  it("gives neither team the ball when ESPN leaves possession out between plays", () => {
    const byTeam = parse(fixture.noPossession.event);
    expect(byTeam.NYG.state).toBe("Live");
    expect(byTeam.NYG.hasPossession).toBeUndefined();
    expect(byTeam.LAR.hasPossession).toBeUndefined();
    expect(findIncompleteLiveGames(byTeam)).toEqual([]);
  });

  it("marks halftime as a live game on a break", () => {
    const byTeam = parse(fixture.halftime.event);
    expect(byTeam.NYG).toMatchObject({ state: "Live", status: "halftime", period: 2, clockSeconds: 0 });
    expect(findIncompleteLiveGames(byTeam)).toEqual([]);
  });

  it("keeps the break between quarters live, at 0:00 of the quarter just ended", () => {
    const byTeam = parse(fixture.endPeriod.event);
    expect(byTeam.NYG).toMatchObject({ state: "Live", period: 3, clockSeconds: 0 });
    expect(byTeam.NYG.status).toBeUndefined();
    expect(findIncompleteLiveGames(byTeam)).toEqual([]);
  });

  it("reads the final score", () => {
    const byTeam = parse(fixture.final.event);
    expect(byTeam.LAR).toMatchObject({ state: "Final", score: 28, oppScore: 6 });
    expect(byTeam.NYG).toMatchObject({ state: "Final", score: 6, oppScore: 28 });
    expect(byTeam.NYG.clockSeconds).toBeUndefined();
  });
});
