"use client";
import { useMemo } from "react";
import StatsTableShell, { StatRow, ColDef } from "./StatsTableShell";
import type { Prospect, ScoutingGame, QBPlay, QBDepthZone, QBSnapPosition } from "../../../lib/types";

interface Props {
  prospects: Prospect[];
  games: ScoutingGame[];
  qbPlays: QBPlay[];
  loading?: boolean;
  draftYearFilter?: number | null;
}

const DEPTH_ZONES: QBDepthZone[] = [
  "deep_left", "deep_center", "deep_right",
  "mid_left",  "mid_center",  "mid_right",
  "short_left","short_center","short_right",
];
const SNAP_POSITIONS: QBSnapPosition[] = ["shotgun", "pistol", "under_center"];

const COLS: ColDef[] = [
  // Identity
  { key: "name",    label: "Name",    group: "Identity", fmt: "name",  sticky: true, width: 160 },
  { key: "yr",      label: "Yr",      group: "Identity", fmt: "yr",    width: 46 },
  { key: "g",       label: "G",       group: "Identity", fmt: "count", width: 40 },
  { key: "snaps",   label: "Snaps",   group: "Identity", fmt: "count", width: 52 },
  { key: "passes",  label: "Pass",    group: "Identity", fmt: "count", width: 50 },
  // Advanced
  { key: "aae",        label: "AAE",      group: "Advanced", fmt: "plusMinus", colorDir: 1,  width: 62, tooltip: "Accuracy Above Expected — on-target% vs league avg adjusted for depth zone & coverage mix" },
  { key: "on_tgt_pct", label: "OnTgt%",   group: "Advanced", fmt: "pct",       colorDir: 1,  width: 66, tooltip: "% of pass attempts graded on-target (accuracy rated)" },
  { key: "pass_pct",   label: "Pass%",    group: "Advanced", fmt: "pct",       colorDir: 1,  width: 58, tooltip: "% of snaps that are pass plays" },
  { key: "run_pct",    label: "Run%",     group: "Advanced", fmt: "pct",       width: 54 },
  { key: "rpo_pct",    label: "RPO%",     group: "Advanced", fmt: "pct",       width: 54 },
  // Accuracy breakdown
  { key: "acc_high",     label: "High%",    group: "Accuracy", fmt: "pct", colorDir: -1, width: 60 },
  { key: "acc_low",      label: "Low%",     group: "Accuracy", fmt: "pct", colorDir: -1, width: 58 },
  { key: "acc_infront",  label: "InFrt%",   group: "Accuracy", fmt: "pct", colorDir: -1, width: 62 },
  { key: "acc_behind",   label: "Bhnd%",    group: "Accuracy", fmt: "pct", colorDir: -1, width: 62 },
  // By Depth
  { key: "deep_on_tgt",  label: "Deep%",   group: "By Depth", fmt: "pct", colorDir: 1, width: 62, tooltip: "On-target% on deep passes" },
  { key: "mid_on_tgt",   label: "Mid%",    group: "By Depth", fmt: "pct", colorDir: 1, width: 58, tooltip: "On-target% on mid passes" },
  { key: "short_on_tgt", label: "Short%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 62, tooltip: "On-target% on short passes" },
  { key: "deep_left_pct",   label: "DpL%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 52 },
  { key: "deep_center_pct", label: "DpC%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 52 },
  { key: "deep_right_pct",  label: "DpR%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 52 },
  { key: "mid_left_pct",    label: "MdL%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 52 },
  { key: "mid_center_pct",  label: "MdC%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 52 },
  { key: "mid_right_pct",   label: "MdR%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 52 },
  { key: "short_left_pct",  label: "ShL%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 52 },
  { key: "short_center_pct",label: "ShC%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 52 },
  { key: "short_right_pct", label: "ShR%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 52 },
  // By Coverage
  { key: "man_on_tgt",  label: "Man%",  group: "By Coverage", fmt: "pct", colorDir: 1, width: 58, tooltip: "On-target% vs man coverage" },
  { key: "zone_on_tgt", label: "Zone%", group: "By Coverage", fmt: "pct", colorDir: 1, width: 60, tooltip: "On-target% vs zone coverage" },
  // Timing
  { key: "t_first",    label: "1st%",  group: "Decision", fmt: "pct", colorDir: 1,  width: 54, tooltip: "% of passes thrown to first option" },
  { key: "t_second",   label: "2nd%",  group: "Decision", fmt: "pct", width: 54 },
  { key: "t_check",    label: "Chk%",  group: "Decision", fmt: "pct", width: 54, tooltip: "Checkdown rate" },
  { key: "t_sack",     label: "Sack%", group: "Decision", fmt: "pct", colorDir: -1, width: 58 },
  { key: "t_scramble", label: "Scr%",  group: "Decision", fmt: "pct", width: 58 },
  { key: "t_away",     label: "Away%", group: "Decision", fmt: "pct", width: 58, tooltip: "Throw away rate" },
  // Snap position
  { key: "shotgun_pct", label: "Gun%",    group: "Snap Position", fmt: "pct", width: 58 },
  { key: "pistol_pct",  label: "Pistol%", group: "Snap Position", fmt: "pct", width: 62 },
  { key: "uc_pct",      label: "UC%",     group: "Snap Position", fmt: "pct", width: 52, tooltip: "Under center%" },
  // Raw
  { key: "raw_snaps",   label: "Snaps",   group: "Raw", fmt: "count", width: 52 },
  { key: "raw_passes",  label: "Pass",    group: "Raw", fmt: "count", width: 46 },
  { key: "raw_runs",    label: "Runs",    group: "Raw", fmt: "count", width: 46 },
  { key: "raw_rpos",    label: "RPO",     group: "Raw", fmt: "count", width: 46 },
  { key: "raw_sacks",   label: "Sacks",   group: "Raw", fmt: "count", width: 50 },
  { key: "raw_aways",   label: "T.Away",  group: "Raw", fmt: "count", width: 56 },
  { key: "raw_scramble",label: "Scram",   group: "Raw", fmt: "count", width: 54 },
];

function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return parseFloat(((n / d) * 100).toFixed(1));
}

function onTgtPct(plays: QBPlay[]): number | null {
  const rated = plays.filter((p) => p.accuracy != null);
  if (rated.length === 0) return null;
  return pct(rated.filter((p) => p.accuracy === "on_target").length, rated.length);
}

export default function QBStatsTable({ prospects, games, qbPlays, loading, draftYearFilter }: Props) {
  const rows = useMemo((): StatRow[] => {
    const gameToProspect = new Map<string, string>();
    for (const g of games) gameToProspect.set(g.id, g.prospect_id);

    const playsByProspect = new Map<string, QBPlay[]>();
    for (const pl of qbPlays) {
      const pid = gameToProspect.get(pl.game_id);
      if (!pid) continue;
      if (!playsByProspect.has(pid)) playsByProspect.set(pid, []);
      playsByProspect.get(pid)!.push(pl);
    }

    const gamesByProspect = new Map<string, number>();
    for (const g of games) {
      gamesByProspect.set(g.prospect_id, (gamesByProspect.get(g.prospect_id) ?? 0) + 1);
    }

    // League-wide on-target rates per depth zone and coverage for AAE
    const lgDepth: Partial<Record<QBDepthZone, { ot: number; n: number }>> = {};
    const lgCvg: Record<"man" | "zone", { ot: number; n: number }> = { man: { ot: 0, n: 0 }, zone: { ot: 0, n: 0 } };
    for (const pl of qbPlays) {
      if (pl.play_type !== "pass" || pl.accuracy == null) continue;
      if (pl.depth_zone) {
        if (!lgDepth[pl.depth_zone]) lgDepth[pl.depth_zone] = { ot: 0, n: 0 };
        lgDepth[pl.depth_zone]!.n++;
        if (pl.accuracy === "on_target") lgDepth[pl.depth_zone]!.ot++;
      }
      if (pl.coverage === "man" || pl.coverage === "zone") {
        lgCvg[pl.coverage].n++;
        if (pl.accuracy === "on_target") lgCvg[pl.coverage].ot++;
      }
    }

    return prospects
      .filter((p) => p.position === "QB")
      .map((p) => {
        const pPlays = playsByProspect.get(p.id) ?? [];
        const passPlays = pPlays.filter((pl) => pl.play_type === "pass");
        const ratedPasses = passPlays.filter((pl) => pl.accuracy != null);

        // AAE
        let aae: number | null = null;
        if (ratedPasses.length >= 20) {
          const actual = ratedPasses.filter((pl) => pl.accuracy === "on_target").length / ratedPasses.length;
          let expDepth = 0, dW = 0;
          for (const dz of DEPTH_ZONES) {
            const dzN = ratedPasses.filter((pl) => pl.depth_zone === dz).length;
            const lg = lgDepth[dz];
            if (dzN > 0 && lg && lg.n > 0) { expDepth += (dzN / ratedPasses.length) * (lg.ot / lg.n); dW += dzN / ratedPasses.length; }
          }
          let expCvg = 0, cW = 0;
          for (const cvg of ["man", "zone"] as const) {
            const cN = ratedPasses.filter((pl) => pl.coverage === cvg).length;
            const lg = lgCvg[cvg];
            if (cN > 0 && lg.n > 0) { expCvg += (cN / ratedPasses.length) * (lg.ot / lg.n); cW += cN / ratedPasses.length; }
          }
          let combined: number | null = null;
          if (dW > 0 && cW > 0) combined = (expDepth + expCvg) / 2;
          else if (dW > 0) combined = expDepth;
          else if (cW > 0) combined = expCvg;
          if (combined != null) aae = parseFloat(((actual - combined) * 100).toFixed(2));
        }

        const timingTotal = passPlays.filter((pl) => pl.timing != null).length;

        const depthOnTgt = (zones: QBDepthZone[]): number | null => {
          const sub = ratedPasses.filter((pl) => pl.depth_zone && zones.includes(pl.depth_zone));
          return onTgtPct(sub);
        };

        return {
          id: p.id,
          name: p.name,
          yr: p.draft_class_year,
          g: gamesByProspect.get(p.id) ?? 0,
          snaps: pPlays.length,
          passes: passPlays.length,
          aae,
          on_tgt_pct: onTgtPct(ratedPasses),
          pass_pct: pct(passPlays.length, pPlays.length),
          run_pct: pct(pPlays.filter((pl) => pl.play_type === "run").length, pPlays.length),
          rpo_pct: pct(pPlays.filter((pl) => pl.play_type === "rpo").length, pPlays.length),
          // Accuracy
          acc_high:    pct(ratedPasses.filter((pl) => pl.accuracy === "high").length,     ratedPasses.length),
          acc_low:     pct(ratedPasses.filter((pl) => pl.accuracy === "low").length,      ratedPasses.length),
          acc_infront: pct(ratedPasses.filter((pl) => pl.accuracy === "in_front").length, ratedPasses.length),
          acc_behind:  pct(ratedPasses.filter((pl) => pl.accuracy === "behind").length,   ratedPasses.length),
          // Depth aggregates
          deep_on_tgt:  depthOnTgt(["deep_left",  "deep_center",  "deep_right"]),
          mid_on_tgt:   depthOnTgt(["mid_left",   "mid_center",   "mid_right"]),
          short_on_tgt: depthOnTgt(["short_left", "short_center", "short_right"]),
          // Per depth zone
          ...Object.fromEntries(
            DEPTH_ZONES.map((dz) => [
              `${dz.replace("_", "_")}_pct`,
              onTgtPct(ratedPasses.filter((pl) => pl.depth_zone === dz)),
            ])
          ),
          // Coverage
          man_on_tgt:  onTgtPct(ratedPasses.filter((pl) => pl.coverage === "man")),
          zone_on_tgt: onTgtPct(ratedPasses.filter((pl) => pl.coverage === "zone")),
          // Timing
          t_first:    pct(passPlays.filter((pl) => pl.timing === "first_option").length,  timingTotal),
          t_second:   pct(passPlays.filter((pl) => pl.timing === "second_option").length, timingTotal),
          t_check:    pct(passPlays.filter((pl) => pl.timing === "checkdown").length,     timingTotal),
          t_sack:     pct(passPlays.filter((pl) => pl.timing === "sack").length,          timingTotal),
          t_scramble: pct(passPlays.filter((pl) => pl.timing === "scramble").length,      timingTotal),
          t_away:     pct(passPlays.filter((pl) => pl.timing === "throw_away").length,    timingTotal),
          // Snap position
          ...Object.fromEntries(
            SNAP_POSITIONS.map((sp) => [
              `${sp === "under_center" ? "uc" : sp}_pct`,
              pct(pPlays.filter((pl) => pl.snap_position === sp).length, pPlays.length),
            ])
          ),
          // Raw
          raw_snaps:    pPlays.length,
          raw_passes:   passPlays.length,
          raw_runs:     pPlays.filter((pl) => pl.play_type === "run").length,
          raw_rpos:     pPlays.filter((pl) => pl.play_type === "rpo").length,
          raw_sacks:    passPlays.filter((pl) => pl.timing === "sack").length,
          raw_aways:    passPlays.filter((pl) => pl.timing === "throw_away").length,
          raw_scramble: passPlays.filter((pl) => pl.timing === "scramble").length,
        } satisfies StatRow;
      });
  }, [prospects, games, qbPlays]);

  return (
    <StatsTableShell
      cols={COLS}
      rows={rows}
      defaultSortKey="aae"
      defaultSortDir="desc"
      loading={loading}
      draftYearFilter={draftYearFilter}
    />
  );
}
