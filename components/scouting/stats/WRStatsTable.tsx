"use client";
import { useMemo } from "react";
import StatsTableShell, { StatRow, ColDef } from "./StatsTableShell";
import type { Prospect, ProspectWithStats } from "../../../lib/types";

interface Props {
  prospectsWithStats: ProspectWithStats[];
  loading?: boolean;
  draftYearFilter?: number | null;
  onSelectProspect?: (p: Prospect) => void;
}

const ROUTE_LABELS: Record<string, string> = {
  nine: "Go", post: "Post", dig: "Dig", curl: "Curl", slant: "Slant",
  screen: "Scr", flat: "Flat", comeback: "CB", out: "Out", corner: "Cor", other: "Oth",
};

const COLS: ColDef[] = [
  // Identity
  { key: "name",   label: "Name",    group: "Identity", fmt: "name", sticky: true, width: 160 },
  { key: "yr",     label: "Yr",      group: "Identity", fmt: "yr",   width: 46 },
  { key: "g",      label: "G",       group: "Identity", fmt: "count", width: 40 },
  { key: "snaps",  label: "Snaps",   group: "Identity", fmt: "count", width: 52 },
  { key: "routes", label: "Routes",  group: "Identity", fmt: "count", width: 58 },
  // Advanced
  { key: "sae",      label: "SAE",    group: "Advanced", fmt: "plusMinus", colorDir: 1,  width: 62, tooltip: "Success (Open) Rate Above Expected — vs league avg adjusted for route mix & coverage" },
  { key: "open_pct", label: "Open%",  group: "Advanced", fmt: "pct",       colorDir: 1,  width: 62, tooltip: "% of routes where player was open" },
  { key: "tgt_pct",  label: "Tgt%",   group: "Advanced", fmt: "pct",       colorDir: 1,  width: 58, tooltip: "Targets per route run" },
  { key: "catch_pct",label: "Catch%", group: "Advanced", fmt: "pct",       colorDir: 1,  width: 62, tooltip: "Catches per target" },
  { key: "drop_pct", label: "Drop%",  group: "Advanced", fmt: "pct",       colorDir: -1, width: 60, tooltip: "Drops per target" },
  { key: "cont_tgt_pct",   label: "ContTgt%",   group: "Advanced", fmt: "pct", colorDir: -1, width: 72 },
  { key: "cont_catch_pct", label: "ContCatch%", group: "Advanced", fmt: "pct", colorDir: 1,  width: 78 },
  // By Coverage
  { key: "cvg_man_open",    label: "Man%",    group: "By Coverage", fmt: "pct", colorDir: 1, width: 60 },
  { key: "cvg_zone_open",   label: "Zone%",   group: "By Coverage", fmt: "pct", colorDir: 1, width: 62 },
  { key: "cvg_double_open", label: "Dbl%",    group: "By Coverage", fmt: "pct", colorDir: 1, width: 58 },
  { key: "cvg_press_open",  label: "Press%",  group: "By Coverage", fmt: "pct", colorDir: 1, width: 62 },
  // By Alignment
  { key: "open_slot",      label: "Slot%",  group: "By Alignment", fmt: "pct", colorDir: 1, width: 60 },
  { key: "open_left",      label: "Left%",  group: "By Alignment", fmt: "pct", colorDir: 1, width: 58 },
  { key: "open_right",     label: "Right%", group: "By Alignment", fmt: "pct", colorDir: 1, width: 62 },
  { key: "open_backfield", label: "Bkfld%", group: "By Alignment", fmt: "pct", colorDir: 1, width: 62 },
  // On / Off Line
  { key: "open_slot_on",   label: "SlotOn%",  group: "On/Off LOS", fmt: "pct", colorDir: 1, width: 70 },
  { key: "open_slot_off",  label: "SlotOff%", group: "On/Off LOS", fmt: "pct", colorDir: 1, width: 72 },
  { key: "open_left_on",   label: "LftOn%",   group: "On/Off LOS", fmt: "pct", colorDir: 1, width: 66 },
  { key: "open_left_off",  label: "LftOff%",  group: "On/Off LOS", fmt: "pct", colorDir: 1, width: 68 },
  { key: "open_right_on",  label: "RgtOn%",   group: "On/Off LOS", fmt: "pct", colorDir: 1, width: 68 },
  { key: "open_right_off", label: "RgtOff%",  group: "On/Off LOS", fmt: "pct", colorDir: 1, width: 70 },
  // By Route
  { key: "rt_nine",     label: ROUTE_LABELS.nine,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 52 },
  { key: "rt_post",     label: ROUTE_LABELS.post,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 52 },
  { key: "rt_dig",      label: ROUTE_LABELS.dig,      group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48 },
  { key: "rt_curl",     label: ROUTE_LABELS.curl,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 50 },
  { key: "rt_slant",    label: ROUTE_LABELS.slant,    group: "Open% by Route", fmt: "pct", colorDir: 1, width: 52 },
  { key: "rt_screen",   label: ROUTE_LABELS.screen,   group: "Open% by Route", fmt: "pct", colorDir: 1, width: 50 },
  { key: "rt_flat",     label: ROUTE_LABELS.flat,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48 },
  { key: "rt_comeback", label: ROUTE_LABELS.comeback, group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48 },
  { key: "rt_out",      label: ROUTE_LABELS.out,      group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48 },
  { key: "rt_corner",   label: ROUTE_LABELS.corner,   group: "Open% by Route", fmt: "pct", colorDir: 1, width: 50 },
  { key: "rt_other",    label: ROUTE_LABELS.other,    group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48 },
  // Raw
  { key: "raw_tgts",     label: "Tgts",    group: "Raw", fmt: "count", width: 48 },
  { key: "raw_catches",  label: "Catch",   group: "Raw", fmt: "count", width: 50 },
  { key: "raw_drops",    label: "Drops",   group: "Raw", fmt: "count", width: 50 },
  { key: "raw_cont_tgt", label: "ContTgt", group: "Raw", fmt: "count", width: 60 },
  { key: "raw_cont_ctch",label: "ContCtch",group: "Raw", fmt: "count", width: 68 },
  { key: "raw_yards",    label: "Yards",   group: "Raw", fmt: "count", width: 52 },
  { key: "ypc",          label: "YPC",     group: "Raw", fmt: "dec1",  colorDir: 1, width: 50 },
  { key: "raw_snaps",    label: "Snaps",   group: "Raw", fmt: "count", width: 52 },
  { key: "raw_routes",   label: "Routes",  group: "Raw", fmt: "count", width: 58 },
];

function routeOpenPct(p: ProspectWithStats, rt: string): number | null {
  const s = p.route_stats[rt as keyof typeof p.route_stats];
  if (!s || s.count === 0 || !p.has_charted_open_data) return null;
  return parseFloat(((s.open / s.count) * 100).toFixed(1));
}

function cvgOpenPct(p: ProspectWithStats, cvg: "man" | "zone" | "double" | "press"): number | null {
  const s = p.coverage_stats[cvg];
  if (!s || s.count === 0 || !p.has_charted_open_data) return null;
  return parseFloat(((s.open / s.count) * 100).toFixed(1));
}

export default function WRStatsTable({ prospectsWithStats, loading, draftYearFilter, onSelectProspect }: Props) {
  const prospectMap = useMemo(() => new Map(prospectsWithStats.map((p) => [p.id, p])), [prospectsWithStats]);
  const rows = useMemo((): StatRow[] =>
    prospectsWithStats
      .filter((p) => p.position === "WR")
      .map((p) => ({
        id: p.id,
        name: p.name,
        yr: p.draft_class_year,
        g: p.total_games,
        snaps: p.total_snaps,
        routes: p.total_routes,
        sae: p.adj_success_above_exp,
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
        // Alignment
        open_slot: p.open_pct_slot,
        open_left: p.open_pct_left,
        open_right: p.open_pct_right,
        open_backfield: p.open_pct_backfield,
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
        // Raw
        raw_tgts: p.targets,
        raw_catches: p.catches,
        raw_drops: p.drops,
        raw_cont_tgt: p.contested,
        raw_cont_ctch: p.contested_catches,
        raw_yards: p.total_yards,
        ypc: p.avg_ypc,
        raw_snaps: p.total_snaps,
        raw_routes: p.total_routes,
      })),
    [prospectsWithStats]);

  return (
    <StatsTableShell
      cols={COLS}
      rows={rows}
      defaultSortKey="sae"
      defaultSortDir="desc"
      loading={loading}
      draftYearFilter={draftYearFilter}
      onNameClick={onSelectProspect ? (id) => { const p = prospectMap.get(id); if (p) onSelectProspect(p); } : undefined}
    />
  );
}
