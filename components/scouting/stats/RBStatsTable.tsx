"use client";
import { useMemo } from "react";
import StatsTableShell, { StatRow, ColDef } from "./StatsTableShell";
import { computeRBAboveExpected } from "../../../lib/scouting/aboveExpected";
import type { Prospect, ScoutingGame, RBPlay, RBRunType } from "../../../lib/types";

interface Props {
  prospects: Prospect[];
  games: ScoutingGame[];
  rbPlays: RBPlay[];
  loading?: boolean;
  draftYearFilter?: number | null;
  onSelectProspect?: (p: Prospect) => void;
}

const RUN_TYPES: RBRunType[] = ["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"];

const COLS: ColDef[] = [
  // Identity
  { key: "name",    label: "Name",   group: "Identity", fmt: "name",  sticky: true, width: 160 },
  { key: "yr",      label: "Yr",     group: "Identity", fmt: "yr",    width: 46 },
  { key: "g",       label: "G",      group: "Identity", fmt: "count", width: 40 },
  { key: "snaps",   label: "Snaps",  group: "Identity", fmt: "count", width: 52 },
  { key: "runs",    label: "Runs",   group: "Identity", fmt: "count", width: 48 },
  // Advanced
  { key: "srae",         label: "SRAE",     group: "Advanced", fmt: "plusMinus", colorDir: 1,  width: 66, tooltip: "Success Rate Above Expected — vs league avg adjusted for formation and box mix", leagueOverride: 0 },
  { key: "succ_pct",     label: "Succ%",    group: "Advanced", fmt: "pct",       colorDir: 1,  width: 60, tooltip: "Success rate on all rushing attempts", weightBy: "runs" },
  { key: "explosive_pct",label: "Expl%",    group: "Advanced", fmt: "pct",       colorDir: 1,  width: 58, tooltip: "Explosive play rate (run_type flagged explosive)", weightBy: "snaps" },
  { key: "stuff_pct",    label: "Stuff%",   group: "Advanced", fmt: "pct",       colorDir: -1, width: 56, tooltip: "Run stuff rate (stopped at or behind LOS)", weightBy: "runs" },
  { key: "btk_pct",      label: "BTkl%",    group: "Advanced", fmt: "pct",       colorDir: 1,  width: 58, tooltip: "Broken tackle rate per rush attempt", weightBy: "runs" },
  // By Run Type
  { key: "oz_pct",   label: "OZ%",  group: "By Run Type", fmt: "pct", colorDir: 1, width: 54, tooltip: "Outside Zone success%", weightBy: "oz_n" },
  { key: "iz_pct",   label: "IZ%",  group: "By Run Type", fmt: "pct", colorDir: 1, width: 52, tooltip: "Inside Zone success%", weightBy: "iz_n" },
  { key: "omg_pct",  label: "OMG%", group: "By Run Type", fmt: "pct", colorDir: 1, width: 56, tooltip: "Outside Man Gap success%", weightBy: "omg_n" },
  { key: "img_pct",  label: "IMG%", group: "By Run Type", fmt: "pct", colorDir: 1, width: 56, tooltip: "Inside Man Gap success%", weightBy: "img_n" },
  { key: "oz_n",     label: "OZ#",  group: "By Run Type", fmt: "count", width: 48 },
  { key: "iz_n",     label: "IZ#",  group: "By Run Type", fmt: "count", width: 46 },
  { key: "omg_n",    label: "OMG#", group: "By Run Type", fmt: "count", width: 52 },
  { key: "img_n",    label: "IMG#", group: "By Run Type", fmt: "count", width: 52 },
  // By Formation
  { key: "gun_succ",  label: "Gun%",    group: "By Formation", fmt: "pct", colorDir: 1, width: 58, weightBy: "gun_n" },
  { key: "pistol_succ",label: "Pistol%",group: "By Formation", fmt: "pct", colorDir: 1, width: 64, weightBy: "pistol_n" },
  { key: "uc_succ",   label: "UC%",     group: "By Formation", fmt: "pct", colorDir: 1, width: 52, tooltip: "Under Center success%", weightBy: "uc_n" },
  { key: "gun_n",     label: "Gun#",    group: "By Formation", fmt: "count", width: 52 },
  { key: "pistol_n",  label: "Pstl#",  group: "By Formation", fmt: "count", width: 52 },
  { key: "uc_n",      label: "UC#",     group: "By Formation", fmt: "count", width: 46 },
  // Box Situations
  { key: "unloaded_succ", label: "Unldd%",  group: "Box Situations", fmt: "pct", colorDir: 1, width: 64, tooltip: "Success% vs unloaded box", weightBy: "unloaded_n" },
  { key: "loaded_succ",   label: "Ldd%",    group: "Box Situations", fmt: "pct", colorDir: 1, width: 56, tooltip: "Success% vs loaded box", weightBy: "loaded_n" },
  { key: "unblk_succ",    label: "Unblk%",  group: "Box Situations", fmt: "pct", colorDir: 1, width: 62, tooltip: "Success% with unblocked defender", weightBy: "unblk_n" },
  { key: "loaded_n",      label: "Ldd#",    group: "Box Situations", fmt: "count", width: 50 },
  { key: "unblk_n",       label: "Unblk#",  group: "Box Situations", fmt: "count", width: 56 },
  // Blocking
  { key: "pb_succ",  label: "PB%",   group: "Blocking", fmt: "pct",   colorDir: 1,  width: 52, tooltip: "Pass Block success%", weightBy: "pb_n" },
  { key: "rb_succ",  label: "RB%",   group: "Blocking", fmt: "pct",   colorDir: 1,  width: 52, tooltip: "Run Block success%", weightBy: "rb_n" },
  { key: "pb_n",     label: "PB#",   group: "Blocking", fmt: "count",               width: 48, tooltip: "Pass Block attempts" },
  { key: "rb_n",     label: "RB#",   group: "Blocking", fmt: "count",               width: 48, tooltip: "Run Block attempts" },
  { key: "decoy_n",  label: "Decoy", group: "Blocking", fmt: "count",               width: 52, tooltip: "Decoy plays" },
  // Receiving
  { key: "rec_routes",  label: "Routes",  group: "Receiving", fmt: "count", width: 58 },
  { key: "rec_tgts",    label: "Tgts",    group: "Receiving", fmt: "count", width: 48 },
  { key: "rec_tgt_pct", label: "Tgt%",    group: "Receiving", fmt: "pct", colorDir: 1, width: 54, weightBy: "rec_routes" },
  { key: "rec_catch_pct",label: "Catch%", group: "Receiving", fmt: "pct", colorDir: 1, width: 60, weightBy: "rec_tgts" },
  { key: "rec_open_pct", label: "Open%",  group: "Receiving", fmt: "pct", colorDir: 1, width: 58, tooltip: "% of routes where RB was open", weightBy: "rec_routes" },
  { key: "wr_aligned_pct",label: "WR%",  group: "Receiving", fmt: "pct", colorDir: 1, width: 52, tooltip: "% of snaps aligned as WR", weightBy: "raw_snaps" },
  // Raw
  { key: "raw_snaps",      label: "Snaps",    group: "Raw", fmt: "count", width: 52 },
  { key: "raw_runs",       label: "Runs",     group: "Raw", fmt: "count", width: 46 },
  { key: "raw_explosive",  label: "Expl",     group: "Raw", fmt: "count", width: 46 },
  { key: "raw_stuff",      label: "Stuff",    group: "Raw", fmt: "count", width: 46 },
  { key: "raw_btk",        label: "BTkl",     group: "Raw", fmt: "count", width: 46 },
  { key: "raw_tgts",       label: "Tgts",     group: "Raw", fmt: "count", width: 46 },
  { key: "raw_catches",    label: "Catch",    group: "Raw", fmt: "count", width: 50 },
];

function succPct(plays: RBPlay[], filter: (p: RBPlay) => boolean): number | null {
  const sub = plays.filter(filter);
  if (sub.length === 0) return null;
  const known = sub.filter((p) => p.success !== null);
  if (known.length === 0) return null;
  return parseFloat(((known.filter((p) => p.success === true).length / known.length) * 100).toFixed(1));
}

function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return parseFloat(((n / d) * 100).toFixed(1));
}

export default function RBStatsTable({ prospects, games, rbPlays, loading, draftYearFilter, onSelectProspect }: Props) {
  const prospectMap = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const sraeMap = useMemo(() => computeRBAboveExpected(prospects, games, rbPlays), [prospects, games, rbPlays]);
  const rows = useMemo((): StatRow[] => {
    // Build game → prospect map
    const gameToProspect = new Map<string, string>();
    for (const g of games) gameToProspect.set(g.id, g.prospect_id);

    // Group plays by prospect
    const playsByProspect = new Map<string, RBPlay[]>();
    for (const pl of rbPlays) {
      const pid = gameToProspect.get(pl.game_id);
      if (!pid) continue;
      if (!playsByProspect.has(pid)) playsByProspect.set(pid, []);
      playsByProspect.get(pid)!.push(pl);
    }

    // Game count per prospect
    const gamesByProspect = new Map<string, number>();
    for (const g of games) {
      gamesByProspect.set(g.prospect_id, (gamesByProspect.get(g.prospect_id) ?? 0) + 1);
    }

    return prospects
      .filter((p) => p.position === "RB")
      .map((p) => {
        const pPlays = playsByProspect.get(p.id) ?? [];
        const runPlays = pPlays.filter((pl) => RUN_TYPES.includes(pl.run_type as RBRunType));
        const routePlays = pPlays.filter((pl) => pl.run_type === "route");

        const srae = sraeMap.get(p.id) ?? null;

        const oz = runPlays.filter((pl) => pl.run_type === "outside_zone");
        const iz = runPlays.filter((pl) => pl.run_type === "inside_zone");
        const omg = runPlays.filter((pl) => pl.run_type === "outside_man_gap");
        const img = runPlays.filter((pl) => pl.run_type === "inside_man_gap");

        const passBlockPlays = pPlays.filter((pl) => pl.run_type === "pass_block");
        const runBlockPlays  = pPlays.filter((pl) => pl.run_type === "run_block");
        const decoyPlays     = pPlays.filter((pl) => pl.run_type === "decoy");
        const recTgts    = routePlays.filter((pl) => pl.targeted).length;
        const recCatches = routePlays.filter((pl) => pl.targeted && pl.success === true).length;
        const recOpen    = routePlays.filter((pl) => pl.was_open).length;
        const wrAligned  = pPlays.filter((pl) => pl.aligned_as_wr).length;

        return {
          id: p.id,
          name: p.name,
          yr: p.draft_class_year,
          g: gamesByProspect.get(p.id) ?? 0,
          snaps: pPlays.length,
          runs: runPlays.length,
          srae,
          succ_pct: succPct(runPlays, () => true),
          explosive_pct: pct(pPlays.filter((pl) => pl.explosive_play).length, pPlays.length),
          stuff_pct: pct(pPlays.filter((pl) => pl.run_stuff).length, runPlays.length),
          btk_pct: pct(pPlays.filter((pl) => pl.broken_tackle).length, runPlays.length),
          // By run type
          oz_pct:  succPct(oz,  () => true),
          iz_pct:  succPct(iz,  () => true),
          omg_pct: succPct(omg, () => true),
          img_pct: succPct(img, () => true),
          oz_n: oz.length,
          iz_n: iz.length,
          omg_n: omg.length,
          img_n: img.length,
          // By formation
          gun_succ:    succPct(runPlays, (pl) => pl.formation === "gun"),
          pistol_succ: succPct(runPlays, (pl) => pl.formation === "pistol"),
          uc_succ:     succPct(runPlays, (pl) => pl.formation === "under_center"),
          gun_n:    runPlays.filter((pl) => pl.formation === "gun").length,
          pistol_n: runPlays.filter((pl) => pl.formation === "pistol").length,
          uc_n:     runPlays.filter((pl) => pl.formation === "under_center").length,
          // Box
          unloaded_succ: succPct(runPlays, (pl) => !pl.loaded_box),
          loaded_succ:   succPct(runPlays, (pl) => pl.loaded_box),
          unblk_succ:    succPct(runPlays, (pl) => pl.unblocked_defender),
          loaded_n: runPlays.filter((pl) => pl.loaded_box).length,
          unloaded_n: runPlays.filter((pl) => !pl.loaded_box).length,
          unblk_n:  runPlays.filter((pl) => pl.unblocked_defender).length,
          // Blocking
          pb_succ:  succPct(passBlockPlays, () => true),
          rb_succ:  succPct(runBlockPlays,  () => true),
          pb_n:     passBlockPlays.length,
          rb_n:     runBlockPlays.length,
          decoy_n:  decoyPlays.length,
          // Receiving
          rec_routes:    routePlays.length,
          rec_tgts:      recTgts,
          rec_tgt_pct:   pct(recTgts, routePlays.length),
          rec_catch_pct: pct(recCatches, recTgts),
          rec_open_pct:  pct(recOpen, routePlays.length),
          wr_aligned_pct: pct(wrAligned, pPlays.length),
          // Raw
          raw_snaps:     pPlays.length,
          raw_runs:      runPlays.length,
          raw_explosive: pPlays.filter((pl) => pl.explosive_play).length,
          raw_stuff:     pPlays.filter((pl) => pl.run_stuff).length,
          raw_btk:       pPlays.filter((pl) => pl.broken_tackle).length,
          raw_tgts:      recTgts,
          raw_catches:   recCatches,
        } satisfies StatRow;
      });
  }, [prospects, games, rbPlays, sraeMap]);

  return (
    <StatsTableShell
      cols={COLS}
      rows={rows}
      defaultSortKey="srae"
      defaultSortDir="desc"
      loading={loading}
      draftYearFilter={draftYearFilter}
      onNameClick={onSelectProspect ? (id) => { const p = prospectMap.get(id); if (p) onSelectProspect(p); } : undefined}
    />
  );
}
