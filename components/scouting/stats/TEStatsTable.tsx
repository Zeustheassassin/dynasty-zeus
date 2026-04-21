"use client";
import { useMemo } from "react";
import StatsTableShell, { StatRow, ColDef } from "./StatsTableShell";
import type { Prospect, ScoutingGame, TEPlay, TEPositioning, TELocation, TECoverage } from "../../../lib/types";

interface Props {
  prospects: Prospect[];
  games: ScoutingGame[];
  tePlays: TEPlay[];
  loading?: boolean;
  draftYearFilter?: number | null;
  onSelectProspect?: (p: Prospect) => void;
}

const POSITIONINGS: TEPositioning[] = ["wide", "slot", "inline", "full_back", "running_back"];
const LOCATIONS: TELocation[] = ["left", "right", "backfield"];
const COVERAGES: TECoverage[] = ["man", "zone", "press", "double"];
const ROUTE_TYPES = ["nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other"] as const;
const ROUTE_LABELS: Record<string, string> = {
  nine: "Go", post: "Post", dig: "Dig", curl: "Curl", slant: "Slant",
  screen: "Scr", flat: "Flat", comeback: "CB", out: "Out", corner: "Cor", other: "Oth",
};

const COLS: ColDef[] = [
  // Identity
  { key: "name",    label: "Name",   group: "Identity", fmt: "name",  sticky: true, width: 160 },
  { key: "yr",      label: "Yr",     group: "Identity", fmt: "yr",    width: 46 },
  { key: "g",       label: "G",      group: "Identity", fmt: "count", width: 40 },
  { key: "snaps",   label: "Snaps",  group: "Identity", fmt: "count", width: 52 },
  { key: "routes",  label: "Routes", group: "Identity", fmt: "count", width: 58 },
  { key: "blocks",  label: "Blocks", group: "Identity", fmt: "count", width: 58 },
  // Advanced
  { key: "te_sae",     label: "TE-SAE",  group: "Advanced", fmt: "plusMinus", colorDir: 1,  width: 70, tooltip: "Open Rate Above Expected — vs league avg adjusted for positioning & coverage mix" },
  { key: "open_pct",   label: "Open%",   group: "Advanced", fmt: "pct",       colorDir: 1,  width: 62 },
  { key: "tgt_pct",    label: "Tgt%",    group: "Advanced", fmt: "pct",       colorDir: 1,  width: 58 },
  { key: "catch_pct",  label: "Catch%",  group: "Advanced", fmt: "pct",       colorDir: 1,  width: 62 },
  { key: "drop_pct",   label: "Drop%",   group: "Advanced", fmt: "pct",       colorDir: -1, width: 60 },
  { key: "cont_tgt_pct",  label: "ContTgt%",  group: "Advanced", fmt: "pct", colorDir: -1, width: 72 },
  { key: "cont_catch_pct",label: "ContCatch%",group: "Advanced", fmt: "pct", colorDir: 1,  width: 78 },
  { key: "btk_pct",    label: "BTkl%",   group: "Advanced", fmt: "pct",       colorDir: 1,  width: 60 },
  // By Positioning
  { key: "pos_wide_open",  label: "Wide%",  group: "By Positioning", fmt: "pct", colorDir: 1, width: 60 },
  { key: "pos_slot_open",  label: "Slot%",  group: "By Positioning", fmt: "pct", colorDir: 1, width: 58 },
  { key: "pos_inln_open",  label: "Inln%",  group: "By Positioning", fmt: "pct", colorDir: 1, width: 58, tooltip: "Inline open%" },
  { key: "pos_fb_open",    label: "FB%",    group: "By Positioning", fmt: "pct", colorDir: 1, width: 52 },
  { key: "pos_rb_open",    label: "RB%",    group: "By Positioning", fmt: "pct", colorDir: 1, width: 52 },
  { key: "pos_wide_n",  label: "Wide#",  group: "By Positioning", fmt: "count", width: 56 },
  { key: "pos_slot_n",  label: "Slot#",  group: "By Positioning", fmt: "count", width: 54 },
  { key: "pos_inln_n",  label: "Inln#",  group: "By Positioning", fmt: "count", width: 54 },
  // By Location
  { key: "loc_left_open",     label: "Left%",  group: "By Location", fmt: "pct", colorDir: 1, width: 58 },
  { key: "loc_right_open",    label: "Right%", group: "By Location", fmt: "pct", colorDir: 1, width: 62 },
  { key: "loc_backfield_open",label: "Bkfld%", group: "By Location", fmt: "pct", colorDir: 1, width: 62 },
  // By Coverage
  { key: "cvg_man_open",    label: "Man%",   group: "By Coverage", fmt: "pct", colorDir: 1, width: 58 },
  { key: "cvg_zone_open",   label: "Zone%",  group: "By Coverage", fmt: "pct", colorDir: 1, width: 60 },
  { key: "cvg_press_open",  label: "Press%", group: "By Coverage", fmt: "pct", colorDir: 1, width: 62 },
  { key: "cvg_double_open", label: "Dbl%",   group: "By Coverage", fmt: "pct", colorDir: 1, width: 56 },
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
  // Blocking
  { key: "blk_succ",       label: "Blk%",      group: "Blocking", fmt: "pct", colorDir: 1, width: 56, tooltip: "Overall block success%" },
  { key: "run_blk_succ",   label: "RunBlk%",   group: "Blocking", fmt: "pct", colorDir: 1, width: 66 },
  { key: "pass_blk_succ",  label: "PsBlk%",    group: "Blocking", fmt: "pct", colorDir: 1, width: 64 },
  { key: "mvmt_blk_succ",  label: "MvmtBlk%",  group: "Blocking", fmt: "pct", colorDir: 1, width: 72, tooltip: "Movement block success%" },
  { key: "inln_blk_succ",  label: "InlnBlk%",  group: "Blocking", fmt: "pct", colorDir: 1, width: 72, tooltip: "Inline block success%" },
  // Raw
  { key: "raw_routes",   label: "Routes", group: "Raw", fmt: "count", width: 58 },
  { key: "raw_blocks",   label: "Blocks", group: "Raw", fmt: "count", width: 58 },
  { key: "raw_tgts",     label: "Tgts",   group: "Raw", fmt: "count", width: 48 },
  { key: "raw_catches",  label: "Catch",  group: "Raw", fmt: "count", width: 50 },
  { key: "raw_drops",    label: "Drops",  group: "Raw", fmt: "count", width: 50 },
  { key: "raw_cont_tgt", label: "ContTgt",group: "Raw", fmt: "count", width: 60 },
  { key: "raw_cont_ctch",label: "ContCtch",group:"Raw", fmt: "count", width: 68 },
  { key: "raw_btk",      label: "BTkl",   group: "Raw", fmt: "count", width: 46 },
  { key: "ypc",          label: "YPC",    group: "Raw", fmt: "dec1",  colorDir: 1, width: 50 },
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

function blkSuccPct(plays: TEPlay[], filter: (p: TEPlay) => boolean): number | null {
  const sub = plays.filter(filter).filter((p) => p.block_success !== null);
  if (sub.length === 0) return null;
  return pct(sub.filter((p) => p.block_success === true).length, sub.length);
}

export default function TEStatsTable({ prospects, games, tePlays, loading, draftYearFilter, onSelectProspect }: Props) {
  const prospectMap = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const rows = useMemo((): StatRow[] => {
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

    // League-wide open rates for TE-SAE
    const lgPos: Partial<Record<TEPositioning, { open: number; n: number }>> = {};
    const lgCvg: Partial<Record<TECoverage, { open: number; n: number }>> = {};
    for (const pl of tePlays) {
      if (pl.play_type !== "route_run" || pl.was_open === null) continue;
      if (!lgPos[pl.positioning]) lgPos[pl.positioning] = { open: 0, n: 0 };
      lgPos[pl.positioning]!.n++;
      if (pl.was_open) lgPos[pl.positioning]!.open++;
      if (pl.coverage) {
        if (!lgCvg[pl.coverage]) lgCvg[pl.coverage] = { open: 0, n: 0 };
        lgCvg[pl.coverage]!.n++;
        if (pl.was_open) lgCvg[pl.coverage]!.open++;
      }
    }

    return prospects
      .filter((p) => p.position === "TE")
      .map((p) => {
        const pPlays = playsByProspect.get(p.id) ?? [];
        const routePlays = pPlays.filter((pl) => pl.play_type === "route_run");
        const blockPlays = pPlays.filter((pl) => pl.play_type === "run_block" || pl.play_type === "pass_block");
        const ratedRoutes = routePlays.filter((pl) => pl.was_open !== null);
        const tgts = routePlays.filter((pl) => pl.targeted === true);
        const catches = tgts.filter((pl) => pl.caught === true);
        const drops = tgts.filter((pl) => pl.dropped === true);
        const contTgt = routePlays.filter((pl) => pl.contested_target === true);
        const contCatch = contTgt.filter((pl) => pl.contested_catch === true);
        const yds = 0; // TEPlay has no yards field
        const btk = pPlays.filter((pl) => pl.broken_tackle).length;

        // TE-SAE
        let te_sae: number | null = null;
        if (ratedRoutes.length >= 20) {
          const actual = ratedRoutes.filter((pl) => pl.was_open).length / ratedRoutes.length;
          let expPos = 0, posW = 0;
          for (const pos of POSITIONINGS) {
            const posN = ratedRoutes.filter((pl) => pl.positioning === pos).length;
            const lg = lgPos[pos];
            if (posN > 0 && lg && lg.n > 0) { expPos += (posN / ratedRoutes.length) * (lg.open / lg.n); posW += posN / ratedRoutes.length; }
          }
          let expCvg = 0, cvgW = 0;
          for (const cvg of COVERAGES) {
            const cN = ratedRoutes.filter((pl) => pl.coverage === cvg).length;
            const lg = lgCvg[cvg];
            if (cN > 0 && lg && lg.n > 0) { expCvg += (cN / ratedRoutes.length) * (lg.open / lg.n); cvgW += cN / ratedRoutes.length; }
          }
          let combined: number | null = null;
          if (posW > 0 && cvgW > 0) combined = (expPos + expCvg) / 2;
          else if (posW > 0) combined = expPos;
          else if (cvgW > 0) combined = expCvg;
          if (combined != null) te_sae = parseFloat(((actual - combined) * 100).toFixed(2));
        }

        return {
          id: p.id,
          name: p.name,
          yr: p.draft_class_year,
          g: gamesByProspect.get(p.id) ?? 0,
          snaps: pPlays.length,
          routes: routePlays.length,
          blocks: blockPlays.length,
          te_sae,
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
              const key = pos === "full_back" ? "fb" : pos === "running_back" ? "rb" : pos === "inline" ? "inln" : pos;
              return [`pos_${key}_open`, openPct(routePlays, (pl) => pl.positioning === pos)];
            })
          ),
          pos_wide_n: routePlays.filter((pl) => pl.positioning === "wide").length,
          pos_slot_n: routePlays.filter((pl) => pl.positioning === "slot").length,
          pos_inln_n: routePlays.filter((pl) => pl.positioning === "inline").length,
          // By location
          ...Object.fromEntries(
            LOCATIONS.map((loc) => [`loc_${loc}_open`, openPct(routePlays, (pl) => pl.location === loc)])
          ),
          // By coverage
          ...Object.fromEntries(
            COVERAGES.map((cvg) => [`cvg_${cvg}_open`, openPct(routePlays, (pl) => pl.coverage === cvg)])
          ),
          // By route
          ...Object.fromEntries(
            ROUTE_TYPES.map((rt) => [`rt_${rt}`, openPct(routePlays, (pl) => pl.route_type === rt)])
          ),
          // Blocking
          blk_succ:      blkSuccPct(blockPlays, () => true),
          run_blk_succ:  blkSuccPct(blockPlays, (pl) => pl.play_type === "run_block"),
          pass_blk_succ: blkSuccPct(blockPlays, (pl) => pl.play_type === "pass_block"),
          mvmt_blk_succ: blkSuccPct(blockPlays, (pl) => pl.block_type === "movement"),
          inln_blk_succ: blkSuccPct(blockPlays, (pl) => pl.block_type === "inline"),
          // Raw
          raw_routes:   routePlays.length,
          raw_blocks:   blockPlays.length,
          raw_tgts:     tgts.length,
          raw_catches:  catches.length,
          raw_drops:    drops.length,
          raw_cont_tgt: contTgt.length,
          raw_cont_ctch: contCatch.length,
          raw_btk:      btk,
          ypc: yds,
        } satisfies StatRow;
      });
  }, [prospects, games, tePlays]);

  return (
    <StatsTableShell
      cols={COLS}
      rows={rows}
      defaultSortKey="te_sae"
      defaultSortDir="desc"
      loading={loading}
      draftYearFilter={draftYearFilter}
      onNameClick={onSelectProspect ? (id) => { const p = prospectMap.get(id); if (p) onSelectProspect(p); } : undefined}
    />
  );
}
