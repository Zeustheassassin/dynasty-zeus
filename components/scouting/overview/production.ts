// The Production tab's numbers: every PFF number the Analysis tables carry for
// the position (stats/pffCols.ts), over exactly the charted games, grouped as
// the tables group them. Same values, same tooltips; laid out as an
// OverviewPage so the report's tiles and percentile chips render it.

import type { PffValues } from "../../../lib/pff/totals";
import type { PffPos } from "../../../lib/pff/stats";
import type { OverviewFmt, OverviewPage, OverviewSection } from "../../../lib/scouting/overviewStats";
import type { ColDef } from "../stats/StatsTableShell";
import { pffCols } from "../stats/pffCols";

/** A prospect needs PFF stats from this many charted games to be ranked. */
export const PRODUCTION_MIN_GAMES = 3;

// The Analysis tables' grade headers are terse; the report spells them out.
const GRADE_LABEL: Record<string, string> = {
  Off: "Offense", Pass: "Passing", Run: "Rushing", Route: "Route running",
  PBlk: "Pass blocking", RBlk: "Run blocking", Hands: "Hands",
};

const FMT: Record<string, OverviewFmt> = { pct: "pct1", pct0: "pct0", dec1: "dec1", dec2: "dec2", count: "int" };

/** The position's PFF numbers for one prospect, section by section. */
export function productionPage(pos: PffPos, pff: PffValues, cols: readonly ColDef[] = pffCols(pos)): OverviewPage {
  const games = pff.pff_g ?? 0;
  const sections: OverviewSection[] = [];
  for (const c of cols) {
    if (c.key === "pff_g") continue; // the header says how many games
    const group = (c.group ?? "").replace(/^PFF /, "");
    let section = sections.find((s) => s.key === group);
    if (!section) {
      section = { key: group, title: group, size: "sm", stats: [] };
      sections.push(section);
    }
    const value = pff[c.key] ?? null;
    section.stats.push({
      key: c.key,
      label: group === "Grades" ? GRADE_LABEL[c.label] ?? c.label : c.label,
      value,
      fmt: FMT[c.fmt ?? "dec1"] ?? "dec1",
      tone: "pff",
      dir: c.colorDir === 1 || c.colorDir === -1 ? c.colorDir : 0,
      n: games,
      minN: PRODUCTION_MIN_GAMES,
      tooltip: c.tooltip ?? c.label,
    });
  }
  return { meta: games ? [`${games} game${games === 1 ? "" : "s"}`] : [], main: sections, columns: [] };
}
