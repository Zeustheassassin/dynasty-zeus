"use client";
import { useMemo } from "react";
import StatsTableShell, { StatRow, ColDef } from "./StatsTableShell";
import { computeTERouteAboveExpected, computeTEBlockAboveExpected } from "../../../lib/scouting/aboveExpected";
import type { Prospect, ScoutingGame, TEPlay, TEPositioning, TELocation, TECoverage } from "../../../lib/types";

interface Props {
  prospects: Prospect[];
  games: ScoutingGame[];
  tePlays: TEPlay[];
  loading?: boolean;
  draftYearFilter?: number | null;
  onSelectProspect?: (p: Prospect) => void;
}

const POSITIONINGS: TEPositioning[] = ["wide", "slot", "inline", "full_back", "running_back", "wing_back"];
const LOCATIONS: TELocation[] = ["left", "right", "backfield"];
const COVERAGES: TECoverage[] = ["man", "zone", "press", "double"];
const ROUTE_TYPES = ["nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other"] as const;
const ROUTE_LABELS: Record<string, string> = {
  nine: "Go", post: "Post", dig: "Dig", curl: "Curl", slant: "Slant",
  screen: "Scr", flat: "Flat", comeback: "CB", out: "Out", corner: "Cor", other: "Oth",
};

export const TE_STAT_COLS: ColDef[] = [
  // Identity
  { key: "name",    label: "Name",   group: "Identity", fmt: "name",  sticky: true, width: 160 },
  { key: "yr",      label: "Yr",     group: "Identity", fmt: "yr",    width: 46 },
  { key: "g",       label: "G",      group: "Identity", fmt: "count", width: 40 },
  { key: "snaps",   label: "Snaps",  group: "Identity", fmt: "count", width: 52 },
  { key: "routes",  label: "Routes", group: "Identity", fmt: "count", width: 58 },
  { key: "blocks",  label: "Blocks", group: "Identity", fmt: "count", width: 58 },
  // Advanced
  { key: "te_saer",    label: "TE-SAER", group: "Advanced", fmt: "plusMinus", colorDir: 1,  width: 76, tooltip: "Route SAE — Open Rate Above Expected, adjusted for positioning & coverage mix (15+ rated routes)", leagueOverride: 0 },
  { key: "te_saeb",    label: "TE-SAEB", group: "Advanced", fmt: "plusMinus", colorDir: 1,  width: 76, tooltip: "Block SAE — Block Success Above Expected, adjusted for run/pass-block & movement/inline mix (15+ rated blocks)", leagueOverride: 0 },
  { key: "open_pct",   label: "Open%",   group: "Advanced", fmt: "pct",       colorDir: 1,  width: 62, weightBy: "rated_routes_n" },
  { key: "tgt_pct",    label: "Tgt%",    group: "Advanced", fmt: "pct",       colorDir: 1,  width: 58, weightBy: "routes" },
  { key: "catch_pct",  label: "Catch%",  group: "Advanced", fmt: "pct",       colorDir: 1,  width: 62, weightBy: "raw_tgts" },
  { key: "drop_pct",   label: "Drop%",   group: "Advanced", fmt: "pct",       colorDir: -1, width: 60, weightBy: "raw_tgts" },
  { key: "cont_tgt_pct",  label: "ContTgt%",  group: "Advanced", fmt: "pct", colorDir: -1, width: 72, weightBy: "routes" },
  { key: "cont_catch_pct",label: "ContCatch%",group: "Advanced", fmt: "pct", colorDir: 1,  width: 78, weightBy: "raw_cont_tgt" },
  { key: "btk_pct",    label: "BTkl%",   group: "Advanced", fmt: "pct",       colorDir: 1,  width: 60, weightBy: "snaps" },
  // By Positioning
  { key: "pos_wide_open",  label: "Wide%",  group: "By Positioning", fmt: "pct", colorDir: 1, width: 60, weightBy: "pos_wide_rated_n" },
  { key: "pos_slot_open",  label: "Slot%",  group: "By Positioning", fmt: "pct", colorDir: 1, width: 58, weightBy: "pos_slot_rated_n" },
  { key: "pos_inln_open",  label: "Inln%",  group: "By Positioning", fmt: "pct", colorDir: 1, width: 58, tooltip: "Inline open%", weightBy: "pos_inln_rated_n" },
  { key: "pos_fb_open",    label: "FB%",    group: "By Positioning", fmt: "pct", colorDir: 1, width: 52, weightBy: "pos_fb_rated_n" },
  { key: "pos_rb_open",    label: "RB%",    group: "By Positioning", fmt: "pct", colorDir: 1, width: 52, weightBy: "pos_rb_rated_n" },
  { key: "pos_wb_open",    label: "WB%",    group: "By Positioning", fmt: "pct", colorDir: 1, width: 52, weightBy: "pos_wb_rated_n" },
  { key: "pos_wide_n",  label: "Wide#",  group: "By Positioning", fmt: "count", width: 56 },
  { key: "pos_slot_n",  label: "Slot#",  group: "By Positioning", fmt: "count", width: 54 },
  { key: "pos_inln_n",  label: "Inln#",  group: "By Positioning", fmt: "count", width: 54 },
  // By Location
  { key: "loc_left_open",     label: "Left%",  group: "By Location", fmt: "pct", colorDir: 1, width: 58, weightBy: "loc_left_rated_n" },
  { key: "loc_right_open",    label: "Right%", group: "By Location", fmt: "pct", colorDir: 1, width: 62, weightBy: "loc_right_rated_n" },
  { key: "loc_backfield_open",label: "Bkfld%", group: "By Location", fmt: "pct", colorDir: 1, width: 62, weightBy: "loc_backfield_rated_n" },
  // By Coverage
  { key: "cvg_man_open",    label: "Man%",   group: "By Coverage", fmt: "pct", colorDir: 1, width: 58, weightBy: "cvg_man_rated_n" },
  { key: "cvg_zone_open",   label: "Zone%",  group: "By Coverage", fmt: "pct", colorDir: 1, width: 60, weightBy: "cvg_zone_rated_n" },
  { key: "cvg_press_open",  label: "Press%", group: "By Coverage", fmt: "pct", colorDir: 1, width: 62, weightBy: "cvg_press_rated_n" },
  { key: "cvg_double_open", label: "Dbl%",   group: "By Coverage", fmt: "pct", colorDir: 1, width: 56, weightBy: "cvg_double_rated_n" },
  // By Route
  { key: "rt_nine",     label: ROUTE_LABELS.nine,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 52, weightBy: "rt_nine_rated_n" },
  { key: "rt_post",     label: ROUTE_LABELS.post,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 52, weightBy: "rt_post_rated_n" },
  { key: "rt_dig",      label: ROUTE_LABELS.dig,      group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48, weightBy: "rt_dig_rated_n" },
  { key: "rt_curl",     label: ROUTE_LABELS.curl,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 50, weightBy: "rt_curl_rated_n" },
  { key: "rt_slant",    label: ROUTE_LABELS.slant,    group: "Open% by Route", fmt: "pct", colorDir: 1, width: 52, weightBy: "rt_slant_rated_n" },
  { key: "rt_screen",   label: ROUTE_LABELS.screen,   group: "Open% by Route", fmt: "pct", colorDir: 1, width: 50, weightBy: "rt_screen_rated_n" },
  { key: "rt_flat",     label: ROUTE_LABELS.flat,     group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48, weightBy: "rt_flat_rated_n" },
  { key: "rt_comeback", label: ROUTE_LABELS.comeback, group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48, weightBy: "rt_comeback_rated_n" },
  { key: "rt_out",      label: ROUTE_LABELS.out,      group: "Open% by Route", fmt: "pct", colorDir: 1, width: 48, weightBy: "rt_out_rated_n" },
  { key: "rt_corner",   label: ROUTE_LABELS.corner,   group: "Open% by Route", fmt: "pct", colorDir: 1, width: 50, weightBy: "rt_corner_rated_n" },
  // Blocking
  { key: "blk_succ",       label: "Blk%",      group: "Blocking", fmt: "pct", colorDir: 1, width: 56, tooltip: "Overall block success%", weightBy: "blocks" },
  { key: "run_blk_succ",   label: "RunBlk%",   group: "Blocking", fmt: "pct", colorDir: 1, width: 66, weightBy: "run_blk_n" },
  { key: "pass_blk_succ",  label: "PsBlk%",    group: "Blocking", fmt: "pct", colorDir: 1, width: 64, weightBy: "pass_blk_n" },
  { key: "mvmt_blk_succ",  label: "MvmtBlk%",  group: "Blocking", fmt: "pct", colorDir: 1, width: 72, tooltip: "Movement block success%", weightBy: "mvmt_blk_n" },
  { key: "inln_blk_succ",  label: "InlnBlk%",  group: "Blocking", fmt: "pct", colorDir: 1, width: 72, tooltip: "Inline block success%", weightBy: "inln_blk_n" },
  // Raw
  { key: "raw_routes",   label: "Routes", group: "Raw", fmt: "count", width: 58 },
  { key: "raw_blocks",   label: "Blocks", group: "Raw", fmt: "count", width: 58 },
  { key: "raw_decoys",   label: "Decoys", group: "Raw", fmt: "count", width: 58 },
  { key: "raw_tgts",     label: "Tgts",   group: "Raw", fmt: "count", width: 48 },
  { key: "raw_catches",  label: "Catch",  group: "Raw", fmt: "count", width: 50 },
  { key: "raw_drops",    label: "Drops",  group: "Raw", fmt: "count", width: 50 },
  { key: "raw_cont_tgt", label: "ContTgt",group: "Raw", fmt: "count", width: 60 },
  { key: "raw_cont_ctch",label: "ContCtch",group:"Raw", fmt: "count", width: 68 },
  { key: "raw_btk",      label: "BTkl",   group: "Raw", fmt: "count", width: 46 },
  // No YPC column — TEPlay doesn't track yards (unlike WR's route_plays),
  // so there's no real data to show; a fake 0.0 for every player is worse
  // than no column at all.
];

function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return parseFloat(((n / d) * 100).toFixed(1));
}

function openPct(plays: TEPlay[], filter: (p: TEPlay) => boolean): number | null {
  const sub = plays.filter(filter).filter((p) => p.was_open !== null);
  if (sub.length === 0) return null;
  return pct(sub.filter((p) => p.was_open === true).length, sub.length);
}

// Minimum-sample thresholds for the By Coverage columns — same values as
// WRStatsTable's cvgOpenPct: tiny denominators surface as eye-catching
// 0%/100% values that aren't meaningful. Only applied to coverage (not
// positioning/location/route) columns, matching WR's precedent.
const MIN_MAN_ROUTES = 15;   // applied to combined man + press
const MIN_ZONE_ROUTES = 15;
const MIN_PRESS_ROUTES = 10;

function cvgOpenPct(routePlays: TEPlay[], cvg: "man" | "zone" | "press" | "double"): number | null {
  const filter = cvg === "man"
    ? (pl: TEPlay) => pl.coverage === "man" || pl.coverage === "press"
    : (pl: TEPlay) => pl.coverage === cvg;
  const sub = routePlays.filter(filter).filter((p) => p.was_open !== null);
  if (cvg === "man" && sub.length < MIN_MAN_ROUTES) return null;
  if (cvg === "zone" && sub.length < MIN_ZONE_ROUTES) return null;
  if (cvg === "press" && sub.length < MIN_PRESS_ROUTES) return null;
  if (sub.length === 0) return null;
  return pct(sub.filter((p) => p.was_open === true).length, sub.length);
}

function blkSuccPct(plays: TEPlay[], filter: (p: TEPlay) => boolean): number | null {
  const sub = plays.filter(filter).filter((p) => p.block_success !== null);
  if (sub.length === 0) return null;
  return pct(sub.filter((p) => p.block_success === true).length, sub.length);
}

// Extracted so the Phase I player-comparison tool can compute the same rows
// for any two TE prospects without duplicating this logic.
export function buildTEStatRows(prospects: Prospect[], games: ScoutingGame[], tePlays: TEPlay[]): StatRow[] {
    const teSaerMap = computeTERouteAboveExpected(prospects, games, tePlays);
    const teSaebMap = computeTEBlockAboveExpected(prospects, games, tePlays);
    const gameToProspect = new Map<string, string>();
    for (const g of games) gameToProspect.set(g.id, g.prospect_id);

    const playsByProspect = new Map<string, TEPlay[]>();
    for (const pl of tePlays) {
      const pid = gameToProspect.get(pl.game_id);
      if (!pid) continue;
      if (!playsByProspect.has(pid)) playsByProspect.set(pid, []);
      playsByProspect.get(pid)!.push(pl);
    }

    const gamesByProspect = new Map<string, number>();
    for (const g of games) {
      gamesByProspect.set(g.prospect_id, (gamesByProspect.get(g.prospect_id) ?? 0) + 1);
    }

    return prospects
      .filter((p) => p.position === "TE")
      .map((p) => {
        const pPlays = playsByProspect.get(p.id) ?? [];
        const routePlays = pPlays.filter((pl) => pl.play_type === "route_run");
        const blockPlays = pPlays.filter((pl) => pl.play_type === "run_block" || pl.play_type === "pass_block");
        const decoyPlays = pPlays.filter((pl) => pl.play_type === "decoy");
        const ratedRoutes = routePlays.filter((pl) => pl.was_open !== null);
        const tgts = routePlays.filter((pl) => pl.targeted === true);
        const catches = tgts.filter((pl) => pl.caught === true);
        const drops = tgts.filter((pl) => pl.dropped === true);
        const contTgt = routePlays.filter((pl) => pl.contested_target === true);
        const contCatch = contTgt.filter((pl) => pl.contested_catch === true);
        const btk = pPlays.filter((pl) => pl.broken_tackle).length;

        const te_saer = teSaerMap.get(p.id) ?? null;
        const te_saeb = teSaebMap.get(p.id) ?? null;

        return {
          id: p.id,
          name: p.name,
          yr: p.draft_class_year,
          g: gamesByProspect.get(p.id) ?? 0,
          snaps: pPlays.length,
          routes: routePlays.length,
          blocks: blockPlays.length,
          rated_routes_n: ratedRoutes.length,
          te_saer,
          te_saeb,
          open_pct: pct(ratedRoutes.filter((pl) => pl.was_open).length, ratedRoutes.length),
          tgt_pct: pct(tgts.length, routePlays.length),
          catch_pct: pct(catches.length, tgts.length),
          drop_pct: pct(drops.length, tgts.length),
          cont_tgt_pct: pct(contTgt.length, routePlays.length),
          cont_catch_pct: pct(contCatch.length, contTgt.length),
          btk_pct: pct(btk, pPlays.length),
          // By positioning
          ...Object.fromEntries(
            POSITIONINGS.map((pos) => {
              const key = pos === "full_back" ? "fb" : pos === "running_back" ? "rb" : pos === "wing_back" ? "wb" : pos === "inline" ? "inln" : pos;
              return [`pos_${key}_open`, openPct(routePlays, (pl) => pl.positioning === pos)];
            })
          ),
          // Hidden rated counts per positioning (matches openPct's filter — rated routes only)
          ...Object.fromEntries(
            POSITIONINGS.map((pos) => {
              const key = pos === "full_back" ? "fb" : pos === "running_back" ? "rb" : pos === "wing_back" ? "wb" : pos === "inline" ? "inln" : pos;
              return [`pos_${key}_rated_n`, ratedRoutes.filter((pl) => pl.positioning === pos).length];
            })
          ),
          pos_wide_n: routePlays.filter((pl) => pl.positioning === "wide").length,
          pos_slot_n: routePlays.filter((pl) => pl.positioning === "slot").length,
          pos_inln_n: routePlays.filter((pl) => pl.positioning === "inline").length,
          // By location
          ...Object.fromEntries(
            LOCATIONS.map((loc) => [`loc_${loc}_open`, openPct(routePlays, (pl) => pl.location === loc)])
          ),
          ...Object.fromEntries(
            LOCATIONS.map((loc) => [`loc_${loc}_rated_n`, ratedRoutes.filter((pl) => pl.location === loc).length])
          ),
          // By coverage — Press is a subtype of Man, so press routes are added
          // into Man's numerator/denominator for the % calc. Press still
          // appears as its own column. Total routes are unchanged.
          ...Object.fromEntries(
            COVERAGES.map((cvg) => [`cvg_${cvg}_open`, cvgOpenPct(routePlays, cvg)])
          ),
          ...Object.fromEntries(
            COVERAGES.map((cvg) => [
              `cvg_${cvg}_rated_n`,
              cvg === "man"
                ? ratedRoutes.filter((pl) => pl.coverage === "man" || pl.coverage === "press").length
                : ratedRoutes.filter((pl) => pl.coverage === cvg).length,
            ])
          ),
          // By route
          ...Object.fromEntries(
            ROUTE_TYPES.map((rt) => [`rt_${rt}`, openPct(routePlays, (pl) => pl.route_type === rt)])
          ),
          ...Object.fromEntries(
            ROUTE_TYPES.map((rt) => [`rt_${rt}_rated_n`, ratedRoutes.filter((pl) => pl.route_type === rt).length])
          ),
          // Blocking
          blk_succ:      blkSuccPct(blockPlays, () => true),
          run_blk_succ:  blkSuccPct(blockPlays, (pl) => pl.play_type === "run_block"),
          pass_blk_succ: blkSuccPct(blockPlays, (pl) => pl.play_type === "pass_block"),
          mvmt_blk_succ: blkSuccPct(blockPlays, (pl) => pl.block_type === "movement"),
          inln_blk_succ: blkSuccPct(blockPlays, (pl) => pl.block_type === "inline"),
          run_blk_n:  blockPlays.filter((pl) => pl.play_type === "run_block").length,
          pass_blk_n: blockPlays.filter((pl) => pl.play_type === "pass_block").length,
          mvmt_blk_n: blockPlays.filter((pl) => pl.block_type === "movement").length,
          inln_blk_n: blockPlays.filter((pl) => pl.block_type === "inline").length,
          // Raw
          raw_routes:   routePlays.length,
          raw_blocks:   blockPlays.length,
          raw_decoys:   decoyPlays.length,
          raw_tgts:     tgts.length,
          raw_catches:  catches.length,
          raw_drops:    drops.length,
          raw_cont_tgt: contTgt.length,
          raw_cont_ctch: contCatch.length,
          raw_btk:      btk,
        } satisfies StatRow;
      });
}

export default function TEStatsTable({ prospects, games, tePlays, loading, draftYearFilter, onSelectProspect }: Props) {
  const prospectMap = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const rows = useMemo(() => buildTEStatRows(prospects, games, tePlays), [prospects, games, tePlays]);

  return (
    <StatsTableShell
      cols={TE_STAT_COLS}
      rows={rows}
      defaultSortKey="te_saer"
      defaultSortDir="desc"
      loading={loading}
      draftYearFilter={draftYearFilter}
      onNameClick={onSelectProspect ? (id) => { const p = prospectMap.get(id); if (p) onSelectProspect(p); } : undefined}
    />
  );
}
