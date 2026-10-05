// Finds a charted game's CollegeFootballData game, for its venue, kickoff,
// final score and the two teams' SP+ (tape-grading expansion, Stage 5).
// Pure; client-safe.
//
// The charted opponent is free text and occasionally wrong (two 2025 games
// name the wrong school), so a game linked to PFF is matched through PFF's
// game instead: its two teams (PFF names resolved to CFD's) and its kickoff
// pick the CFD game, and the opponent comes from that game. Rematches (a
// conference title game, a bowl) are told apart by the kickoff date. Only a
// game with no PFF link falls back to the charted opponent, and then only
// when his team plays that opponent once that season.

import type { CfdGameRow } from "./types";

export type CfdMatchStatus = "auto" | "no_match";

/** One charted game, with what's known about its PFF game. */
export interface CfdMatchInput {
  season: number;
  /** The charted opponent (free text), resolved to a CFD school when possible. */
  chartedOpponentSchool: string | null;
  /** Postseason by the charted label (CFP, bowl, title game). */
  chartedPostseason: boolean;
  /** His team (CFD school) that season, from PFF or the prospect's school. */
  teamSchool: string | null;
  /** The linked PFF game, when there is one. */
  pff: {
    homeSchool: string | null;
    awaySchool: string | null;
    /** Kickoff, ISO. */
    start: string | null;
  } | null;
}

export interface CfdMatch {
  status: CfdMatchStatus;
  cfdGameId: number | null;
  /** His team and the opponent, as CFD names them. */
  teamSchool: string | null;
  opponentSchool: string | null;
  note: string;
}

const DAY_MS = 86_400_000;
/** PFF's and CFD's kickoffs for the same game agree to the minute in practice; a day covers time-zone slips. */
const MAX_START_GAP_MS = 1.5 * DAY_MS;

const startGap = (a: string | null, b: string | null): number => {
  if (!a || !b) return Infinity;
  const d = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isFinite(d) ? d : Infinity;
};

const involves = (g: CfdGameRow, school: string) => g.home_team === school || g.away_team === school;
const otherTeam = (g: CfdGameRow, school: string) => (g.home_team === school ? g.away_team : g.home_team);

function closest(games: readonly CfdGameRow[], start: string | null): CfdGameRow | null {
  let best: CfdGameRow | null = null, bestGap = MAX_START_GAP_MS;
  for (const g of games) {
    const gap = startGap(g.start_date, start);
    if (gap <= bestGap) { best = g; bestGap = gap; }
  }
  return best;
}

const found = (g: CfdGameRow, team: string | null, note: string): CfdMatch => {
  const teamSchool = team && involves(g, team) ? team : null;
  return {
    status: "auto",
    cfdGameId: g.id,
    teamSchool,
    opponentSchool: teamSchool ? otherTeam(g, teamSchool) : null,
    note,
  };
};

const none = (inp: CfdMatchInput, note: string): CfdMatch => ({
  status: "no_match", cfdGameId: null, teamSchool: inp.teamSchool, opponentSchool: inp.chartedOpponentSchool, note,
});

/** Matches one charted game against the CFD games of its season. */
export function matchCfdGame(inp: CfdMatchInput, seasonGames: readonly CfdGameRow[]): CfdMatch {
  const games = seasonGames.filter((g) => g.season === inp.season);
  if (games.length === 0) return none(inp, `No CollegeFootballData schedule for ${inp.season} yet`);

  const pff = inp.pff;
  if (pff) {
    const { homeSchool: a, awaySchool: b } = pff;
    // His side of PFF's game: the team he played for, else whichever side isn't the charted opponent.
    const team = inp.teamSchool && (inp.teamSchool === a || inp.teamSchool === b)
      ? inp.teamSchool
      : a && b && inp.chartedOpponentSchool
        ? (inp.chartedOpponentSchool === a ? b : inp.chartedOpponentSchool === b ? a : inp.teamSchool)
        : inp.teamSchool;
    if (a && b) {
      const g = closest(games.filter((x) => involves(x, a) && involves(x, b)), pff.start);
      if (g) return found(g, team, "Matched through the PFF game");
    }
    // One PFF team isn't among CFD's names (an FCS spelling): the known team's game that day.
    const known = [a, b].filter((s): s is string => !!s);
    for (const s of known) {
      const g = closest(games.filter((x) => involves(x, s)), pff.start);
      if (g) return found(g, team, `Matched through the PFF game's date (${s})`);
    }
    if (!pff.start && !known.length) return none(inp, "The PFF game has no teams or kickoff to match");
    return none(inp, "No CollegeFootballData game matches the PFF game");
  }

  // No PFF link: his team against the charted opponent, if they met once (or once in the postseason).
  const team = inp.teamSchool, opp = inp.chartedOpponentSchool;
  if (!opp) return none(inp, "The charted opponent isn't a recognized team");
  if (!team) return none(inp, "His team that season isn't known (link the game to PFF)");
  const meetings = games.filter((x) => involves(x, team) && involves(x, opp));
  if (meetings.length === 0) return none(inp, `${team} didn't play ${opp} in ${inp.season}`);
  if (meetings.length === 1) return found(meetings[0], team, "Matched by the charted opponent");
  const post = meetings.filter((x) => x.season_type === "postseason");
  const pick = inp.chartedPostseason ? post : meetings.filter((x) => x.season_type !== "postseason");
  if (pick.length === 1) return found(pick[0], team, "Matched by the charted opponent (rematch, by its label)");
  return none(inp, `${team} played ${opp} ${meetings.length} times in ${inp.season}; link the game to PFF to tell them apart`);
}
