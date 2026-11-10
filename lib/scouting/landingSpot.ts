// Landing-spot inputs for Dynasty Score Plus (dynastyScore.ts): who his NFL
// team drafted ahead of him, from the stored draft results (cfd_draft_picks,
// migration 090), his role standing (roleStanding.ts), and his team inputs
// (teamLanding.ts: vets ahead, path by year 2, QB, offense). Classes from
// LANDING_FIRST_CLASS only.

import { UNDRAFTED_ROUND } from "../draftRound";
import { draftSkillPosition, matchDraftPicks, nflTeamId, type DraftPickRow } from "../nflDraft";
import type { Prospect } from "../types";
import { COMPETITION_CAP, LANDING_FIRST_CLASS, type Competitor, type LandingBreakdown, type LandingInputs } from "./dynastyScore";
import { isCompositePos } from "./prospectScores";
import { roleInfo, type RoleFit } from "./roleFit";
import { ROLE_STANDING_MAX, roleStandingText, willPlayRole, type RoleStanding } from "./roleStanding";
import { resolveTeamLanding, teamLandingLines } from "./teamLanding";

export type LandingProspect = Pick<
  Prospect,
  "id" | "name" | "school" | "position" | "draft_class_year" | "draft_round" | "draft_pick" | "draft_team" | "will_play_post"
  | "landing_inputs"
>;

/**
 * Is a TE a Move TE? Move TEs and WRs count against each other (a TE drafted
 * ahead of a WR, and a WR drafted ahead of a Move TE prospect). By the user's
 * Will Play (Post) when it names a TE role, else by his best role bucket. A
 * drafted TE who isn't on the board can't be told apart, so he doesn't count.
 */
export function isMoveTe(te: Pick<LandingProspect, "will_play_post"> | undefined, fit: RoleFit | undefined): boolean {
  if (!te) return false;
  const post = willPlayRole("TE", te.will_play_post);
  if (post) return post === "move";
  return fit?.best === "move";
}

/** Group stored picks by year. */
export function picksByYear(picks: readonly DraftPickRow[]): Map<number, DraftPickRow[]> {
  const m = new Map<number, DraftPickRow[]>();
  for (const p of picks) {
    const list = m.get(p.year);
    if (list) list.push(p); else m.set(p.year, [p]);
  }
  return m;
}

/**
 * Landing inputs for every drafted prospect from LANDING_FIRST_CLASS on (a
 * round set). Competitors are his team's picks at his position, plus Move TEs
 * for a WR and WRs for a Move TE, taken ahead of him: an earlier overall pick, or an earlier round
 * when his pick isn't set, or any pick when he went undrafted. Null with a
 * note when his class's draft isn't loaded or his team isn't known. His role
 * standing comes from `standings` (roleStandings), and his team inputs from
 * his saved room and entries (resolveTeamLanding), whatever the draft results.
 */
export function landingInputsFrom(
  prospects: readonly LandingProspect[],
  picks: readonly DraftPickRow[],
  roleFits: ReadonlyMap<string, RoleFit>,
  standings: ReadonlyMap<string, RoleStanding> = new Map(),
): Map<string, LandingInputs> {
  const out = new Map<string, LandingInputs>();
  const byYear = picksByYear(picks);
  // Board TEs by their pick, for the Move TE check (one match per year).
  const boardTeByPick = new Map<string, LandingProspect>();
  const prospectById = new Map(prospects.map((p) => [p.id, p]));
  for (const [year, list] of byYear) {
    const tes = prospects.filter((p) => p.position === "TE" && p.draft_class_year === year);
    for (const [id, pk] of matchDraftPicks(tes, list)) boardTeByPick.set(`${pk.year}|${pk.overall}`, prospectById.get(id)!);
  }

  for (const p of prospects) {
    if (p.draft_class_year == null || p.draft_class_year < LANDING_FIRST_CLASS) continue;
    if (!isCompositePos(p.position) || p.draft_round == null) continue;
    const standing = standings.get(p.id) ?? null;
    const teamInputs = resolveTeamLanding(p);
    const list = byYear.get(p.draft_class_year);
    if (!list?.length) {
      out.set(p.id, { competitors: null, note: `the ${p.draft_class_year} draft results aren't loaded (Post-Draft tab)`, standing, team: teamInputs });
      continue;
    }
    const team = nflTeamId(p.draft_team);
    if (team == null) {
      out.set(p.id, { competitors: null, note: p.draft_team ? `"${p.draft_team}" isn't a team the board knows` : "no NFL team set", standing, team: teamInputs });
      continue;
    }
    const undrafted = p.draft_round === UNDRAFTED_ROUND;
    // A Move TE competes with the WRs for targets, both ways (the user, 2026-11-10).
    const meMoveTe = p.position === "TE" && isMoveTe(p, roleFits.get(p.id));
    const ahead = (pk: DraftPickRow) =>
      undrafted || (p.draft_pick != null && p.draft_pick >= 1 ? pk.overall < p.draft_pick : pk.round < p.draft_round!);
    const competitors: Competitor[] = [];
    for (const pk of list) {
      if ((pk.nfl_team_id ?? nflTeamId(pk.nfl_team)) !== team || !ahead(pk)) continue;
      const pos = draftSkillPosition(pk.position);
      if (pos === p.position) {
        competitors.push({ name: pk.name, position: pos, overall: pk.overall, round: pk.round, moveTe: false });
      } else if (p.position === "WR" && pos === "TE") {
        const te = boardTeByPick.get(`${pk.year}|${pk.overall}`);
        if (te && isMoveTe(te, roleFits.get(te.id))) {
          competitors.push({ name: pk.name, position: "TE", overall: pk.overall, round: pk.round, moveTe: true });
        }
      } else if (meMoveTe && pos === "WR") {
        competitors.push({ name: pk.name, position: "WR", overall: pk.overall, round: pk.round, moveTe: false });
      }
    }
    out.set(p.id, { competitors, standing, team: teamInputs });
  }
  return out;
}

const sgn2 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;

/** The Dynasty+ tooltip line for rookie competition, at the Landing slider's weight. */
export function competitionLine(landing: LandingBreakdown, weight: number): string {
  const c = landing.competition;
  if (!c) return `Rookie competition: ${landing.note ?? "not known yet"} → +0.00`;
  if (c.competitors.length === 0) return "Rookie competition: nobody his team drafted ahead of him plays his spot → +0.00";
  const who = c.competitors
    .map((x) => `${x.name} (${x.moveTe ? "Move TE" : x.position}, pick ${x.overall}, ${sgn2(-x.cost)})`)
    .join("; ");
  const capped = c.competitors.reduce((s, x) => s + x.cost, 0) > COMPETITION_CAP + 1e-9 ? `, capped at ${sgn2(-COMPETITION_CAP)}` : "";
  return `Rookie competition: ${who}${capped} → ${sgn2(weight * c.value)}`;
}

/** The Dynasty+ tooltip line for role standing, at the Role slider's weight. */
export function standingLine(standing: RoleStanding | null, classYear: number, weight: number): string {
  if (!standing) return "Role standing: no role yet (not enough tape for a role fit) → +0.00";
  return `Role standing: ${roleStandingText(standing, classYear)} → ${sgn2(weight * standing.value)}`;
}

/** The Dynasty+ tooltip lines for the landing spot: rookie competition, role standing, then the team inputs. */
export function landingLines(
  landing: LandingBreakdown | null | undefined,
  classYear: number,
  w: { landing: number; role: number; offense: number },
): string[] {
  if (!landing) return [];
  return [competitionLine(landing, w.landing), standingLine(landing.standing, classYear, w.role), ...teamLandingLines(landing.team, w)];
}

/** The role-standing pool in words, for a tooltip: "X in the 2027 class: Smith 86%, Jones 78% (him), …". */
export function standingPoolText(standing: RoleStanding, classYear: number, meId: string): string {
  const label = roleInfo(standing.role).label;
  const who = standing.classPool.map((x) => `${x.name} ${x.pct}%${x.id === meId ? " (him)" : ""}`).join(", ");
  return `${label} in the ${classYear} class: ${who}. The alpha gets +${ROLE_STANDING_MAX.toFixed(2)} at most and the bottom −${ROLE_STANDING_MAX.toFixed(2)} (less in a small pool; alone, 0), × the Role slider.`;
}
