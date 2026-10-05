// The tag-only stats on the Analysis tables (and so Compare): each one's rate
// beside the tagged reps it rests on (lib/scouting/tagStats.ts). They exist
// only for plays charted with the per-play tags, so a prospect charted before
// the tags reads "—", and a stat under TAG_STAT_FLOOR reps reads "—" too.
import type { ColDef } from "./StatsTableShell";
import {
  TAG_STATS, TAG_STAT_FLOOR, tagStatReps, tagStatValues,
  type TagStatInputs, type TagStatValue,
} from "../../../lib/scouting/tagStats";
import type { TagPosition } from "../../../lib/scouting/playEra";

const GROUP = "Tags (tagged plays)";

export function tagCols(pos: TagPosition): ColDef[] {
  return TAG_STATS[pos].flatMap((s): ColDef[] => [
    {
      key: s.key, label: s.label, group: GROUP, fmt: "pct", width: Math.max(58, 12 + s.label.length * 7),
      ...(s.dir !== 0 ? { colorDir: s.dir } : {}),
      weightBy: `${s.key}_n`,
      tooltip: `${s.description} Plays charted with the per-play tags only; "—" under ${TAG_STAT_FLOOR} tagged ${s.unit}.`,
    },
    {
      key: `${s.key}_n`, label: "n", group: GROUP, fmt: "count", width: 40,
      tooltip: `Tagged ${s.unit} behind ${s.label}`,
    },
  ]);
}

/** The row fields tagCols reads. */
export function tagRow(pos: TagPosition, values: Record<string, TagStatValue> | undefined): Record<string, number | null> {
  const row: Record<string, number | null> = {};
  for (const s of TAG_STATS[pos]) {
    const v = values?.[s.key];
    row[s.key] = v?.rate != null ? parseFloat(v.rate.toFixed(1)) : null;
    row[`${s.key}_n`] = v?.n ?? 0;
  }
  return row;
}

/** prospect → stat key → value, from whatever plays / WR tag cells are loaded. */
export function tagValuesFor(inp: Partial<TagStatInputs> & Pick<TagStatInputs, "games">): Map<string, Record<string, TagStatValue>> {
  return tagStatValues(tagStatReps({ qbPlays: [], rbPlays: [], tePlays: [], wrTagRows: [], ...inp }));
}
