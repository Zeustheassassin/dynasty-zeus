// A QB's style and pocket profile over PFF's FULL college seasons (migration
// 092), for his report and the Big Board. Pure, and shown only: nothing here
// is scored except the middle of the field (middleUsage.ts).
//
// The user (2026-11-10) wanted to tell the quick-game / RPO one-read QB from
// the one who sits in the pocket and reads it, to see who holds the ball and
// takes sacks, and where on the field he throws. Over 3–5 charted games those
// shares are mostly noise, so this reads every college season stored for him
// (all summed, no fade: a description, not an estimate). The charted read
// rate (Past 1st read, scored in the AE Score) sits beside it on the report.
//
// The college lines are every FBS QB season with 200+ attempts in 2024 and
// 2025 (PFF passing depth, 417 seasons): each zone's share of attempts and
// accuracy (PFF accuracy %, aimed passes).
import { DEPTH_ZONES, middleUsageByProspect, seasonMiddle, type MiddleUsage, type PffSeasonDepthRow } from "./middleUsage";

export const COLLEGE_ZONE_SHARE: Readonly<Record<string, number>> = {
  left_behind_los: 2.1, left_short: 7.6, left_medium: 4.9, left_deep: 4.9,
  center_behind_los: 14.1, center_short: 25.8, center_medium: 12.7, center_deep: 5.8,
  right_behind_los: 2.3, right_short: 8.9, right_medium: 5.6, right_deep: 5.3,
};
export const COLLEGE_ZONE_ACCURACY: Readonly<Record<string, number>> = {
  left_behind_los: 92.7, left_short: 81.0, left_medium: 53.9, left_deep: 36.9,
  center_behind_los: 93.6, center_short: 81.0, center_medium: 65.1, center_deep: 47.3,
  right_behind_los: 92.7, right_short: 79.6, right_medium: 54.7, right_deep: 38.3,
};

export interface ZoneCell {
  attempts: number;
  /** % of his attempts. */
  share: number;
  aimed: number;
  /** PFF accuracy % on his aimed passes there; null with none. */
  accuracy: number | null;
}

export interface QBFullSeasons {
  seasons: number[];
  /** "TULANE 2024 · DUKE 2025". */
  teams: string;
  attempts: number;
  dropbacks: number;
  /** Seconds per dropback. */
  ttt: number | null;
  adot: number | null;
  sacks: number;
  pressures: number;
  scrambles: number;
  /** % of attempts thrown behind the line (screens and the like). */
  behindLos: number | null;
  /** % of attempts 20+ air yards. */
  deep: number | null;
  /** The middle of the field as the AE Score reads it (blended, pulled). */
  middle: MiddleUsage | null;
  /** Middle 10+ throws ÷ attempts past the line, summed over his seasons. */
  middleRaw: { middle: number; pastLos: number };
  zones: Record<string, ZoneCell>;
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Each prospect's full-season style profile, from every stored season. */
export function qbFullSeasons(rows: readonly PffSeasonDepthRow[]): Map<string, QBFullSeasons> {
  const middle = middleUsageByProspect(rows);
  const by = new Map<string, PffSeasonDepthRow[]>();
  for (const r of rows) {
    const list = by.get(r.prospect_id);
    if (list) list.push(r); else by.set(r.prospect_id, [r]);
  }
  const out = new Map<string, QBFullSeasons>();
  for (const [id, list] of by) {
    list.sort((a, b) => a.season - b.season);
    let attempts = 0, dropbacks = 0, tttTotal = 0, tttDb = 0, adotSum = 0, adotAtt = 0, sacks = 0, pressures = 0, scrambles = 0;
    let mid = 0, past = 0;
    const zoneAtt: Record<string, number> = {}, zoneAimed: Record<string, number> = {}, zoneAcc: Record<string, number> = {};
    for (const z of DEPTH_ZONES) { zoneAtt[z] = 0; zoneAimed[z] = 0; zoneAcc[z] = 0; }
    for (const r of list) {
      for (const z of DEPTH_ZONES) {
        zoneAtt[z] += n(r.zone_attempts[z]);
        const aimed = n(r[`fs_aimed_${z}`]);
        const acc = r[`fs_acc_${z}`];
        if (aimed > 0 && typeof acc === "number" && Number.isFinite(acc)) { zoneAimed[z] += aimed; zoneAcc[z] += acc * aimed; }
      }
      const db = n(r.fs_dropbacks), att = n(r.fs_attempts);
      dropbacks += db; attempts += att;
      if (db > 0 && r.fs_ttt_total != null) { tttTotal += n(r.fs_ttt_total); tttDb += db; }
      if (att > 0 && r.fs_adot != null) { adotSum += n(r.fs_adot) * att; adotAtt += att; }
      sacks += n(r.fs_sacks); pressures += n(r.fs_pressures); scrambles += n(r.fs_scrambles);
      const s = seasonMiddle(r.zone_attempts);
      mid += s.middle; past += s.pastLos;
    }
    const totalAtt = DEPTH_ZONES.reduce((a, z) => a + zoneAtt[z], 0);
    if (totalAtt <= 0) continue;
    const pct = (num: number) => (100 * num) / totalAtt;
    const zones: Record<string, ZoneCell> = {};
    for (const z of DEPTH_ZONES) {
      zones[z] = { attempts: zoneAtt[z], share: pct(zoneAtt[z]), aimed: zoneAimed[z], accuracy: zoneAimed[z] > 0 ? zoneAcc[z] / zoneAimed[z] : null };
    }
    const band = (b: string) => zoneAtt[`left_${b}`] + zoneAtt[`center_${b}`] + zoneAtt[`right_${b}`];
    out.set(id, {
      seasons: list.map((r) => r.season),
      teams: list.map((r) => `${r.team_name ?? "?"} ${r.season}`).join(" · "),
      attempts: attempts || totalAtt,
      dropbacks,
      ttt: tttDb > 0 ? tttTotal / tttDb : null,
      adot: adotAtt > 0 ? adotSum / adotAtt : null,
      sacks, pressures, scrambles,
      behindLos: pct(band("behind_los")),
      deep: pct(band("deep")),
      middle: middle.get(id) ?? null,
      middleRaw: { middle: mid, pastLos: past },
      zones,
    });
  }
  return out;
}

/** The Big Board's QB style columns (pffCols.ts QB_STYLE_BOARD_COLS), as PffValues keys. They ride the PFF values (so the board sorts them like its PFF columns), but Mid 10+ is PFF's full seasons and Reads is the user's charting. */
export function qbStyleValues(f: QBFullSeasons | undefined, reads: { num: number; den: number } | undefined): Record<string, number | null> {
  return {
    pff_qs_mid10: f && f.middleRaw.pastLos > 0 ? (100 * f.middleRaw.middle) / f.middleRaw.pastLos : null,
    pff_qs_mid10_n: f ? f.middleRaw.pastLos : null,
    pff_qs_reads: reads && reads.den > 0 ? (100 * reads.num) / reads.den : null,
    pff_qs_reads_n: reads ? reads.den : null,
  };
}
