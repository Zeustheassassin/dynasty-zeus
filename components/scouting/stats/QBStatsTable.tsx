"use client";
import { useMemo } from "react";
import StatsTableShell, { StatRow, ColDef } from "./StatsTableShell";
import { computeQBAboveExpected, computeQBAAEBreakdownMap } from "../../../lib/scouting/aboveExpected";
import type { Prospect, ScoutingGame, QBPlay, QBDepthZone } from "../../../lib/types";

interface Props {
  prospects: Prospect[];
  games: ScoutingGame[];
  qbPlays: QBPlay[];
  loading?: boolean;
  draftYearFilter?: number | null;
  onSelectProspect?: (p: Prospect) => void;
}

const DEPTH_ZONES: QBDepthZone[] = [
  "deep_left", "deep_center", "deep_right",
  "mid_left",  "mid_center",  "mid_right",
  "short_left","short_center","short_right",
];

// Column scope is intentionally narrow: each column maps to a stat the user
// pointed at in the Overview screenshots. Snap-position / coverage / raw-count
// columns from the old build are gone — if you miss one, the Overview tab on
// the QB charting board still has the full picture.
const COLS: ColDef[] = [
  // Identity
  { key: "name",   label: "Name",  group: "Identity", fmt: "name",  sticky: true, width: 160 },
  { key: "yr",     label: "Yr",    group: "Identity", fmt: "yr",    width: 46 },
  { key: "g",      label: "G",     group: "Identity", fmt: "count", width: 40 },
  { key: "snaps",  label: "Snaps", group: "Identity", fmt: "count", width: 52 },

  // Overall AAE — play-weighted league mean ≈ 0 by construction. The footer is a
  // sanity check: if it drifts noticeably from 0, there are plays in the baseline
  // pool (e.g., other-year QBs) that aren't represented in the visible rows.
  { key: "aae", label: "AAE", group: "AAE", fmt: "plusMinus", colorDir: 1, width: 62,
    tooltip: "Accuracy Above Expected — overall (mean of non-null dimension rows). Min 25 graded passes.",
    weightBy: "rated_n" },

  // Per-dimension AAE (the same 6 dims as the Overview panel's AAE Breakdown).
  // Pressure Handling has no standalone AAE row — it's folded into the Pressure
  // cluster, though it still feeds the overall AAE total. See aboveExpected.ts.
  // Each weights the league row by the QB's count of dim-filled plays — same
  // subset used to compute that QB's per-dim AAE — so the math identity holds.
  { key: "aae_dpth", label: "AAE Dp", group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 70, tooltip: "AAE — Depth Zone", weightBy: "aae_dpth_n" },
  { key: "aae_cvg",  label: "AAE Cv", group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 70, tooltip: "AAE — Coverage",   weightBy: "aae_cvg_n" },
  { key: "aae_tmg",  label: "AAE Tm", group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 70, tooltip: "AAE — Timing",     weightBy: "aae_tmg_n" },
  { key: "aae_prs",  label: "AAE Pr", group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 70, tooltip: "AAE — Pressure",   weightBy: "aae_prs_n" },
  { key: "aae_plt",  label: "AAE Pl", group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 70, tooltip: "AAE — Platform",   weightBy: "aae_plt_n" },
  { key: "aae_rte",  label: "AAE Rt", group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 70, tooltip: "AAE — Route Type", weightBy: "aae_rte_n" },

  // Accuracy bucket distribution
  { key: "on_tgt_pct",  label: "OnTgt%", group: "Accuracy", fmt: "pct", colorDir: 1,  width: 66, tooltip: "% of graded throws on-target (tipped balls excluded)", weightBy: "rated_n" },
  { key: "acc_high",    label: "High%",  group: "Accuracy", fmt: "pct", colorDir: -1, width: 60, weightBy: "rated_n" },
  { key: "acc_low",     label: "Low%",   group: "Accuracy", fmt: "pct", colorDir: -1, width: 58, weightBy: "rated_n" },
  { key: "acc_infront", label: "InFrt%", group: "Accuracy", fmt: "pct", colorDir: -1, width: 62, weightBy: "rated_n" },
  { key: "acc_behind",  label: "Bhnd%",  group: "Accuracy", fmt: "pct", colorDir: -1, width: 62, weightBy: "rated_n" },

  // Outcomes
  { key: "catch_pct", label: "Catch%", group: "Outcomes", fmt: "pct", colorDir: 1,  width: 64, tooltip: "Caught / completion-tracked throws", weightBy: "comp_n" },
  { key: "touch_pct", label: "Touch%", group: "Outcomes", fmt: "pct", colorDir: 1,  width: 64, tooltip: "% of touch-charted graded throws marked Correct", weightBy: "touch_n" },
  { key: "int_pct",   label: "INT%",   group: "Outcomes", fmt: "pct", colorDir: -1, width: 56, weightBy: "comp_n" },

  // Depth tier
  { key: "deep_on_tgt",  label: "Deep%",  group: "By Depth", fmt: "pct", colorDir: 1, width: 62, tooltip: "On-target% on deep passes",  weightBy: "deep_n" },
  { key: "mid_on_tgt",   label: "Mid%",   group: "By Depth", fmt: "pct", colorDir: 1, width: 58, tooltip: "On-target% on mid passes",   weightBy: "mid_n" },
  { key: "short_on_tgt", label: "Short%", group: "By Depth", fmt: "pct", colorDir: 1, width: 62, tooltip: "On-target% on short passes", weightBy: "short_n" },

  // 3×3 depth zone grid
  { key: "deep_left_pct",    label: "DpL%", group: "Depth Zones", fmt: "pct", colorDir: 1, width: 52, weightBy: "deep_left_n" },
  { key: "deep_center_pct",  label: "DpC%", group: "Depth Zones", fmt: "pct", colorDir: 1, width: 52, weightBy: "deep_center_n" },
  { key: "deep_right_pct",   label: "DpR%", group: "Depth Zones", fmt: "pct", colorDir: 1, width: 52, weightBy: "deep_right_n" },
  { key: "mid_left_pct",     label: "MdL%", group: "Depth Zones", fmt: "pct", colorDir: 1, width: 52, weightBy: "mid_left_n" },
  { key: "mid_center_pct",   label: "MdC%", group: "Depth Zones", fmt: "pct", colorDir: 1, width: 52, weightBy: "mid_center_n" },
  { key: "mid_right_pct",    label: "MdR%", group: "Depth Zones", fmt: "pct", colorDir: 1, width: 52, weightBy: "mid_right_n" },
  { key: "short_left_pct",   label: "ShL%", group: "Depth Zones", fmt: "pct", colorDir: 1, width: 52, weightBy: "short_left_n" },
  { key: "short_center_pct", label: "ShC%", group: "Depth Zones", fmt: "pct", colorDir: 1, width: 52, weightBy: "short_center_n" },
  { key: "short_right_pct",  label: "ShR%", group: "Depth Zones", fmt: "pct", colorDir: 1, width: 52, weightBy: "short_right_n" },

  // Platform — share of throws + on-target% per of 4 buckets
  { key: "plat_on_share",   label: "OnPl%",    group: "Platform", fmt: "pct",            width: 60, tooltip: "% of graded throws made On Platform",          weightBy: "rated_n" },
  { key: "plat_on_ot",      label: "OnPl OT%", group: "Platform", fmt: "pct", colorDir: 1, width: 74, tooltip: "On-target% when On Platform",                 weightBy: "plat_on_n" },
  { key: "plat_off_share",  label: "OffPl%",   group: "Platform", fmt: "pct",            width: 60, tooltip: "% of graded throws made Off Platform",         weightBy: "rated_n" },
  { key: "plat_off_ot",     label: "OffPl OT%",group: "Platform", fmt: "pct", colorDir: 1, width: 76, tooltip: "On-target% when Off Platform",                weightBy: "plat_off_n" },
  { key: "plat_runs_share", label: "RunS%",    group: "Platform", fmt: "pct",            width: 60, tooltip: "% of graded throws On the Run — Strong Side",   weightBy: "rated_n" },
  { key: "plat_runs_ot",    label: "RunS OT%", group: "Platform", fmt: "pct", colorDir: 1, width: 74, tooltip: "On-target% On the Run — Strong Side",          weightBy: "plat_runs_n" },
  { key: "plat_runx_share", label: "RunX%",    group: "Platform", fmt: "pct",            width: 60, tooltip: "% of graded throws On the Run — Cross Body",    weightBy: "rated_n" },
  { key: "plat_runx_ot",    label: "RunX OT%", group: "Platform", fmt: "pct", colorDir: 1, width: 74, tooltip: "On-target% On the Run — Cross Body",           weightBy: "plat_runx_n" },

  // Pressure — share of pass/RPO + on-target% per of 4 buckets
  { key: "prs_clean_share", label: "Cln%",     group: "Pressure", fmt: "pct",            width: 56, tooltip: "% of pass/RPO plays in Clean Pocket",        weightBy: "passrpo_n" },
  { key: "prs_clean_ot",    label: "Cln OT%",  group: "Pressure", fmt: "pct", colorDir: 1, width: 70, tooltip: "On-target% from Clean Pocket",              weightBy: "prs_clean_graded_n" },
  { key: "prs_mid_share",   label: "Mid%",     group: "Pressure", fmt: "pct",            width: 56, tooltip: "% of pass/RPO with Mid Pressure",            weightBy: "passrpo_n" },
  { key: "prs_mid_ot",      label: "Mid OT%",  group: "Pressure", fmt: "pct", colorDir: 1, width: 70, tooltip: "On-target% with Mid Pressure",              weightBy: "prs_mid_graded_n" },
  { key: "prs_back_share",  label: "Bck%",     group: "Pressure", fmt: "pct",            width: 56, tooltip: "% of pass/RPO with Backside Pressure",       weightBy: "passrpo_n" },
  { key: "prs_back_ot",     label: "Bck OT%",  group: "Pressure", fmt: "pct", colorDir: 1, width: 70, tooltip: "On-target% with Backside Pressure",         weightBy: "prs_back_graded_n" },
  { key: "prs_front_share", label: "Fnt%",     group: "Pressure", fmt: "pct",            width: 56, tooltip: "% of pass/RPO with Front Side Pressure",     weightBy: "passrpo_n" },
  { key: "prs_front_ot",    label: "Fnt OT%",  group: "Pressure", fmt: "pct", colorDir: 1, width: 70, tooltip: "On-target% with Front Side Pressure",       weightBy: "prs_front_graded_n" },

  // Pressure Handling — share of pressured plays + on-target% per of 3 buckets
  { key: "hdl_step_share",  label: "Step%",    group: "Handling", fmt: "pct",            width: 60, tooltip: "% of pressured plays where QB stepped up",          weightBy: "handled_n" },
  { key: "hdl_step_ot",     label: "Step OT%", group: "Handling", fmt: "pct", colorDir: 1, width: 74, tooltip: "On-target% when stepping up vs pressure",          weightBy: "hdl_step_graded_n" },
  { key: "hdl_bfs_share",   label: "BFS%",     group: "Handling", fmt: "pct",            width: 56, tooltip: "% of pressured plays where QB bailed front-side",   weightBy: "handled_n" },
  { key: "hdl_bfs_ot",      label: "BFS OT%",  group: "Handling", fmt: "pct", colorDir: 1, width: 70, tooltip: "On-target% when bailing front-side vs pressure",   weightBy: "hdl_bfs_graded_n" },
  { key: "hdl_bbs_share",   label: "BBS%",     group: "Handling", fmt: "pct",            width: 56, tooltip: "% of pressured plays where QB bailed backside",     weightBy: "handled_n" },
  { key: "hdl_bbs_ot",      label: "BBS OT%",  group: "Handling", fmt: "pct", colorDir: 1, width: 70, tooltip: "On-target% when bailing backside vs pressure",     weightBy: "hdl_bbs_graded_n" },

  // Timing — share of pass/RPO plays for each of 7 timing buckets
  { key: "t_first",    label: "1st%",  group: "Timing", fmt: "pct", colorDir: 1,  width: 54, tooltip: "% of pass/RPO thrown to first option", weightBy: "timing_n" },
  { key: "t_second",   label: "2nd+%", group: "Timing", fmt: "pct",                width: 54, weightBy: "timing_n" },
  { key: "t_check",    label: "Chk%",  group: "Timing", fmt: "pct",                width: 54, tooltip: "Checkdown rate", weightBy: "timing_n" },
  { key: "t_extended", label: "Ext%",  group: "Timing", fmt: "pct",                width: 54, tooltip: "Extended play rate", weightBy: "timing_n" },
  { key: "t_scramble", label: "Scr%",  group: "Timing", fmt: "pct",                width: 58, weightBy: "timing_n" },
  { key: "t_sack",     label: "Sack%", group: "Timing", fmt: "pct", colorDir: -1, width: 58, weightBy: "timing_n" },
  { key: "t_away",     label: "Away%", group: "Timing", fmt: "pct",                width: 58, tooltip: "Throw away rate", weightBy: "timing_n" },
];

function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return parseFloat(((n / d) * 100).toFixed(1));
}

export default function QBStatsTable({ prospects, games, qbPlays, loading, draftYearFilter, onSelectProspect }: Props) {
  const prospectMap = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const aaeMap = useMemo(() => computeQBAboveExpected(prospects, games, qbPlays), [prospects, games, qbPlays]);
  const breakdownMap = useMemo(() => computeQBAAEBreakdownMap(prospects, games, qbPlays), [prospects, games, qbPlays]);

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

    // Pull a dimension's AAE from the breakdown map. Returns null when the QB
    // is under the sample gate or the dimension itself had no comparable plays.
    const dimAAE = (pid: string, key: string): number | null => {
      const brk = breakdownMap.get(pid);
      if (!brk) return null;
      return brk.dims.find((d) => d.key === key)?.aae ?? null;
    };
    // Count of plays that contributed to that dim — used as the league-footer
    // weight so the play-weighted mean of AAE collapses to ~0 across all QBs.
    const dimN = (pid: string, key: string): number => {
      const brk = breakdownMap.get(pid);
      if (!brk) return 0;
      return brk.dims.find((d) => d.key === key)?.n ?? 0;
    };

    return prospects
      .filter((p) => p.position === "QB")
      .map((p) => {
        const pPlays = playsByProspect.get(p.id) ?? [];
        const passRpoPlays = pPlays.filter((pl) => pl.play_type !== "run");
        // Match the QB Overview panel's denominator math: thrown plays exclude
        // sack/scramble/throw-away (no graded ball), and gradedThrows further
        // exclude tipped balls (intended trajectory unknowable post-deflection).
        const thrownPlays = passRpoPlays.filter((pl) =>
          pl.timing !== "scramble" && pl.timing !== "sack" && pl.timing !== "throw_away"
        );
        const gradedThrows = thrownPlays.filter((pl) => pl.accuracy !== "tipped_ball" && pl.accuracy != null);
        const ratedN = gradedThrows.length;

        const compTracked   = thrownPlays.filter((pl) => pl.completion !== null);
        const compN         = compTracked.length;
        const caughtN       = compTracked.filter((pl) => pl.completion === "caught").length;
        const intN          = compTracked.filter((pl) => pl.completion === "interception").length;

        const touchTracked  = gradedThrows.filter((pl) => pl.touch != null);
        const touchN        = touchTracked.length;
        const touchCorrectN = touchTracked.filter((pl) => pl.touch === "correct").length;

        const timingTotal   = passRpoPlays.filter((pl) => pl.timing != null).length;
        const passRpoN      = passRpoPlays.length;

        const accCount = (a: string) => gradedThrows.filter((pl) => pl.accuracy === a).length;

        // Depth — both 3-tier and 9-cell stats use gradedThrows as the sub-pool.
        const depthOnTgt = (zones: QBDepthZone[]): { p: number | null; n: number } => {
          const sub = gradedThrows.filter((pl) => pl.depth_zone && zones.includes(pl.depth_zone));
          const ot = sub.filter((pl) => pl.accuracy === "on_target").length;
          return { p: pct(ot, sub.length), n: sub.length };
        };
        const deepStat  = depthOnTgt(["deep_left",  "deep_center",  "deep_right"]);
        const midStat   = depthOnTgt(["mid_left",   "mid_center",   "mid_right"]);
        const shortStat = depthOnTgt(["short_left", "short_center", "short_right"]);

        const zoneStat = (dz: QBDepthZone): { p: number | null; n: number } => {
          const sub = gradedThrows.filter((pl) => pl.depth_zone === dz);
          const ot = sub.filter((pl) => pl.accuracy === "on_target").length;
          return { p: pct(ot, sub.length), n: sub.length };
        };

        // Platform buckets — share of gradedThrows, OT% within bucket
        const platBucket = (filter: (pl: QBPlay) => boolean) => {
          const sub = gradedThrows.filter(filter);
          const ot = sub.filter((pl) => pl.accuracy === "on_target").length;
          return { n: sub.length, share: pct(sub.length, ratedN), ot: pct(ot, sub.length) };
        };
        const platOn   = platBucket((pl) => pl.platform === "on_platform");
        const platOff  = platBucket((pl) => pl.platform === "off_platform");
        const platRunS = platBucket((pl) => pl.platform === "on_the_run" && pl.platform_side === "strong_side");
        const platRunX = platBucket((pl) => pl.platform === "on_the_run" && pl.platform_side === "cross_body");

        // Pressure buckets — share of pass/RPO, OT% within bucket's graded throws
        const prsBucket = (k: "clean" | "mid" | "backside" | "front_side") => {
          const bucket = passRpoPlays.filter((pl) => pl.pressure === k);
          const bucketGraded = bucket.filter((pl) =>
            pl.timing !== "scramble" && pl.timing !== "sack" && pl.timing !== "throw_away" &&
            pl.accuracy !== "tipped_ball" && pl.accuracy != null
          );
          const ot = bucketGraded.filter((pl) => pl.accuracy === "on_target").length;
          return { total: bucket.length, graded: bucketGraded.length, share: pct(bucket.length, passRpoN), ot: pct(ot, bucketGraded.length) };
        };
        const prsClean = prsBucket("clean");
        const prsMid   = prsBucket("mid");
        const prsBack  = prsBucket("backside");
        const prsFront = prsBucket("front_side");

        // Pressure Handling — share of pressured plays, OT% within bucket's graded throws
        const pressuredPlays = passRpoPlays.filter((pl) => pl.pressure && pl.pressure !== "clean");
        const handledN = pressuredPlays.length;
        const hdlBucket = (k: "step_up" | "bail_front_side" | "bail_backside") => {
          const bucket = pressuredPlays.filter((pl) => pl.pressure_handling === k);
          const bucketGraded = bucket.filter((pl) =>
            pl.timing !== "scramble" && pl.timing !== "sack" && pl.timing !== "throw_away" &&
            pl.accuracy !== "tipped_ball" && pl.accuracy != null
          );
          const ot = bucketGraded.filter((pl) => pl.accuracy === "on_target").length;
          return { total: bucket.length, graded: bucketGraded.length, share: pct(bucket.length, handledN), ot: pct(ot, bucketGraded.length) };
        };
        const hdlStep = hdlBucket("step_up");
        const hdlBfs  = hdlBucket("bail_front_side");
        const hdlBbs  = hdlBucket("bail_backside");

        return {
          id: p.id,
          name: p.name,
          yr: p.draft_class_year,
          g: gamesByProspect.get(p.id) ?? 0,
          snaps: pPlays.length,

          // Weight denominators (referenced by ColDef.weightBy for the league row)
          rated_n: ratedN,
          comp_n: compN,
          touch_n: touchN,
          timing_n: timingTotal,
          passrpo_n: passRpoN,
          handled_n: handledN,

          // Overall + per-dim AAE
          aae: aaeMap.get(p.id) ?? null,
          aae_dpth: dimAAE(p.id, "depth"),
          aae_cvg:  dimAAE(p.id, "coverage"),
          aae_tmg:  dimAAE(p.id, "timing"),
          aae_prs:  dimAAE(p.id, "pressure"),
          aae_plt:  dimAAE(p.id, "platform"),
          aae_rte:  dimAAE(p.id, "route"),

          // Per-dim play counts — league-footer weights (see ColDef.weightBy).
          aae_dpth_n: dimN(p.id, "depth"),
          aae_cvg_n:  dimN(p.id, "coverage"),
          aae_tmg_n:  dimN(p.id, "timing"),
          aae_prs_n:  dimN(p.id, "pressure"),
          aae_plt_n:  dimN(p.id, "platform"),
          aae_rte_n:  dimN(p.id, "route"),

          // Accuracy
          on_tgt_pct:  pct(accCount("on_target"), ratedN),
          acc_high:    pct(accCount("high"),      ratedN),
          acc_low:     pct(accCount("low"),       ratedN),
          acc_infront: pct(accCount("in_front"),  ratedN),
          acc_behind:  pct(accCount("behind"),    ratedN),

          // Outcomes
          catch_pct: pct(caughtN, compN),
          int_pct:   pct(intN,    compN),
          touch_pct: pct(touchCorrectN, touchN),

          // Depth tier
          deep_on_tgt:  deepStat.p,  deep_n:  deepStat.n,
          mid_on_tgt:   midStat.p,   mid_n:   midStat.n,
          short_on_tgt: shortStat.p, short_n: shortStat.n,

          // Depth zones (pct + n for each of 9 cells)
          ...Object.fromEntries(
            DEPTH_ZONES.flatMap((dz) => {
              const z = zoneStat(dz);
              return [[`${dz}_pct`, z.p], [`${dz}_n`, z.n]] as [string, number | null][];
            })
          ),

          // Platform
          plat_on_share:   platOn.share,   plat_on_ot:   platOn.ot,   plat_on_n:   platOn.n,
          plat_off_share:  platOff.share,  plat_off_ot:  platOff.ot,  plat_off_n:  platOff.n,
          plat_runs_share: platRunS.share, plat_runs_ot: platRunS.ot, plat_runs_n: platRunS.n,
          plat_runx_share: platRunX.share, plat_runx_ot: platRunX.ot, plat_runx_n: platRunX.n,

          // Pressure
          prs_clean_share: prsClean.share, prs_clean_ot: prsClean.ot, prs_clean_graded_n: prsClean.graded,
          prs_mid_share:   prsMid.share,   prs_mid_ot:   prsMid.ot,   prs_mid_graded_n:   prsMid.graded,
          prs_back_share:  prsBack.share,  prs_back_ot:  prsBack.ot,  prs_back_graded_n:  prsBack.graded,
          prs_front_share: prsFront.share, prs_front_ot: prsFront.ot, prs_front_graded_n: prsFront.graded,

          // Pressure Handling
          hdl_step_share: hdlStep.share, hdl_step_ot: hdlStep.ot, hdl_step_graded_n: hdlStep.graded,
          hdl_bfs_share:  hdlBfs.share,  hdl_bfs_ot:  hdlBfs.ot,  hdl_bfs_graded_n:  hdlBfs.graded,
          hdl_bbs_share:  hdlBbs.share,  hdl_bbs_ot:  hdlBbs.ot,  hdl_bbs_graded_n:  hdlBbs.graded,

          // Timing
          t_first:    pct(passRpoPlays.filter((pl) => pl.timing === "first_option").length,  timingTotal),
          t_second:   pct(passRpoPlays.filter((pl) => pl.timing === "second_option").length, timingTotal),
          t_check:    pct(passRpoPlays.filter((pl) => pl.timing === "checkdown").length,     timingTotal),
          t_extended: pct(passRpoPlays.filter((pl) => pl.timing === "extended_play").length, timingTotal),
          t_scramble: pct(passRpoPlays.filter((pl) => pl.timing === "scramble").length,      timingTotal),
          t_sack:     pct(passRpoPlays.filter((pl) => pl.timing === "sack").length,          timingTotal),
          t_away:     pct(passRpoPlays.filter((pl) => pl.timing === "throw_away").length,    timingTotal),
        } satisfies StatRow;
      });
  }, [prospects, games, qbPlays, aaeMap, breakdownMap]);

  return (
    <StatsTableShell
      cols={COLS}
      rows={rows}
      defaultSortKey="aae"
      defaultSortDir="desc"
      loading={loading}
      draftYearFilter={draftYearFilter}
      onNameClick={onSelectProspect ? (id) => { const p = prospectMap.get(id); if (p) onSelectProspect(p); } : undefined}
    />
  );
}
