"use client";
import { useMemo } from "react";
import StatsTableShell, { StatRow, ColDef, MinFilterDef } from "./StatsTableShell";
import type { LinedUp, Prospect, ProspectWithStats } from "../../../lib/types";
import { roleFitCols, roleFitRow } from "./roleFitCols";
import { pffCols, pffRow } from "./pffCols";
import type { PffTotals } from "../../../lib/pff/totals";
import { tagCols, tagRow, tagValuesFor } from "./tagCols";
import type { TagStatValue } from "../../../lib/scouting/tagStats";
import type { ProspectGameRouteTagCellsRow } from "../../../lib/scouting/aggregateMerge";

interface Props {
  prospectsWithStats: ProspectWithStats[];
  loading?: boolean;
  draftYearFilter?: number | null;
  onSelectProspect?: (p: Prospect) => void;
  /** PFF over each prospect's charted games (ScoutingHub). */
  pffTotals?: Map<string, PffTotals>;
  /** Tagged WR routes per game (migration 064), for the tag-only stats. */
  routeTagCells?: readonly ProspectGameRouteTagCellsRow[];
}

const ROUTE_LABELS: Record<string, string> = {
  nine: "Go", post: "Post", dig: "Dig", curl: "Curl", slant: "Slant",
  screen: "Scr", flat: "Flat", comeback: "CB", out: "Out", corner: "Cor", other: "Oth",
};

export const WR_STAT_COLS: ColDef[] = [
  // Identity
  { key: "name",   label: "Name",    group: "Identity", fmt: "name", sticky: true, width: 160 },
  { key: "yr",     label: "Yr",      group: "Identity", fmt: "yr",   width: 46 },
  { key: "g",      label: "G",       group: "Identity", fmt: "count", width: 40 },
  { key: "snaps",  label: "Snaps",   group: "Identity", fmt: "count", width: 52 },
  { key: "routes", label: "Routes",  group: "Identity", fmt: "count", width: 58 },
  // Role buckets (lib/scouting/roleFitWR.ts)
  ...roleFitCols("WR"),
  // Advanced
  { key: "sae",      label: "SAE",    group: "Advanced", fmt: "plusMinus", colorDir: 1,  width: 62, tooltip: "Success (Open) Rate Above Expected — each route judged against routes like it (route, coverage incl. press, slot/outside, on/off line stacked), so a hard rep costs little when he isn't open. Min. 15 routes. Older seasons count a little less.", leagueOverride: 0 },
  { key: "core_sae", label: "cSAE",   group: "Advanced", fmt: "plusMinus", colorDir: 1,  width: 64, tooltip: "Core-Route SAE — same as SAE, but excludes Go (Nine) and Screen routes, which are scheme-driven rather than a receiver beating coverage. Min. 15 core routes. Older seasons count a little less.", leagueOverride: 0 },
  { key: "open_pct", label: "Open%",  group: "Advanced", fmt: "pct",       colorDir: 1,  width: 62, tooltip: "% of routes where player was open", weightBy: "routes" },
  { key: "tgt_pct",  label: "Tgt%",   group: "Advanced", fmt: "pct",       colorDir: 1,  width: 58, tooltip: "Targets per route run", weightBy: "routes" },
  { key: "catch_pct",label: "Catch%", group: "Advanced", fmt: "pct",       colorDir: 1,  width: 62, tooltip: "Catches per target", weightBy: "raw_tgts" },
  { key: "drop_pct", label: "Drop%",  group: "Advanced", fmt: "pct",       colorDir: -1, width: 60, tooltip: "Drops per target", weightBy: "raw_tgts" },
  { key: "cont_tgt_pct",   label: "ContTgt%",   group: "Advanced", fmt: "pct", colorDir: -1, width: 72, weightBy: "routes" },
  { key: "cont_catch_pct", label: "ContCatch%", group: "Advanced", fmt: "pct", colorDir: 1,  width: 78, weightBy: "raw_cont_tgt" },
  // By Coverage
  { key: "cvg_man_open",    label: "Man%",    group: "By Coverage", fmt: "pct", colorDir: 1, width: 60, weightBy: "cvg_man_n" },
  { key: "cvg_zone_open",   label: "Zone%",   group: "By Coverage", fmt: "pct", colorDir: 1, width: 62, weightBy: "cvg_zone_n" },
  { key: "cvg_double_open", label: "Dbl%",    group: "By Coverage", fmt: "pct", colorDir: 1, width: 58, weightBy: "cvg_double_n" },
  { key: "cvg_press_open",  label: "Press%",  group: "By Coverage", fmt: "pct", colorDir: 1, width: 62, weightBy: "cvg_press_n" },
  // Lined Up — where he lines up, as a share of every snap charted in the app,
  // run plays included (the import entered whole games, so its alignment isn't
  // per play). Role, not quality, so no color. X = outside on the line, Z =
  // outside off it.
  { key: "lu_slot",      label: "Slot",  group: "Lined Up (in-app)", fmt: "pct", width: 56, weightBy: "lu_snaps", tooltip: "% of his in-app snaps (runs included) in the slot" },
  { key: "lu_x",         label: "X",     group: "Lined Up (in-app)", fmt: "pct", width: 52, weightBy: "lu_snaps", tooltip: "% of his in-app snaps outside and on the line of scrimmage (X / split end), either side" },
  { key: "lu_z",         label: "Z",     group: "Lined Up (in-app)", fmt: "pct", width: 52, weightBy: "lu_snaps", tooltip: "% of his in-app snaps outside and off the line (Z / flanker), either side" },
  { key: "lu_left",      label: "Left",  group: "Lined Up (in-app)", fmt: "pct", width: 54, weightBy: "lu_snaps", tooltip: "% of his in-app snaps outside on the left, on or off the line" },
  { key: "lu_right",     label: "Right", group: "Lined Up (in-app)", fmt: "pct", width: 56, weightBy: "lu_snaps", tooltip: "% of his in-app snaps outside on the right, on or off the line" },
  { key: "lu_backfield", label: "Bkfld", group: "Lined Up (in-app)", fmt: "pct", width: 56, weightBy: "lu_snaps", tooltip: "% of his in-app snaps in the backfield" },
  { key: "lu_snaps",     label: "Snaps", group: "Lined Up (in-app)", fmt: "count", width: 52, tooltip: "Snaps charted in the app, runs included, which these shares come from. Imported games are left out: the import entered whole games, not plays." },
  // Open% by Alignment
  { key: "open_slot",      label: "Slot%",  group: "Open% by Alignment", fmt: "pct", colorDir: 1, width: 60, weightBy: "align_n_slot" },
  { key: "open_left",      label: "Left%",  group: "Open% by Alignment", fmt: "pct", colorDir: 1, width: 58, weightBy: "align_n_left" },
  { key: "open_right",     label: "Right%", group: "Open% by Alignment", fmt: "pct", colorDir: 1, width: 62, weightBy: "align_n_right" },
  { key: "open_backfield", label: "Bkfld%", group: "Open% by Alignment", fmt: "pct", colorDir: 1, width: 62, weightBy: "align_n_backfield" },
  // Open% On / Off Line — weighted by per-cell route counts
  { key: "open_slot_on",   label: "SlotOn%",  group: "Open% On/Off LOS", fmt: "pct", colorDir: 1, width: 70, weightBy: "align_n_slot_on_line" },
  { key: "open_slot_off",  label: "SlotOff%", group: "Open% On/Off LOS", fmt: "pct", colorDir: 1, width: 72, weightBy: "align_n_slot_off_line" },
  { key: "open_left_on",   label: "LftOn%",   group: "Open% On/Off LOS", fmt: "pct", colorDir: 1, width: 66, weightBy: "align_n_left_on_line" },
  { key: "open_left_off",  label: "LftOff%",  group: "Open% On/Off LOS", fmt: "pct", colorDir: 1, width: 68, weightBy: "align_n_left_off_line" },
  { key: "open_right_on",  label: "RgtOn%",   group: "Open% On/Off LOS", fmt: "pct", colorDir: 1, width: 68, weightBy: "align_n_right_on_line" },
  { key: "open_right_off", label: "RgtOff%",  group: "Open% On/Off LOS", fmt: "pct", colorDir: 1, width: 70, weightBy: "align_n_right_off_line" },
  // By Route
  { key: "rt_nine",     label: ROUTE_LABELS.nine,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 52, weightBy: "rt_nine_n" },
  { key: "rt_post",     label: ROUTE_LABELS.post,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 52, weightBy: "rt_post_n" },
  { key: "rt_dig",      label: ROUTE_LABELS.dig,      group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48, weightBy: "rt_dig_n" },
  { key: "rt_curl",     label: ROUTE_LABELS.curl,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 50, weightBy: "rt_curl_n" },
  { key: "rt_slant",    label: ROUTE_LABELS.slant,    group: "Open% by Route", fmt: "pct", colorDir: 1, width: 52, weightBy: "rt_slant_n" },
  { key: "rt_screen",   label: ROUTE_LABELS.screen,   group: "Open% by Route", fmt: "pct", colorDir: 1, width: 50, weightBy: "rt_screen_n" },
  { key: "rt_flat",     label: ROUTE_LABELS.flat,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48, weightBy: "rt_flat_n" },
  { key: "rt_comeback", label: ROUTE_LABELS.comeback, group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48, weightBy: "rt_comeback_n" },
  { key: "rt_out",      label: ROUTE_LABELS.out,      group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48, weightBy: "rt_out_n" },
  { key: "rt_corner",   label: ROUTE_LABELS.corner,   group: "Open% by Route", fmt: "pct", colorDir: 1, width: 50, weightBy: "rt_corner_n" },
  { key: "rt_other",    label: ROUTE_LABELS.other,    group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48, weightBy: "rt_other_n" },
  // Raw
  { key: "raw_tgts",     label: "Tgts",    group: "Raw", fmt: "count", width: 48 },
  { key: "raw_catches",  label: "Catch",   group: "Raw", fmt: "count", width: 50 },
  { key: "raw_drops",    label: "Drops",   group: "Raw", fmt: "count", width: 50 },
  { key: "raw_cont_tgt", label: "ContTgt", group: "Raw", fmt: "count", width: 60 },
  { key: "raw_cont_ctch",label: "ContCtch",group: "Raw", fmt: "count", width: 68 },
  { key: "raw_snaps",    label: "Snaps",   group: "Raw", fmt: "count", width: 52 },
  { key: "raw_routes",   label: "Routes",  group: "Raw", fmt: "count", width: 58 },
  // PFF over the charted games (yards live here: none are typed in the app)
  // The tag-only stats (tagged routes only)
  ...tagCols("WR"),
  ...pffCols("WR"),
];

function routeOpenPct(p: ProspectWithStats, rt: string): number | null {
  const s = p.route_stats[rt as keyof typeof p.route_stats];
  if (!s || s.count === 0 || !p.has_charted_open_data) return null;
  return parseFloat(((s.open / s.count) * 100).toFixed(1));
}

// Minimum-sample thresholds for the analysis table. Tiny denominators surface
// as eye-catching 0%/100% values that aren't meaningful — suppress them here
// (the per-prospect profile page still shows the raw %).
const MIN_MAN_ROUTES = 15;   // applied to combined man + press
const MIN_ZONE_ROUTES = 15;
const MIN_PRESS_ROUTES = 10;

function cvgOpenPct(p: ProspectWithStats, cvg: "man" | "zone" | "double" | "press"): number | null {
  if (!p.has_charted_open_data) return null;
  // Press is a subtype of Man — combine press into man's numerator/denominator
  // for the % calc so Man% reflects all man-style coverage. Press% still uses
  // press alone.
  if (cvg === "man") {
    const m = p.coverage_stats.man;
    const pr = p.coverage_stats.press;
    const total = m.count + pr.count;
    if (total < MIN_MAN_ROUTES) return null;
    return parseFloat((((m.open + pr.open) / total) * 100).toFixed(1));
  }
  const s = p.coverage_stats[cvg];
  if (!s || s.count === 0) return null;
  if (cvg === "zone" && s.count < MIN_ZONE_ROUTES) return null;
  if (cvg === "press" && s.count < MIN_PRESS_ROUTES) return null;
  return parseFloat(((s.open / s.count) * 100).toFixed(1));
}

// Each spot's share of his in-app snaps; "—" (null) with none charted in the app.
function linedUpShares(lu: LinedUp | null) {
  const share = (n: number) => (lu && lu.snaps > 0 ? parseFloat(((n / lu.snaps) * 100).toFixed(1)) : null);
  return {
    lu_slot: share((lu?.slot_on ?? 0) + (lu?.slot_off ?? 0)),
    lu_x: share((lu?.left_on ?? 0) + (lu?.right_on ?? 0)),
    lu_z: share((lu?.left_off ?? 0) + (lu?.right_off ?? 0)),
    lu_left: share((lu?.left_on ?? 0) + (lu?.left_off ?? 0)),
    lu_right: share((lu?.right_on ?? 0) + (lu?.right_off ?? 0)),
    lu_backfield: share(lu?.backfield ?? 0),
    lu_snaps: lu?.snaps ?? 0,
  };
}

// Extracted so the Phase I player-comparison tool can compute the same rows
// for any two WR prospects without duplicating this logic.
export function buildWRStatRows(prospectsWithStats: ProspectWithStats[], pff?: Map<string, PffTotals>, tags?: Map<string, Record<string, TagStatValue>>): StatRow[] {
  return prospectsWithStats
      .filter((p) => p.position === "WR")
      .map((p) => ({
        id: p.id,
        name: p.name,
        yr: p.draft_class_year,
        g: p.total_games,
        snaps: p.total_snaps,
        routes: p.total_routes,
        ...roleFitRow("WR", p.role_fit),
        sae: p.adj_success_above_exp,
        core_sae: p.core_sae,
        open_pct: p.success_rate,
        tgt_pct: p.target_rate,
        catch_pct: p.targets > 0 ? parseFloat(((p.catches / p.targets) * 100).toFixed(1)) : null,
        drop_pct: p.targets > 0 ? parseFloat(((p.drops / p.targets) * 100).toFixed(1)) : null,
        cont_tgt_pct: p.total_routes > 0 ? parseFloat(((p.contested / p.total_routes) * 100).toFixed(1)) : null,
        cont_catch_pct: p.contested > 0 ? parseFloat(((p.contested_catches / p.contested) * 100).toFixed(1)) : null,
        // Coverage
        cvg_man_open: cvgOpenPct(p, "man"),
        cvg_zone_open: cvgOpenPct(p, "zone"),
        cvg_double_open: cvgOpenPct(p, "double"),
        cvg_press_open: cvgOpenPct(p, "press"),
        // Hidden counts for weighted league totals — Man weight includes press
        // since the Man% calc combines them. Press weight stays press-only so
        // its column remains its own metric.
        cvg_man_n: p.coverage_stats.man.count + p.coverage_stats.press.count,
        cvg_zone_n: p.coverage_stats.zone.count,
        cvg_double_n: p.coverage_stats.double.count,
        cvg_press_n: p.coverage_stats.press.count,
        // Lined up (in-app routes)
        ...linedUpShares(p.lined_up),
        // Alignment
        open_slot: p.open_pct_slot,
        open_left: p.open_pct_left,
        open_right: p.open_pct_right,
        open_backfield: p.open_pct_backfield,
        // True per-cell route counts from the source data (used for weighted league totals)
        align_n_slot: p.align_n_slot,
        align_n_left: p.align_n_left,
        align_n_right: p.align_n_right,
        align_n_backfield: p.align_n_backfield,
        align_n_slot_on_line: p.align_n_slot_on_line,
        align_n_slot_off_line: p.align_n_slot_off_line,
        align_n_left_on_line: p.align_n_left_on_line,
        align_n_left_off_line: p.align_n_left_off_line,
        align_n_right_on_line: p.align_n_right_on_line,
        align_n_right_off_line: p.align_n_right_off_line,
        // On/Off line
        open_slot_on: p.open_pct_slot_on_line,
        open_slot_off: p.open_pct_slot_off_line,
        open_left_on: p.open_pct_left_on_line,
        open_left_off: p.open_pct_left_off_line,
        open_right_on: p.open_pct_right_on_line,
        open_right_off: p.open_pct_right_off_line,
        // By route
        rt_nine: routeOpenPct(p, "nine"),
        rt_post: routeOpenPct(p, "post"),
        rt_dig: routeOpenPct(p, "dig"),
        rt_curl: routeOpenPct(p, "curl"),
        rt_slant: routeOpenPct(p, "slant"),
        rt_screen: routeOpenPct(p, "screen"),
        rt_flat: routeOpenPct(p, "flat"),
        rt_comeback: routeOpenPct(p, "comeback"),
        rt_out: routeOpenPct(p, "out"),
        rt_corner: routeOpenPct(p, "corner"),
        rt_other: routeOpenPct(p, "other"),
        // Hidden route counts for weighted league totals
        rt_nine_n: p.route_stats.nine?.count ?? 0,
        rt_post_n: p.route_stats.post?.count ?? 0,
        rt_dig_n: p.route_stats.dig?.count ?? 0,
        rt_curl_n: p.route_stats.curl?.count ?? 0,
        rt_slant_n: p.route_stats.slant?.count ?? 0,
        rt_screen_n: p.route_stats.screen?.count ?? 0,
        rt_flat_n: p.route_stats.flat?.count ?? 0,
        rt_comeback_n: p.route_stats.comeback?.count ?? 0,
        rt_out_n: p.route_stats.out?.count ?? 0,
        rt_corner_n: p.route_stats.corner?.count ?? 0,
        rt_other_n: p.route_stats.other?.count ?? 0,
        // Raw
        raw_tgts: p.targets,
        raw_catches: p.catches,
        raw_drops: p.drops,
        raw_cont_tgt: p.contested,
        raw_cont_ctch: p.contested_catches,
        raw_snaps: p.total_snaps,
        raw_routes: p.total_routes,
        ...tagRow("WR", tags?.get(p.id)),
        ...pffRow(pff?.get(p.id)),
      }));
}

// "Min …" boxes beside the search bar — hide prospects below a sample size.
const WR_MIN_FILTERS: MinFilterDef[] = [{ key: "routes", label: "Routes" }];

export default function WRStatsTable({ prospectsWithStats, loading, draftYearFilter, onSelectProspect, pffTotals, routeTagCells }: Props) {
  const prospectMap = useMemo(() => new Map(prospectsWithStats.map((p) => [p.id, p])), [prospectsWithStats]);
  const tags = useMemo(() => tagValuesFor({ games: [], wrTagRows: routeTagCells ?? [] }), [routeTagCells]);
  const rows = useMemo(() => buildWRStatRows(prospectsWithStats, pffTotals, tags), [prospectsWithStats, pffTotals, tags]);

  return (
    <StatsTableShell
      cols={WR_STAT_COLS}
      rows={rows}
      minFilters={WR_MIN_FILTERS}
      defaultSortKey="sae"
      defaultSortDir="desc"
      loading={loading}
      draftYearFilter={draftYearFilter}
      onNameClick={onSelectProspect ? (id) => { const p = prospectMap.get(id); if (p) onSelectProspect(p); } : undefined}
    />
  );
}
