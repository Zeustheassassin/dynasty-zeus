import { describe, it, expect } from "vitest";
import {
  candidateEvidence, chartableSnaps, compareNames, decidePlayer, hisGames, isPostseasonGame, matchGames,
  noPlayerGames, normalizeName, opponentIsTeam, pffTeamSchool, positionFits, snapPick, teamSchedule,
  type ChartedGame, type HisGame,
} from "@/lib/pff/match";
import type { PffPlayer, PffScheduleGame, PffTeam, PffWeekRow } from "@/lib/pff/ncaa";

const team = (franchise_id: number, city: string): PffTeam => ({ franchise_id, city, abbreviation: city.slice(0, 6).toUpperCase(), nickname: "" });
const TEAMS = new Map<number, PffTeam>([
  [190, team(190, "Indiana")], [264, team(264, "Oregon")], [226, team(226, "Mississippi")],
  [220, team(220, "Miami (FL)")], [260, team(260, "Ohio State")], [224, team(224, "Mississippi State")],
]);

const player = (id: number, first: string, last: string, extra: Partial<PffPlayer> = {}): PffPlayer => ({
  id, first_name: first, last_name: last, position: "WR", dob: null, height: 601, weight: 200,
  current_class: "SR", current_eligible_year: 2026, team: { id: 190, abbreviation: "INDHOO", city: "Indiana", nickname: "Hoosiers" },
  ...extra,
});

let n = 0;
const game = (season: number, opponent: string, extra: Partial<ChartedGame> = {}): ChartedGame => ({
  id: `g${++n}`, season_year: season, opponent, game_type: "regular", game_slot: n, created_at: "2026-04-30T00:00:00Z", ...extra,
});

/** One of his PFF games: he plays for Indiana (190). */
const his = (pffGameId: number, week: number, opponentId: number, snaps: number | null, start = ""): HisGame => ({
  pffGameId, season: 2025, week, start, teamId: 190, opponentId, opponent: TEAMS.get(opponentId) ?? null, snaps,
});

describe("names", () => {
  it("drops suffixes, accents, apostrophes and periods", () => {
    expect(normalizeName("Harrison Wallace III")).toBe("harrison wallace");
    expect(normalizeName("Trey’Dez Green")).toBe("treydez green");
    expect(normalizeName("C.J. Bailey")).toBe("cj bailey");
    expect(normalizeName("Demond Williams Jr.")).toBe("demond williams");
  });

  it("calls a name exact, close or none", () => {
    expect(compareNames("CJ Bailey", { first_name: "C.J.", last_name: "Bailey" })).toBe("exact");
    expect(compareNames("Emmanuel Henderson", { first_name: "Emmanuel", last_name: "Henderson Jr." })).toBe("exact");
    expect(compareNames("Nick Singleton", { first_name: "Nicholas", last_name: "Singleton" })).toBe("close");
    expect(compareNames("Ryan Williams", { first_name: "Ryan", last_name: "Coleman-Williams" })).toBe("close");
    expect(compareNames("Ryan Williams", { first_name: "Bryan", last_name: "Williams" })).toBe("none");
    expect(compareNames("Ryan Williams", { first_name: "Ryan", last_name: "Williamson" })).toBe("none");
  });
});

describe("positions and schools", () => {
  it("fits PFF's directory and game-row positions", () => {
    expect(positionFits("WR", "WR")).toBe(true);
    expect(positionFits("WR", "SWR")).toBe(true);
    expect(positionFits("RB", "HB")).toBe(true);
    expect(positionFits("TE", "TE-L")).toBe(true);
    expect(positionFits("WR", "FB")).toBe(false);
    expect(positionFits("QB", null)).toBe(false);
  });

  it("maps PFF's school names to CFD's exactly", () => {
    expect(pffTeamSchool({ city: "Mississippi" })).toBe("Ole Miss");
    expect(pffTeamSchool({ city: "North Carolina State" })).toBe("NC State");
    expect(pffTeamSchool({ city: "Miami (FL)" })).toBe("Miami");
    expect(pffTeamSchool({ city: "Mississippi State" })).toBe("Mississippi State");
  });

  it("matches a charted opponent to a PFF team", () => {
    expect(opponentIsTeam("Ole Miss", TEAMS.get(226))).toBe(true);
    expect(opponentIsTeam("Ole Miss", TEAMS.get(224))).toBe(false);
    expect(opponentIsTeam("Miami - CFP", TEAMS.get(220))).toBe(true);
    expect(opponentIsTeam("Flordia State", { city: "Florida State" })).toBe(true);
    expect(opponentIsTeam("Manual-Check-Opponent", TEAMS.get(260))).toBe(false);
    // A name the user taught by linking another game.
    expect(opponentIsTeam("The Bucks", TEAMS.get(260))).toBe(false);
    expect(opponentIsTeam("The Bucks", TEAMS.get(260), new Map([["thebucks", "Ohio State"]]))).toBe(true);
  });

  it("reads postseason from the game type or a tag", () => {
    expect(isPostseasonGame({ opponent: "Oregon CFP", game_type: "regular" })).toBe(true);
    expect(isPostseasonGame({ opponent: "Alabama CC", game_type: "regular" })).toBe(true);
    expect(isPostseasonGame({ opponent: "Alabama", game_type: "bowl" })).toBe(true);
    expect(isPostseasonGame({ opponent: "Oregon", game_type: "regular" })).toBe(false);
  });
});

describe("his games", () => {
  const row = (game_id: number, week: number, home: number, away: number, stats: Record<string, number> = {}): PffWeekRow => ({
    game_id, week, player_franchise_id: 190, home_franchise_id: home, away_franchise_id: away, home_team_name: "", away_team_name: "", ...stats,
  });

  it("finds the opponent whether he was home or away, with kickoff from the schedule", () => {
    const sched: PffScheduleGame[] = [{ id: 1, home_franchise_id: 264, away_franchise_id: 190, week: 7, start: "2025-10-11T19:30:00Z" }];
    const g = hisGames([row(1, 7, 264, 190, { snap_counts_total: 66 }), row(2, 8, 190, 226)], 2025, TEAMS, sched, "WR");
    expect(g.map((h) => [h.opponent?.city, h.start, h.snaps])).toEqual([["Oregon", "2025-10-11T19:30:00Z", 66], ["Mississippi", "", null]]);
  });

  it("counts a QB's snaps the way he's charted: pass plays plus his own runs, no handoffs", () => {
    const r = row(1, 1, 190, 264, { snap_counts_total: 56, snap_counts_pass: 29, snap_counts_run: 4 });
    expect(chartableSnaps(r, "QB")).toBe(33);
    expect(chartableSnaps(r, "WR")).toBe(56);
  });

  it("lists a team's whole schedule", () => {
    const sched: PffScheduleGame[] = [
      { id: 1, home_franchise_id: 264, away_franchise_id: 190, week: 7, start: "a" },
      { id: 2, home_franchise_id: 226, away_franchise_id: 224, week: 7, start: "b" },
    ];
    expect(teamSchedule([190], 2025, TEAMS, sched).map((h) => [h.pffGameId, h.opponent?.city])).toEqual([[1, "Oregon"]]);
  });
});

describe("snapPick", () => {
  const a = his(1, 7, 264, 66);
  const b = his(2, 19, 264, 57);
  it("picks the game the charted plays match when the other is clearly off", () => {
    expect(snapPick(66, [a, b])).toBe(a);
    expect(snapPick(57, [a, b])).toBe(b);
  });

  it("allows a few skipped plays under PFF's count but hardly any over it", () => {
    expect(snapPick(63, [a, b])).toBe(a); // 3 under 66
    expect(snapPick(60, [a, b])).toBeNull(); // 3 over 57 and 6 under 66: unclear
  });

  it("leaves a tie or a missing count to the user", () => {
    expect(snapPick(71, [his(1, 11, 264, 71), his(2, 17, 264, 71)])).toBeNull();
    expect(snapPick(68, [his(1, 11, 264, 72), his(2, 17, 264, 68)])).toBeNull(); // the other is only 4 off
    expect(snapPick(null, [a, b])).toBeNull();
    expect(snapPick(66, [a, his(2, 19, 264, null)])).toBeNull();
  });
});

describe("decidePlayer", () => {
  const prospect = { name: "Elijah Sarratt", position: "WR", school: "Indiana", birthday: "2003-01-01" };
  const games = [game(2025, "Oregon"), game(2025, "Ole Miss"), game(2025, "Ohio State")];
  const log = (...opps: number[]) => new Map([[2025, opps.map((o, i) => his(100 + i, i + 1, o, 60))]]);

  it("auto-links the one candidate who played the charted games", () => {
    const e = candidateEvidence(prospect, player(7, "Elijah", "Sarratt"), games, log(264, 226, 260));
    expect(e).toMatchObject({ name: "exact", positionOk: true, schoolOk: true, gamesFound: 3, gamesChecked: 3 });
    expect(decidePlayer(prospect, [e])).toMatchObject({ status: "auto", playerId: 7 });
  });

  it("still auto-links when only PFF's birthday or position disagrees, and says so", () => {
    const e = candidateEvidence(prospect, player(7, "Elijah", "Sarratt", { dob: "2002-12-31", position: "FB" }), games, log(264, 226, 260));
    const d = decidePlayer(prospect, [e]);
    expect(d.status).toBe("auto");
    expect(d.note).toContain("birthday differs (PFF 2002-12-31)");
    expect(d.note).toContain("PFF lists him at FB");
  });

  it("asks when two candidates played his opponents, or too few games were found", () => {
    const a = candidateEvidence(prospect, player(7, "Elijah", "Sarratt"), games, log(264, 226, 260));
    const b = candidateEvidence(prospect, player(8, "Elijah", "Sarratt"), games, log(264));
    expect(decidePlayer(prospect, [a, b])).toMatchObject({ status: "review", playerId: 7 });
    const thin = candidateEvidence(prospect, player(7, "Elijah", "Sarratt"), games, log(264));
    expect(decidePlayer(prospect, [thin])).toMatchObject({ status: "review", playerId: 7 });
  });

  it("links on name, position and school when there are no charted games", () => {
    const p = { ...prospect, birthday: null };
    expect(decidePlayer(p, [candidateEvidence(p, player(7, "Elijah", "Sarratt"), [], null)])).toMatchObject({ status: "auto", playerId: 7 });
    const moved = player(7, "Elijah", "Sarratt", { team: { id: 1, abbreviation: "X", city: "Auburn", nickname: "" } });
    const d = decidePlayer(p, [candidateEvidence(p, moved, [], null)]);
    expect(d).toMatchObject({ status: "review", playerId: 7 });
    expect(d.note).toContain("PFF's current team is Auburn");
  });

  it("reports no player when nobody by that name turns up", () => {
    const e = candidateEvidence(prospect, player(9, "Bryan", "Williams"), games, log(264));
    expect(decidePlayer(prospect, [e])).toMatchObject({ status: "not_found", playerId: null });
    expect(decidePlayer(prospect, [])).toMatchObject({ status: "not_found" });
  });
});

describe("matchGames", () => {
  it("matches each charted game to his game against that opponent", () => {
    const g = game(2025, "Ole Miss");
    const d = matchGames([g], new Map([[2025, [his(10, 8, 226, 45), his(11, 9, 224, 50)]]]), new Map());
    expect(d).toEqual([expect.objectContaining({ gameId: g.id, status: "auto", pffGameId: 10 })]);
  });

  it("settles a rematch by snap count, or leaves it to the user", () => {
    const fits = [his(20, 8, 226, 43, "2025-10-18"), his(21, 18, 226, 50, "2026-01-02")];
    const clear = game(2025, "Ole Miss", { snaps_charted: 50 });
    const unclear = game(2025, "Ole Miss", { snaps_charted: 47 });
    expect(matchGames([clear], new Map([[2025, fits]]), new Map())[0]).toMatchObject({ status: "auto", pffGameId: 21 });
    expect(matchGames([unclear], new Map([[2025, fits]]), new Map())[0]).toMatchObject({ status: "review", pffGameId: 20 });
  });

  it("takes the postseason game for a charted game labelled postseason", () => {
    const fits = [his(30, 7, 264, null, "2025-10-11"), his(31, 19, 264, null, "2026-01-10")];
    const d = matchGames([game(2025, "Oregon CFP")], new Map([[2025, fits]]), new Map());
    expect(d[0]).toMatchObject({ status: "auto", pffGameId: 31 });
  });

  it("pairs two charted games vs the same opponent by snaps but always asks", () => {
    const fits = [his(30, 7, 264, 66, "2025-10-11"), his(31, 19, 264, 57, "2026-01-10")];
    const late = game(2025, "Oregon", { game_slot: 4, snaps_charted: 57 });
    const early = game(2025, "Oregon", { game_slot: 9, snaps_charted: 66 });
    const d = matchGames([late, early], new Map([[2025, fits]]), new Map());
    expect(d.find((x) => x.gameId === late.id)).toMatchObject({ status: "review", pffGameId: 31 });
    expect(d.find((x) => x.gameId === early.id)).toMatchObject({ status: "review", pffGameId: 30 });
    expect(d[0].note).toContain("paired by snap count");
  });

  it("tells a game PFF has no row for him in from a game that doesn't exist", () => {
    const sched = [his(40, 9, 220, null)];
    const notCharted = game(2025, "Miami");
    const noMatch = game(2025, "Mississippi State");
    const unreadable = game(2025, "Manual-Check-Opponent");
    const d = matchGames([notCharted, noMatch, unreadable], new Map([[2025, [his(10, 8, 226, 45)]]]), new Map([[2025, sched]]));
    expect(d.find((x) => x.gameId === notCharted.id)).toMatchObject({ status: "not_charted", pffGameId: 40, lookup: { season: 2025, week: 9, teamId: 190 } });
    expect(d.find((x) => x.gameId === noMatch.id)).toMatchObject({ status: "no_match", pffGameId: null });
    expect(d.find((x) => x.gameId === unreadable.id)?.note).toContain("Couldn't read the opponent");
  });

  it("matches a game typed like one the user linked by hand before", () => {
    const g = game(2025, "Ole Miss Rebels Football");
    const fits = new Map([[2025, [his(10, 8, 226, 45)]]]);
    expect(matchGames([g], fits, new Map())[0]).toMatchObject({ status: "no_match" });
    expect(matchGames([g], fits, new Map(), new Map([["olemissrebelsfootball", "Ole Miss"]]))[0]).toMatchObject({ status: "auto", pffGameId: 10 });
  });

  it("never touches the user's calls, and doesn't reuse their PFF games", () => {
    const mine = game(2025, "Oregon", { pff_match_status: "confirmed", pff_game_id: 30 });
    const ruledOut = game(2025, "Ole Miss", { pff_match_status: "none", pff_game_id: null });
    const other = game(2025, "Oregon");
    const fits = [his(30, 7, 264, 66), his(31, 19, 264, 57)];
    const d = matchGames([mine, ruledOut, other], new Map([[2025, fits]]), new Map());
    expect(d.map((x) => x.gameId)).toEqual([other.id]);
    expect(d[0]).toMatchObject({ status: "auto", pffGameId: 31 });
    expect(noPlayerGames([mine, ruledOut, other], "No PFF player linked").map((x) => x.gameId)).toEqual([other.id]);
  });
});
