// ============================================================
// ESPN scoreboard → per-team live game state.
// Pure parsing, kept out of app/api/nfl-scoreboard/route.ts (a Next route
// file can only export handlers) so it can be unit-tested against real
// payload shapes.
// ============================================================
import type { TeamGameState } from "./types";

// Sleeper and ESPN disagree on a couple of team abbreviations. Populate the
// result under both spellings so a lookup by either source's abbreviation hits.
const TEAM_ABBR_ALIASES: Record<string, string[]> = {
  WSH: ["WAS"],
};

type GameState = TeamGameState["state"];
type GameStatus = NonNullable<TeamGameState["status"]>;

interface EspnCompetitor {
  id?: string;
  score?: string | number;
  team?: { id?: string; abbreviation?: string };
}
interface EspnStatus {
  clock?: number;
  displayClock?: string;
  period?: number;
  type?: { name?: string; state?: string };
}
interface EspnCompetition {
  date?: string;
  competitors?: EspnCompetitor[];
  status?: EspnStatus;
  situation?: { possession?: string | number };
}
export interface EspnEvent {
  date?: string;
  status?: EspnStatus;
  competitions?: EspnCompetition[];
}

/** ESPN's `state` is only pre/in/post; the status *name* is what says
 *  halftime / delayed / postponed / canceled. */
function mapStatus(name: string | undefined, state: string | undefined): { state: GameState; status?: GameStatus } {
  const n = (name ?? "").toUpperCase();
  if (n.includes("POSTPONED")) return { state: "Upcoming", status: "postponed" };
  if (n.includes("CANCEL")) return { state: "Final", status: "canceled" };
  if (n.includes("HALFTIME")) return { state: "Live", status: "halftime" };
  const base: GameState = state === "in" ? "Live" : state === "post" ? "Final" : "Upcoming";
  if (n.includes("DELAY") || n.includes("SUSPEND")) return { state: base, status: "delayed" };
  return { state: base };
}

const toScore = (raw: string | number | undefined): number | undefined => {
  const n = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(n) ? n : undefined;
};

export function parseEspnScoreboard(events: EspnEvent[]): Record<string, TeamGameState> {
  const result: Record<string, TeamGameState> = {};

  events.forEach((event) => {
    const competition = event.competitions?.[0];
    const rawDate = competition?.date ?? event.date;
    const kickoffAt = rawDate ? Date.parse(rawDate) : NaN;
    const status = competition?.status ?? event.status;
    const rawState = status?.type?.state;
    if (!Number.isFinite(kickoffAt) || !rawState) return;

    const { state, status: gameStatus } = mapStatus(status?.type?.name, rawState);
    const competitors = competition?.competitors ?? [];
    const possessionId = competition?.situation?.possession != null ? String(competition.situation.possession) : null;
    const isLive = state === "Live";
    const period = typeof status?.period === "number" && status.period > 0 ? status.period : undefined;

    competitors.forEach((competitor, index) => {
      const abbr = competitor.team?.abbreviation;
      if (!abbr) return;
      const opponent = competitors[index === 0 ? 1 : 0];
      const teamId = competitor.team?.id ?? competitor.id;

      const entry: TeamGameState = { kickoffAt, state };
      if (gameStatus) entry.status = gameStatus;
      // Known before kickoff too — same-game correlation needs it for Upcoming games.
      if (opponent?.team?.abbreviation) entry.opponent = opponent.team.abbreviation;
      if (isLive || state === "Final") {
        const score = toScore(competitor.score);
        const oppScore = toScore(opponent?.score);
        if (score != null && oppScore != null) {
          entry.score = score;
          entry.oppScore = oppScore;
        }
      }
      if (isLive) {
        if (period != null) entry.period = period;
        if (typeof status?.clock === "number") entry.clockSeconds = Math.max(Math.round(status.clock), 0);
        if (status?.displayClock) entry.clockDisplay = status.displayClock;
        if (possessionId != null && teamId != null && possessionId === String(teamId)) entry.hasPossession = true;
      }

      result[abbr] = entry;
      (TEAM_ABBR_ALIASES[abbr] ?? []).forEach((alias) => { result[alias] = entry; });
    });
  });

  return result;
}

/**
 * Live games (excluding halftime, which needs no clock) that came back without
 * a period or clock reading. The Gameday model silently falls back to the old
 * "projection minus points so far" formula for these, so a non-empty result
 * means ESPN's live shape drifted from what the parser expects — worth a log line.
 */
export function findIncompleteLiveGames(byTeam: Record<string, TeamGameState>): string[] {
  return Object.entries(byTeam)
    .filter(([, g]) => g.state === "Live" && g.status !== "halftime" && (g.period == null || g.clockSeconds == null))
    .map(([team]) => team);
}
