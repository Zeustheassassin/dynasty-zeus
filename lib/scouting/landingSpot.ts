// Landing-spot inputs for Dynasty Score Plus (dynastyScore.ts): who his NFL
// team drafted ahead of him, from the stored draft results (cfd_draft_picks,
// migration 090). Classes from LANDING_FIRST_CLASS only.

import { UNDRAFTED_ROUND } from "../draftRound";
import { draftSkillPosition, matchDraftPicks, nflTeamId, type DraftPickRow } from "../nflDraft";
import type { Prospect } from "../types";
import { COMPETITION_CAP, LANDING_FIRST_CLASS, type Competitor, type LandingBreakdown, type LandingInputs } from "./dynastyScore";
import { isCompositePos } from "./prospectScores";
import type { RoleFit } from "./roleFit";

export type LandingProspect = Pick<
  Prospect,
  "id" | "name" | "school" | "position" | "draft_class_year" | "draft_round" | "draft_pick" | "draft_team" | "will_play_post"
>;

/**
 * Is a TE a Move TE? Move TEs and WRs count against each other (a TE drafted
 * ahead of a WR, and a WR drafted ahead of a Move TE prospect). By the user's
 * Will Play (Post) when it's set, else by his best role bucket. A drafted TE
 * who isn't on the board can't be told apart, so he doesn't count.
 */
export function isMoveTe(te: Pick<LandingProspect, "will_play_post"> | undefined, fit: RoleFit | undefined): boolean {
  if (!te) return false;
  const wp = te.will_play_post?.trim();
  if (wp) return /move/i.test(wp);
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
 * note when his class's draft isn't loaded or his team isn't known.
 */
export function landingInputsFrom(
  prospects: readonly LandingProspect[],
  picks: readonly DraftPickRow[],
  roleFits: ReadonlyMap<string, RoleFit>,
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
    const list = byYear.get(p.draft_class_year);
    if (!list?.length) {
      out.set(p.id, { competitors: null, note: `the ${p.draft_class_year} draft results aren't loaded (Post-Draft tab)` });
      continue;
    }
    const team = nflTeamId(p.draft_team);
    if (team == null) {
      out.set(p.id, { competitors: null, note: p.draft_team ? `"${p.draft_team}" isn't a team the board knows` : "no NFL team set" });
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
    out.set(p.id, { competitors });
  }
  return out;
}

const sgn2 = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;

/** The Dynasty+ tooltip lines for the landing-spot piece, at the Landing slider's weight. */
export function landingLines(landing: LandingBreakdown | null | undefined, weight: number): string[] {
  if (!landing) return [];
  const c = landing.competition;
  if (!c) return [`Landing spot: ${landing.note ?? "not known yet"} → +0.00`];
  if (c.competitors.length === 0) return ["Rookie competition: nobody his team drafted ahead of him plays his spot → +0.00"];
  const who = c.competitors
    .map((x) => `${x.name} (${x.moveTe ? "Move TE" : x.position}, pick ${x.overall}, ${sgn2(-x.cost)})`)
    .join("; ");
  const capped = c.competitors.reduce((s, x) => s + x.cost, 0) > COMPETITION_CAP + 1e-9 ? `, capped at ${sgn2(-COMPETITION_CAP)}` : "";
  return [`Rookie competition: ${who}${capped} → ${sgn2(weight * c.value)}`];
}
