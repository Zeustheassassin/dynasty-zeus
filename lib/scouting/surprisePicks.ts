// ============================================================
// Surprise picks (stage 8 of the 2026-11-26 scouting plan)
// ============================================================
// After a draft: the QB / RB / WR / TE the NFL took (or signed as undrafted
// free agents) that the board can't speak for yet, so the user knows whom to
// chart on draft weekend (the user, 11/26: "a few post-draft looks at
// surprise picks"; the board is done a few days after the UDFA signings).
//   - Drafted: every skill pick in the class's draft (cfd_draft_picks,
//     matched as the Post-Draft tab matches them, nflDraft.ts matchDraftPicks).
//   - UDFA: every skill player of that draft year with no draft round in the
//     contracts table (nfl_contracts, OverTheCap via nflverse, refreshed daily
//     March–May), whatever deal he's on now; released ones say so. No college
//     in that table, so he's matched by name within the class, his position
//     settling two of the same name.
// Each one is a surprise when he's not on the board for that class (on it in
// another class, or not at all) or his sample is under a quarter (the Smp
// dot's red tier, sampleTiers.ts). The thin check waits for the plays to load
// (before then every QB / RB / TE reads as under the floor).
// Pure.
// ============================================================

import { normalizeRookieName } from "../helpers/formatting";
import { draftSkillPosition, matchDraftPicks, type DraftPickRow } from "../nflDraft";
import type { SampleSize } from "./sampleSize";

type SkillPos = "QB" | "RB" | "WR" | "TE";
const SKILL: ReadonlySet<string> = new Set(["QB", "RB", "WR", "TE"]);

/** A contracts-table row as the list reads it (nfl_contracts). */
export interface UdfaRow {
  otc_id: number;
  player: string;
  /** OverTheCap's position: QB / RB / FB / WR / TE / … */
  position: string;
  team: string | null;
  is_active: boolean;
  contract_type: string | null;
  draft_year: number | null;
  draft_round: number | null;
}

/** The columns the list selects. */
export const UDFA_COLUMNS = "otc_id,player,position,team,is_active,contract_type,draft_year,draft_round";

export interface SurpriseProspect {
  id: string;
  name: string;
  position: string;
  school: string | null;
  draft_class_year: number | null;
}

export type SurpriseWhy =
  /** No one of his name at a skill position on the board. */
  | "off_board"
  /** On the board in another class. */
  | "other_class"
  /** His name is on the class's board but couldn't be matched (two prospects, or two picks, share it). */
  | "unsettled"
  /** On the board for the class, under a quarter of a full sample. */
  | "thin";

export interface SurpriseRow {
  key: string;
  name: string;
  position: SkillPos;
  /** His NFL team, as the source spells it ("Eagles"). */
  team: string | null;
  /** Round and overall pick, or null for an undrafted free agent. */
  pick: { round: number; overall: number } | null;
  /** CFD's college (drafted players only). */
  college: string | null;
  /** An undrafted free agent no longer on an active deal (released). */
  released: boolean;
  why: SurpriseWhy;
  /** The board prospect he is (thin, other class). */
  prospectId: string | null;
  /** His class on the board, when it's another one. */
  otherClass: number | null;
  /** His sample, when he's on the board and the plays are in. */
  sample: SampleSize | null;
}

export interface SurprisePicks {
  rows: SurpriseRow[];
  /** Skill players drafted / signed as UDFAs that year, surprises or not. */
  drafted: number;
  udfa: number;
  /** The thin check ran (the plays are in). */
  samplesChecked: boolean;
}

const skillOf = (pos: string): SkillPos | null => {
  const p = pos.trim().toUpperCase();
  if (p === "HB" || p === "FB") return "RB";
  return SKILL.has(p) ? (p as SkillPos) : null;
};

/** Does `pos` (a CFD position name or an abbreviation) name a fantasy position? */
const pickSkill = (pos: string): SkillPos | null => draftSkillPosition(pos) ?? skillOf(pos);

/** The year's skill-position undrafted free agents: draft year set, no round. */
export function udfasOf(rows: readonly UdfaRow[], year: number): UdfaRow[] {
  return rows.filter((r) => r.draft_year === year && r.draft_round == null && skillOf(r.position) != null);
}

/**
 * The class's surprise picks: drafted (in pick order) then undrafted free
 * agents (active first, then by name), each off the board for the class or
 * thinly charted. `samples` and `samplesReady` come from the Big Board
 * (sampleSizes, once every play has loaded).
 */
export function surprisePicks(
  year: number,
  picks: readonly DraftPickRow[],
  udfaRows: readonly UdfaRow[],
  prospects: readonly SurpriseProspect[],
  samples: ReadonlyMap<string, SampleSize>,
  samplesReady: boolean,
): SurprisePicks {
  const pool = prospects.filter((p) => p.draft_class_year === year && SKILL.has(p.position));
  const others = prospects.filter((p) => p.draft_class_year !== year && SKILL.has(p.position));
  const byName = (list: readonly SurpriseProspect[]) => {
    const m = new Map<string, SurpriseProspect[]>();
    for (const p of list) {
      const k = normalizeRookieName(p.name);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  };
  const poolByName = byName(pool);
  const othersByName = byName(others);

  const rows: SurpriseRow[] = [];
  /** A player who isn't matched to the class: in another class, two of the class share his name, or off the board. */
  const unmatched = (base: Omit<SurpriseRow, "why" | "prospectId" | "otherClass" | "sample">): SurpriseRow => {
    const k = normalizeRookieName(base.name);
    if ((poolByName.get(k) ?? []).length > 0) return { ...base, why: "unsettled", prospectId: null, otherClass: null, sample: null };
    const elsewhere = (othersByName.get(k) ?? []).filter((p) => p.position === base.position);
    const other = elsewhere.length === 1 ? elsewhere[0] : (othersByName.get(k) ?? []).length === 1 ? othersByName.get(k)![0] : null;
    if (other) {
      return { ...base, why: "other_class", prospectId: other.id, otherClass: other.draft_class_year, sample: samplesReady ? samples.get(other.id) ?? null : null };
    }
    return { ...base, why: "off_board", prospectId: null, otherClass: null, sample: null };
  };
  /** A player matched to the class: a surprise only when his sample is under a quarter. */
  const matched = (base: Omit<SurpriseRow, "why" | "prospectId" | "otherClass" | "sample">, p: SurpriseProspect): SurpriseRow | null => {
    if (!samplesReady) return null;
    const s = samples.get(p.id) ?? null;
    if (!s || s.tier !== "low") return null;
    return { ...base, why: "thin", prospectId: p.id, otherClass: null, sample: s };
  };

  // Drafted.
  const yearPicks = picks.filter((pk) => pk.year === year && pickSkill(pk.position) != null)
    .sort((a, b) => a.overall - b.overall);
  const prospectOfPick = new Map<string, SurpriseProspect>();
  for (const [id, pk] of matchDraftPicks(pool, yearPicks)) {
    const p = pool.find((x) => x.id === id);
    if (p) prospectOfPick.set(`${pk.year}|${pk.overall}`, p);
  }
  for (const pk of yearPicks) {
    const base = {
      key: `pick:${pk.year}:${pk.overall}`, name: pk.name, position: pickSkill(pk.position)!,
      team: pk.nfl_team, pick: { round: pk.round, overall: pk.overall }, college: pk.college, released: false,
    };
    const p = prospectOfPick.get(`${pk.year}|${pk.overall}`);
    const row = p ? matched(base, p) : unmatched(base);
    if (row) rows.push(row);
  }

  // Undrafted free agents. A name the draft already has isn't one.
  const draftedNames = new Set(yearPicks.map((pk) => normalizeRookieName(pk.name)));
  const udfas = udfasOf(udfaRows, year).filter((r) => !draftedNames.has(normalizeRookieName(r.player)))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.player.localeCompare(b.player));
  for (const r of udfas) {
    const pos = skillOf(r.position)!;
    const base = {
      key: `udfa:${r.otc_id}`, name: r.player, position: pos, team: r.team, pick: null, college: null, released: !r.is_active,
    };
    let cands = poolByName.get(normalizeRookieName(r.player)) ?? [];
    if (cands.length > 1) cands = cands.filter((p) => p.position === pos);
    const row = cands.length === 1 ? matched(base, cands[0]) : unmatched(base);
    if (row) rows.push(row);
  }

  return { rows, drafted: yearPicks.length, udfa: udfas.length, samplesChecked: samplesReady };
}

/** "Not on your board" / "On your 2028 board" / "Thin: 12 of 160 routes". */
export function surpriseWhyText(r: SurpriseRow, unit: (s: SampleSize) => string): string {
  switch (r.why) {
    case "off_board": return "Not on your board";
    case "other_class": return `On your ${r.otherClass} board${r.sample ? ` (${unit(r.sample)})` : ""}`;
    case "unsettled": return "On your board by name, but couldn't be matched (a shared name): check him by hand";
    case "thin": return `Under a quarter sample: ${r.sample ? unit(r.sample) : "no sample"}`;
  }
}
