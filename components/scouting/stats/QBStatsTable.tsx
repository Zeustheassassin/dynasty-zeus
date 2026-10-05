"use client";
import { useMemo } from "react";
import StatsTableShell, { StatRow, ColDef, MinFilterDef } from "./StatsTableShell";
import { computeQBAboveExpected, computeQBThrowSliceAAE } from "../../../lib/scouting/aboveExpected";
import { computeQBRoleFits } from "../../../lib/scouting/roleFitQB";
import type { Prospect, ScoutingGame, QBPlay, QBDepthZone } from "../../../lib/types";
import { roleFitCols, roleFitRow } from "./roleFitCols";
import { pffCols, pffRow } from "./pffCols";
import { tagCols, tagRow, tagValuesFor } from "./tagCols";
import type { TagStatValue } from "../../../lib/scouting/tagStats";
import type { PffTotals } from "../../../lib/pff/totals";

interface Props {
  prospects: Prospect[];
  games: ScoutingGame[];
  qbPlays: QBPlay[];
  loading?: boolean;
  draftYearFilter?: number | null;
  onSelectProspect?: (p: Prospect) => void;
  /** PFF over each prospect's charted games (ScoutingHub). */
  pffTotals?: Map<string, PffTotals>;
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
export const QB_STAT_COLS: ColDef[] = [
  // Identity
  { key: "name",   label: "Name",  group: "Identity", fmt: "name",  sticky: true, width: 160 },
  { key: "yr",     label: "Yr",    group: "Identity", fmt: "yr",    width: 46 },
  { key: "g",      label: "G",     group: "Identity", fmt: "count", width: 40 },
  { key: "snaps",  label: "Snaps", group: "Identity", fmt: "count", width: 52 },
  { key: "throws", label: "Throws", group: "Identity", fmt: "count", width: 56, tooltip: "Balls thrown — pass/RPO snaps minus scrambles, sacks and throw-aways. Includes tipped and not-yet-graded throws; AAE uses the graded ones." },

  // Role buckets (lib/scouting/roleFitQB.ts)
  ...roleFitCols("QB"),

  // Snap mix — each outcome as a % of snaps (Snaps stays a raw count). The six
  // percentages sum to ~100% when every throw is accuracy-graded; any shortfall
  // from 100% is throws logged but not yet graded (a charting-to-do signal).
  // League footer shows each as a true play-weighted rate (weightBy snaps).
  { key: "graded_pct",    label: "Grd%",  group: "Snap Mix", fmt: "pct", width: 54, weightBy: "snaps", tooltip: "Graded throws as % of snaps — accuracy charted, tipped excluded (the AAE sample)." },
  { key: "run_pct",       label: "Run%",  group: "Snap Mix", fmt: "pct", width: 54, weightBy: "snaps", tooltip: "Designed QB runs as % of snaps." },
  { key: "scramble_pct",  label: "Scrm%", group: "Snap Mix", fmt: "pct", width: 58, weightBy: "snaps", tooltip: "Scrambles as % of snaps." },
  { key: "sack_pct",      label: "Sack%", group: "Snap Mix", fmt: "pct", width: 58, weightBy: "snaps", tooltip: "Sacks as % of snaps." },
  { key: "throwaway_pct", label: "TA%",   group: "Snap Mix", fmt: "pct", width: 54, weightBy: "snaps", tooltip: "Throw-aways as % of snaps." },
  { key: "tipped_pct",    label: "Tip%",  group: "Snap Mix", fmt: "pct", width: 54, weightBy: "snaps", tooltip: "Tipped balls as % of snaps — deflected throws, excluded from accuracy grading." },

  // Overall AAE — play-weighted league mean ≈ 0 by construction. The footer is a
  // sanity check: if it drifts noticeably from 0, there are plays in the baseline
  // pool (e.g., other-year QBs) that aren't represented in the visible rows.
  { key: "aae", label: "AAE", group: "AAE", fmt: "plusMinus", colorDir: 1, width: 62,
    tooltip: "Accuracy Above Expected — overall. Each throw is judged against throws like it (all situation tags stacked). Min 25 graded passes. Older seasons count a little less.",
    weightBy: "rated_n" },

  // AAE by throw location: the same AAE over one slice of his throws (see
  // computeQBThrowSliceAAE). Each weights the league row by the QB's throws in
  // that slice, so the footer lands near 0.
  { key: "aae_out",   label: "Outside",      group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 70, tooltip: "AAE on outside throws (left or right third of the field), each judged against throws like it. Min. 10 such throws.", weightBy: "aae_out_n" },
  { key: "aae_in",    label: "Inside",       group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 66, tooltip: "AAE on inside throws (middle third of the field), each judged against throws like it. Min. 10 such throws.",          weightBy: "aae_in_n" },
  { key: "aae_deep",  label: "Deep",         group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 62, tooltip: "AAE on deep throws (20+ yds), each judged against throws like it. Min. 10 such throws.",                           weightBy: "aae_deep_n" },
  { key: "aae_mid",   label: "Intermediate", group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 92, tooltip: "AAE on intermediate throws (10–20 yds), each judged against throws like it. Min. 10 such throws.",                 weightBy: "aae_mid_n" },
  { key: "aae_short", label: "Short",        group: "AAE Breakdown", fmt: "plusMinus", colorDir: 1, width: 62, tooltip: "AAE on short throws (under 10 yds), each judged against throws like it. Min. 10 such throws.",                     weightBy: "aae_short_n" },

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
  // PFF over the charted games
  // The tag-only stats (tagged plays only)
  ...tagCols("QB"),
  ...pffCols("QB"),
];

function pct(n: number, d: number): number | null {
  if (d === 0) return null;
  return parseFloat(((n / d) * 100).toFixed(1));
}

// Extracted so the Phase I player-comparison tool can compute the same rows
// for any two QB prospects without duplicating this logic.
export function buildQBStatRows(prospects: Prospect[], games: ScoutingGame[], qbPlays: QBPlay[], pff?: Map<string, PffTotals>, tags?: Map<string, Record<string, TagStatValue>>): StatRow[] {
    const aaeMap = computeQBAboveExpected(prospects, games, qbPlays);
    const sliceMap = computeQBThrowSliceAAE(prospects, games, qbPlays);
    const roleFits = computeQBRoleFits(prospects, games, qbPlays, pff);
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

        // Snap-mix counts (rendered as % of snaps below): graded + run + scramble
        // + sack + throwaway + tipped sum to snaps when every throw is graded.
        const snapsN     = pPlays.length;
        const runN       = pPlays.filter((pl) => pl.play_type === "run").length;
        const scrambleN  = passRpoPlays.filter((pl) => pl.timing === "scramble").length;
        const sackN      = passRpoPlays.filter((pl) => pl.timing === "sack").length;
        const throwAwayN = passRpoPlays.filter((pl) => pl.timing === "throw_away").length;
        const tippedN    = thrownPlays.filter((pl) => pl.accuracy === "tipped_ball").length;

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

        const slices = sliceMap.get(p.id);

        return {
          id: p.id,
          name: p.name,
          yr: p.draft_class_year,
          g: gamesByProspect.get(p.id) ?? 0,
          snaps: pPlays.length,
          throws: thrownPlays.length,
          ...roleFitRow("QB", roleFits.get(p.id)),

          // Snap mix as % of snaps (sum to ~100% when every throw is graded)
          graded_pct:    pct(ratedN,     snapsN),
          run_pct:       pct(runN,       snapsN),
          scramble_pct:  pct(scrambleN,  snapsN),
          sack_pct:      pct(sackN,      snapsN),
          throwaway_pct: pct(throwAwayN, snapsN),
          tipped_pct:    pct(tippedN,    snapsN),

          // Weight denominators (referenced by ColDef.weightBy for the league row)
          rated_n: ratedN,
          comp_n: compN,
          touch_n: touchN,
          timing_n: timingTotal,
          passrpo_n: passRpoN,
          handled_n: handledN,

          // Overall AAE + AAE by throw location, with each slice's throw count
          // as its league-footer weight (see ColDef.weightBy).
          aae: aaeMap.get(p.id) ?? null,
          aae_out:   slices?.outside.ae ?? null,      aae_out_n:   slices?.outside.n ?? 0,
          aae_in:    slices?.inside.ae ?? null,       aae_in_n:    slices?.inside.n ?? 0,
          aae_deep:  slices?.deep.ae ?? null,         aae_deep_n:  slices?.deep.n ?? 0,
          aae_mid:   slices?.intermediate.ae ?? null, aae_mid_n:   slices?.intermediate.n ?? 0,
          aae_short: slices?.short.ae ?? null,        aae_short_n: slices?.short.n ?? 0,

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
          ...tagRow("QB", tags?.get(p.id)),
          ...pffRow(pff?.get(p.id)),
        } satisfies StatRow;
      });
}

// "Min …" boxes beside the search bar — hide prospects below a sample size.
const QB_MIN_FILTERS: MinFilterDef[] = [{ key: "throws", label: "Throws" }];

export default function QBStatsTable({ prospects, games, qbPlays, loading, draftYearFilter, onSelectProspect, pffTotals }: Props) {
  const prospectMap = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const tags = useMemo(() => tagValuesFor({ games, qbPlays }), [games, qbPlays]);
  const rows = useMemo(() => buildQBStatRows(prospects, games, qbPlays, pffTotals, tags), [prospects, games, qbPlays, pffTotals, tags]);

  return (
    <StatsTableShell
      cols={QB_STAT_COLS}
      rows={rows}
      minFilters={QB_MIN_FILTERS}
      defaultSortKey="aae"
      defaultSortDir="desc"
      loading={loading}
      draftYearFilter={draftYearFilter}
      onNameClick={onSelectProspect ? (id) => { const p = prospectMap.get(id); if (p) onSelectProspect(p); } : undefined}
    />
  );
}
