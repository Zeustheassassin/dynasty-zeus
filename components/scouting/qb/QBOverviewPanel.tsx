"use client";
import { useMemo } from "react";
import type {
  QBPlay,
  QBSnapPosition,
  QBPlayType,
  QBTiming,
  QBAccuracy,
  QBIntType,
  QBDepthZone,
  RouteType,
} from "../../../lib/types";
import { ROUTE_TYPES } from "../shared/chartingConstants";
import { pct, fmtPct } from "../shared/chartingTypes";
import { computeQBAAEBreakdown } from "../../../lib/scouting/aboveExpected";
import PlayerNotesList from "../PlayerNotesList";
import {
  SNAP_POSITIONS,
  PLAY_TYPES,
  TIMINGS,
  ACCURACIES,
  PLATFORM_BREAKDOWN,
  PRESSURES,
  PRESSURE_HANDLINGS,
  DEPTH_ROWS,
  onTargetColor,
  type PlatformBreakdownKey,
} from "./qbConstants";

interface Props {
  plays: QBPlay[];
  leaguePlays: QBPlay[];
  gamesCount: number;
  loading?: boolean;
}

export default function QBOverviewPanel({ plays, leaguePlays, gamesCount, loading }: Props) {
  const aaeBreakdown = useMemo(
    () => computeQBAAEBreakdown(plays, leaguePlays),
    [plays, leaguePlays],
  );

  const stats = useMemo(() => {
    const totalPlays    = plays.length;
    const runPlays      = plays.filter((p) => p.play_type === "run");
    const passRpoPlays  = plays.filter((p) => p.play_type !== "run");
    const thrownPlays   = passRpoPlays.filter((p) => p.timing !== "scramble" && p.timing !== "sack" && p.timing !== "throw_away");
    const gradedThrows  = thrownPlays.filter((p) => p.accuracy !== "tipped_ball");
    const scramblePlays = passRpoPlays.filter((p) => p.timing === "scramble");

    const snapCounts = (["shotgun", "pistol", "under_center"] as QBSnapPosition[]).reduce((acc, s) => {
      acc[s] = plays.filter((p) => p.snap_position === s).length;
      return acc;
    }, {} as Record<QBSnapPosition, number>);

    const typeCounts = (["run", "rpo", "pass"] as QBPlayType[]).reduce((acc, t) => {
      acc[t] = plays.filter((p) => p.play_type === t).length;
      return acc;
    }, {} as Record<QBPlayType, number>);

    const timingCounts = (["first_option", "second_option", "checkdown", "extended_play", "scramble", "sack", "throw_away"] as QBTiming[]).reduce((acc, t) => {
      acc[t] = passRpoPlays.filter((p) => p.timing === t).length;
      return acc;
    }, {} as Record<QBTiming, number>);

    const accCounts = (["on_target", "high", "low", "in_front", "behind", "tipped_ball"] as QBAccuracy[]).reduce((acc, a) => {
      acc[a] = thrownPlays.filter((p) => p.accuracy === a).length;
      return acc;
    }, {} as Record<QBAccuracy, number>);
    const onTargetPct = pct(accCounts.on_target, gradedThrows.length);
    const compTracked   = thrownPlays.filter((p) => p.completion !== null).length;
    const caughtPlays   = thrownPlays.filter((p) => p.completion === "caught").length;
    const incompletePlays = thrownPlays.filter((p) => p.completion === "incomplete").length;
    const intPlays      = thrownPlays.filter((p) => p.completion === "interception").length;
    const catchPct      = pct(caughtPlays, compTracked);
    const intPct        = pct(intPlays, compTracked);
    const intTypeCounts: Record<QBIntType, number> = {
      bad_throw: thrownPlays.filter((p) => p.int_type === "bad_throw").length,
      bad_decision: thrownPlays.filter((p) => p.int_type === "bad_decision").length,
      fifty_fifty: thrownPlays.filter((p) => p.int_type === "fifty_fifty").length,
      tipped: thrownPlays.filter((p) => p.int_type === "tipped").length,
    };

    const touchTracked = gradedThrows.filter((p) => p.touch != null);
    const touchCorrect = touchTracked.filter((p) => p.touch === "correct").length;
    const touchPct = pct(touchCorrect, touchTracked.length);

    type DepthTier = "short" | "mid" | "deep";
    const tierOf = (z: QBDepthZone | null | undefined): DepthTier | null =>
      !z ? null : z.startsWith("short_") ? "short" : z.startsWith("mid_") ? "mid" : "deep";
    type ScoringAccuracy = Exclude<QBAccuracy, "tipped_ball">;
    const SCORING_ACCURACIES: ScoringAccuracy[] = ["on_target", "high", "low", "in_front", "behind"];
    const accByDepth = SCORING_ACCURACIES.reduce((acc, a) => {
      acc[a] = { short: 0, mid: 0, deep: 0 };
      return acc;
    }, {} as Record<ScoringAccuracy, Record<DepthTier, number>>);
    const depthTierTotals: Record<DepthTier, number> = { short: 0, mid: 0, deep: 0 };
    for (const pl of gradedThrows) {
      if (!pl.accuracy || pl.accuracy === "tipped_ball") continue;
      const tier = tierOf(pl.depth_zone);
      if (!tier) continue;
      accByDepth[pl.accuracy][tier]++;
      depthTierTotals[tier]++;
    }

    type ZoneStat = { count: number; onTarget: number; onTargetPct: number | null };
    const zoneStat = (key: QBDepthZone): ZoneStat => {
      const zp = gradedThrows.filter((p) => p.depth_zone === key);
      const ot = zp.filter((p) => p.accuracy === "on_target").length;
      return { count: zp.length, onTarget: ot, onTargetPct: pct(ot, zp.length) };
    };
    const zoneStats = (["deep_left","deep_center","deep_right","mid_left","mid_center","mid_right","short_left","short_center","short_right"] as QBDepthZone[])
      .reduce((acc, k) => { acc[k] = zoneStat(k); return acc; }, {} as Record<QBDepthZone, ZoneStat>);

    type RouteStat = { total: number; onTarget: number; man: number; manOT: number; zone: number; zoneOT: number };
    const routeStats: Partial<Record<RouteType, RouteStat>> = {};
    for (const rt of ROUTE_TYPES) {
      const rp = gradedThrows.filter((p) => p.route_type === rt);
      if (rp.length === 0) continue;
      const manP  = rp.filter((p) => p.coverage === "man");
      const zoneP = rp.filter((p) => p.coverage === "zone");
      routeStats[rt] = {
        total: rp.length,
        onTarget: rp.filter((p) => p.accuracy === "on_target").length,
        man: manP.length,
        manOT: manP.filter((p) => p.accuracy === "on_target").length,
        zone: zoneP.length,
        zoneOT: zoneP.filter((p) => p.accuracy === "on_target").length,
      };
    }

    const manP  = gradedThrows.filter((p) => p.coverage === "man");
    const zoneP = gradedThrows.filter((p) => p.coverage === "zone");
    const cvgStats = {
      man:  { count: manP.length,  onTarget: manP.filter((p) => p.accuracy === "on_target").length },
      zone: { count: zoneP.length, onTarget: zoneP.filter((p) => p.accuracy === "on_target").length },
    };

    const platformBreakdown = PLATFORM_BREAKDOWN.reduce((acc, { key }) => {
      acc[key] = { n: 0, ot: 0 };
      return acc;
    }, {} as Record<PlatformBreakdownKey, { n: number; ot: number }>);
    for (const pl of gradedThrows) {
      let k: PlatformBreakdownKey | null = null;
      if (pl.platform === "on_platform")  k = "on_platform";
      else if (pl.platform === "off_platform") k = "off_platform";
      else if (pl.platform === "on_the_run") {
        if (pl.platform_side === "strong_side") k = "on_the_run_strong_side";
        else if (pl.platform_side === "cross_body")  k = "on_the_run_cross_body";
      }
      if (!k) continue;
      platformBreakdown[k].n++;
      if (pl.accuracy === "on_target") platformBreakdown[k].ot++;
    }
    const platformCharted = PLATFORM_BREAKDOWN.reduce((s, { key }) => s + platformBreakdown[key].n, 0);
    const platformMissing = gradedThrows.length - platformCharted;

    const PRESSURE_KEYS = ["clean", "mid", "backside", "front_side"] as const;
    type PressureKey = (typeof PRESSURE_KEYS)[number];
    const pressureBreakdown = PRESSURE_KEYS.reduce((acc, k) => {
      acc[k] = { total: 0, sacks: 0, throwAways: 0, scrambles: 0, gradedThrows: 0, onTarget: 0 };
      return acc;
    }, {} as Record<PressureKey, { total: number; sacks: number; throwAways: number; scrambles: number; gradedThrows: number; onTarget: number }>);
    for (const pl of passRpoPlays) {
      if (!pl.pressure) continue;
      const b = pressureBreakdown[pl.pressure];
      b.total++;
      if (pl.timing === "sack") b.sacks++;
      else if (pl.timing === "throw_away") b.throwAways++;
      else if (pl.timing === "scramble") b.scrambles++;
      else if (pl.accuracy != null && pl.accuracy !== "tipped_ball") {
        b.gradedThrows++;
        if (pl.accuracy === "on_target") b.onTarget++;
      }
    }
    const pressureCharted = PRESSURE_KEYS.reduce((s, k) => s + pressureBreakdown[k].total, 0);
    const pressureMissing = passRpoPlays.length - pressureCharted;

    const HANDLING_KEYS = ["step_up", "bail_front_side", "bail_backside"] as const;
    type HandlingKey = (typeof HANDLING_KEYS)[number];
    const handlingBreakdown = HANDLING_KEYS.reduce((acc, k) => {
      acc[k] = { total: 0, gradedThrows: 0, onTarget: 0 };
      return acc;
    }, {} as Record<HandlingKey, { total: number; gradedThrows: number; onTarget: number }>);
    const pressuredPlays = passRpoPlays.filter((p) => p.pressure && p.pressure !== "clean");
    for (const pl of pressuredPlays) {
      if (!pl.pressure_handling) continue;
      const b = handlingBreakdown[pl.pressure_handling];
      b.total++;
      if (pl.timing !== "sack" && pl.timing !== "scramble" && pl.timing !== "throw_away" && pl.accuracy != null && pl.accuracy !== "tipped_ball") {
        b.gradedThrows++;
        if (pl.accuracy === "on_target") b.onTarget++;
      }
    }
    const handlingCharted = HANDLING_KEYS.reduce((s, k) => s + handlingBreakdown[k].total, 0);
    const handlingMissing = pressuredPlays.length - handlingCharted;

    return {
      totalPlays, runPlays: runPlays.length, passRpo: passRpoPlays.length,
      thrown: thrownPlays.length, graded: gradedThrows.length, scrambles: scramblePlays.length,
      snapCounts, typeCounts, timingCounts, accCounts, onTargetPct,
      compTracked, caughtPlays, incompletePlays, intPlays, catchPct, intPct, intTypeCounts,
      touchTracked: touchTracked.length, touchCorrect, touchPct,
      accByDepth, depthTierTotals,
      zoneStats, routeStats, cvgStats,
      platformBreakdown, platformCharted, platformMissing,
      pressureBreakdown, pressureCharted, pressureMissing,
      handlingBreakdown, handlingCharted, handlingMissing, pressuredPlaysCount: pressuredPlays.length,
    };
  }, [plays]);

  if (loading) {
    return <div className="text-slate-500 text-sm text-center py-8">Loading…</div>;
  }
  if (stats.totalPlays === 0) {
    return (
      <div className="text-slate-500 text-sm text-center py-8">
        No plays charted yet. Go to &quot;Chart Game&quot; to start logging.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: "Total Plays",  value: stats.totalPlays,  color: "text-blue-400" },
          { label: "Runs",         value: stats.runPlays,    color: "text-emerald-400" },
          { label: "Pass/RPO",     value: stats.passRpo,     color: "text-amber-400" },
          { label: "Throws",       value: stats.thrown,      color: "text-blue-300" },
          { label: "Scrambles",    value: stats.scrambles,   color: "text-orange-400" },
          { label: "Games",        value: gamesCount,        color: "text-slate-300" },
        ].map((s) => (
          <div key={s.label} className="p-3 bg-slate-900 rounded-lg border border-slate-800">
            <div className="text-xs text-slate-500 mb-1">{s.label}</div>
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Snap Position + Play Type side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3">Snap Position</div>
          <div className="space-y-2">
            {SNAP_POSITIONS.map(({ key, label }) => {
              const n = stats.snapCounts[key];
              const p2 = pct(n, stats.totalPlays);
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-24 flex-shrink-0">{label}</span>
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full" style={{ width: `${p2 ?? 0}%` }} />
                  </div>
                  <span className="text-xs text-slate-300 w-16 text-right flex-shrink-0">
                    {n} <span className="text-slate-600">({fmtPct(p2)})</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3">Play Type</div>
          <div className="space-y-2">
            {PLAY_TYPES.map(({ key, label }) => {
              const n = stats.typeCounts[key];
              const p2 = pct(n, stats.totalPlays);
              const barColor = key === "run" ? "bg-emerald-600" : key === "rpo" ? "bg-amber-600" : "bg-blue-600";
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-10 flex-shrink-0">{label}</span>
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full`} style={{ width: `${p2 ?? 0}%` }} />
                  </div>
                  <span className="text-xs text-slate-300 w-16 text-right flex-shrink-0">
                    {n} <span className="text-slate-600">({fmtPct(p2)})</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Timing */}
      {stats.passRpo > 0 && (
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3">Timing <span className="text-slate-700">({stats.passRpo} pass/RPO plays)</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TIMINGS.map(({ key, label }) => {
              const n = stats.timingCounts[key];
              const p2 = pct(n, stats.passRpo);
              const color = key === "sack" ? "text-red-400" : key === "throw_away" ? "text-amber-400" : key === "scramble" ? "text-orange-400" : "text-blue-300";
              return (
                <div key={key} className="p-3 bg-slate-800/50 rounded-lg text-center">
                  <div className="text-xs text-slate-500 mb-1">{label}</div>
                  <div className={`text-xl font-bold ${color}`}>{n}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{fmtPct(p2)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Accuracy + Catch% */}
      {stats.thrown > 0 && (
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3 flex flex-wrap items-center gap-3">
            <span>
              Accuracy <span className="text-slate-700">({stats.graded} graded throws)</span>
              {stats.accCounts.tipped_ball > 0 && (
                <span className="text-amber-500/80 ml-2">+ {stats.accCounts.tipped_ball} tipped</span>
              )}
            </span>
            {stats.onTargetPct !== null && (
              <span className={`font-semibold ${onTargetColor(stats.onTargetPct)}`}>
                {stats.onTargetPct}% on target
              </span>
            )}
            {stats.compTracked > 0 && (
              <span className={`font-semibold ${stats.catchPct !== null && stats.catchPct >= 60 ? "text-emerald-400" : stats.catchPct !== null && stats.catchPct >= 50 ? "text-amber-400" : "text-red-400"}`}>
                {fmtPct(stats.catchPct)} catch rate
                <span className="text-slate-600 font-normal ml-1">({stats.compTracked} tracked)</span>
              </span>
            )}
            {stats.touchTracked > 0 && (
              <span className={`font-semibold ${stats.touchPct !== null && stats.touchPct >= 80 ? "text-emerald-400" : stats.touchPct !== null && stats.touchPct >= 65 ? "text-amber-400" : "text-red-400"}`}>
                {fmtPct(stats.touchPct)} touch
                <span className="text-slate-600 font-normal ml-1">({stats.touchCorrect}/{stats.touchTracked} correct)</span>
              </span>
            )}
            {stats.intPlays > 0 && (
              <span className="font-semibold text-red-400">
                {stats.intPlays} INT{stats.intPlays !== 1 ? "s" : ""}
                {stats.intPct !== null && <span className="text-red-400/70 font-normal ml-1">({stats.intPct}%)</span>}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {ACCURACIES.filter(({ key }) => key !== "tipped_ball").map(({ key, label }) => {
              const n = stats.accCounts[key];
              const p2 = pct(n, stats.graded);
              const color = key === "on_target" ? "text-emerald-400" : "text-red-400";
              return (
                <div key={key} className="p-3 bg-slate-800/50 rounded-lg text-center">
                  <div className="text-xs text-slate-500 mb-1">{label}</div>
                  <div className={`text-xl font-bold ${color}`}>{n}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{fmtPct(p2)}</div>
                </div>
              );
            })}
          </div>

          {(stats.depthTierTotals.short + stats.depthTierTotals.mid + stats.depthTierTotals.deep) > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left font-medium pb-1.5 pr-3">By Depth</th>
                    {(["short", "mid", "deep"] as const).map((tier) => (
                      <th key={tier} className="text-right font-medium pb-1.5 pl-3">
                        <span className="capitalize">{tier === "short" ? "Short (U10)" : tier === "mid" ? "Mid (10–20)" : "Deep (20+)"}</span>
                        <span className="ml-1.5 text-slate-700 font-normal">{stats.depthTierTotals[tier]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {ACCURACIES.filter(({ key }) => key !== "tipped_ball").map(({ key, label }) => {
                    const row = stats.accByDepth[key as Exclude<QBAccuracy, "tipped_ball">];
                    const isOnTarget = key === "on_target";
                    return (
                      <tr key={key}>
                        <td className={`py-1.5 pr-3 ${isOnTarget ? "text-emerald-400" : "text-slate-400"}`}>{label}</td>
                        {(["short", "mid", "deep"] as const).map((tier) => {
                          const n = row[tier];
                          const denom = stats.depthTierTotals[tier];
                          const p2 = pct(n, denom);
                          const cellColor =
                            n === 0 ? "text-slate-700" :
                            isOnTarget ? "text-emerald-400" :
                            "text-red-400";
                          return (
                            <td key={tier} className={`py-1.5 pl-3 text-right font-mono ${cellColor}`}>
                              {n}
                              {n > 0 && (
                                <span className="text-slate-600 font-normal ml-1">({fmtPct(p2)})</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-600 mt-1.5">Percentages are within each depth tier — e.g., 30% high in &quot;Mid&quot; means 30% of mid-depth throws were high.</p>
            </div>
          )}

          {stats.compTracked > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-3">
                <div className="flex-1 p-2.5 bg-emerald-900/20 border border-emerald-800/40 rounded-lg flex items-center justify-between">
                  <span className="text-xs text-slate-400">Caught</span>
                  <span className="text-sm font-bold text-emerald-400">{stats.caughtPlays} <span className="text-xs font-normal text-slate-500">/ {stats.compTracked}</span></span>
                </div>
                <div className="flex-1 p-2.5 bg-slate-800/50 rounded-lg flex items-center justify-between">
                  <span className="text-xs text-slate-400">Incomplete</span>
                  <span className="text-sm font-bold text-slate-300">{stats.incompletePlays}</span>
                </div>
                <div className="flex-1 p-2.5 bg-red-900/20 border border-red-800/40 rounded-lg flex items-center justify-between">
                  <span className="text-xs text-slate-400">INT</span>
                  <span className="text-sm font-bold text-red-400">{stats.intPlays}</span>
                </div>
                <div className="flex-1 p-2.5 bg-slate-800/50 rounded-lg flex items-center justify-between">
                  <span className="text-xs text-slate-400">Catch%</span>
                  <span className={`text-sm font-bold ${onTargetColor(stats.catchPct)}`}>{fmtPct(stats.catchPct)}</span>
                </div>
              </div>
              {stats.intPlays > 0 && (
                <div className="flex gap-2">
                  {([
                    { key: "bad_throw",    label: "Bad Throw" },
                    { key: "bad_decision", label: "Bad Decision" },
                    { key: "fifty_fifty",  label: "50/50 Ball" },
                    { key: "tipped",       label: "Tipped Ball" },
                  ] as { key: QBIntType; label: string }[]).map(({ key, label }) => {
                    const n = stats.intTypeCounts[key];
                    return (
                      <div key={key} className="flex-1 p-2 bg-orange-900/20 border border-orange-800/30 rounded text-center">
                        <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                        <div className="text-sm font-bold text-orange-300">{n || "—"}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Platform breakdown */}
      {stats.platformCharted > 0 && (
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3 flex flex-wrap items-baseline gap-3">
            <span>
              Platform <span className="text-slate-700">({stats.platformCharted} of {stats.graded} graded throws charted)</span>
            </span>
            {stats.platformMissing > 0 && (
              <span className="text-amber-500/70 text-[10px]">{stats.platformMissing} missing platform data</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PLATFORM_BREAKDOWN.map(({ key, label }) => {
              const b = stats.platformBreakdown[key];
              const sharePct = pct(b.n, stats.graded);
              const otPct = pct(b.ot, b.n);
              return (
                <div key={key} className="p-3 bg-slate-800/50 rounded-lg text-center">
                  <div className="text-xs text-slate-500 mb-1">{label}</div>
                  <div className="text-xl font-bold text-blue-300">{b.n}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{fmtPct(sharePct)} of throws</div>
                  <div className={`text-xs font-semibold mt-1 ${onTargetColor(otPct)}`}>{fmtPct(otPct)} on target</div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-600 mt-3">
            Share % uses all {stats.graded} graded throws as the denominator, so the four buckets may sum to less than 100% when older plays lack platform data. On-target % is within each bucket.
          </p>
        </div>
      )}

      {/* Pressure breakdown */}
      {stats.pressureCharted > 0 && (
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3 flex flex-wrap items-baseline gap-3">
            <span>
              Pressure <span className="text-slate-700">({stats.pressureCharted} of {stats.passRpo} pass/RPO plays charted)</span>
            </span>
            {stats.pressureMissing > 0 && (
              <span className="text-amber-500/70 text-[10px]">{stats.pressureMissing} missing pressure data</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PRESSURES.map(({ key, label }) => {
              const b = stats.pressureBreakdown[key];
              const sharePct = pct(b.total, stats.passRpo);
              const otPct = pct(b.onTarget, b.gradedThrows);
              const titleColor = key === "clean" ? "text-emerald-300" : "text-amber-300";
              return (
                <div key={key} className="p-3 bg-slate-800/50 rounded-lg">
                  <div className="text-xs text-slate-500 mb-1 text-center">{label}</div>
                  <div className={`text-xl font-bold text-center ${titleColor}`}>{b.total}</div>
                  <div className="text-xs text-slate-600 mt-0.5 text-center">{fmtPct(sharePct)} of pass/RPO</div>
                  <div className={`text-xs font-semibold mt-2 text-center ${onTargetColor(otPct)}`}>
                    {fmtPct(otPct)} on target
                    <span className="block text-slate-600 font-normal text-[10px]">({b.gradedThrows} graded)</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-700/40 grid grid-cols-3 gap-1 text-[10px] text-center">
                    <div>
                      <div className="text-slate-500">Sacks</div>
                      <div className="text-red-400 font-semibold">{b.sacks}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">T.A.</div>
                      <div className="text-amber-400 font-semibold">{b.throwAways}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Scr.</div>
                      <div className="text-orange-400 font-semibold">{b.scrambles}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-600 mt-3">
            Share % uses all {stats.passRpo} pass/RPO plays as the denominator. On-target % is within each pressure bucket, computed from graded throws only (sacks, throw-aways, scrambles, and tipped balls excluded).
          </p>
        </div>
      )}

      {/* Pressure Handling breakdown */}
      {stats.handlingCharted > 0 && (
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3 flex flex-wrap items-baseline gap-3">
            <span>
              Pressure Handling <span className="text-slate-700">({stats.handlingCharted} of {stats.pressuredPlaysCount} pressured plays charted)</span>
            </span>
            {stats.handlingMissing > 0 && (
              <span className="text-amber-500/70 text-[10px]">{stats.handlingMissing} missing handling data</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PRESSURE_HANDLINGS.map(({ key, label }) => {
              const b = stats.handlingBreakdown[key];
              const sharePct = pct(b.total, stats.handlingCharted);
              const otPct = pct(b.onTarget, b.gradedThrows);
              return (
                <div key={key} className="p-3 bg-slate-800/50 rounded-lg text-center">
                  <div className="text-xs text-slate-500 mb-1">{label}</div>
                  <div className="text-xl font-bold text-amber-300">{b.total}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{fmtPct(sharePct)} of handled</div>
                  <div className={`text-xs font-semibold mt-1 ${onTargetColor(otPct)}`}>
                    {fmtPct(otPct)} on target
                    <span className="block text-slate-600 font-normal text-[10px]">({b.gradedThrows} graded)</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-600 mt-3">
            Only pressured plays are included (Clean Pocket excluded). Share % is within charted-handling plays so the three buckets sum to 100%. On-target % is within each bucket, graded throws only.
          </p>
        </div>
      )}

      {/* Per-Dimension AAE Breakdown */}
      {stats.graded > 0 && (
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3 flex flex-wrap items-baseline gap-3">
            <span>AAE Breakdown <span className="text-slate-700">— vs league baseline, by dimension</span></span>
            {aaeBreakdown.total !== null ? (
              <span className={`text-sm font-bold ${aaeBreakdown.total > 0 ? "text-emerald-400" : aaeBreakdown.total < 0 ? "text-red-400" : "text-slate-400"}`}>
                {aaeBreakdown.total > 0 ? "+" : ""}{aaeBreakdown.total.toFixed(2)} pp
              </span>
            ) : (
              <span className="text-xs text-slate-600">no comparable league data yet</span>
            )}
            <span className="text-xs text-slate-600 ml-auto">{aaeBreakdown.ratedPasses} graded throws</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {aaeBreakdown.dims.map(({ key, label, aae, n }) => {
              const isLowN = n > 0 && n < 5;
              const color =
                aae === null ? "text-slate-600" :
                aae > 0 ? "text-emerald-400" :
                aae < 0 ? "text-red-400" :
                "text-slate-400";
              return (
                <div key={key} className="p-3 bg-slate-800/50 rounded-lg flex items-baseline justify-between gap-2">
                  <span className="text-xs text-slate-400">{label}</span>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-sm font-bold ${color}`}>
                      {aae === null ? "—" : `${aae > 0 ? "+" : ""}${aae.toFixed(1)} pp`}
                    </span>
                    <span className={`text-[10px] ${isLowN ? "text-amber-500/70" : "text-slate-600"}`} title={isLowN ? "Low sample — interpret cautiously" : undefined}>
                      {n}p
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-600 mt-3">
            Each dimension compares this QB&apos;s on-target% to the league baseline weighted by his mix in that dimension. Null (&quot;—&quot;) means no plays had that dimension filled, or no league plays exist yet for those buckets. The overall AAE up top is computed per play across all filled dimensions (including Pressure Handling, which is folded into the Pressure cluster rather than shown as its own row), so it isn&apos;t simply the mean of these rows.
          </p>
        </div>
      )}

      {/* Depth Zone Grid */}
      {stats.thrown > 0 && (
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3">Accuracy by Depth &amp; Location <span className="text-slate-700">— Att · On-Target%</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[320px]">
              <thead>
                <tr className="text-slate-600">
                  <th className="text-left pb-2 pr-2 font-medium">Depth</th>
                  {["Left", "Center", "Right"].map((l) => (
                    <th key={l} className="text-center pb-2 px-2 font-medium">{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DEPTH_ROWS.map(({ label, depths }) => (
                  <tr key={label} className="border-t border-slate-800">
                    <td className="py-2 pr-2 text-slate-500 whitespace-nowrap">{label}</td>
                    {depths.map(({ key }) => {
                      const z = stats.zoneStats[key];
                      return (
                        <td key={key} className="py-2 px-2 text-center">
                          {z.count > 0 ? (
                            <div>
                              <div className="text-slate-400">{z.count} att</div>
                              <div className={`font-semibold ${onTargetColor(z.onTargetPct)}`}>
                                {fmtPct(z.onTargetPct)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-700">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Route Type × Coverage accuracy */}
      {Object.keys(stats.routeStats).length > 0 && (
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3">Accuracy by Route Type &amp; Coverage <span className="text-slate-700">— Att · On-Target%</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[500px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-600">
                  <th className="text-left pb-1.5 pr-3 font-medium">Route</th>
                  <th className="text-right pb-1.5 px-2">Total</th>
                  <th className="text-right pb-1.5 px-2">OT%</th>
                  <th className="text-right pb-1.5 px-2 text-purple-500">Man</th>
                  <th className="text-right pb-1.5 px-2 text-purple-500">M OT%</th>
                  <th className="text-right pb-1.5 px-2 text-teal-500">Zone</th>
                  <th className="text-right pb-1.5 pl-2 text-teal-500">Z OT%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {ROUTE_TYPES
                  .filter((rt) => stats.routeStats[rt])
                  .sort((a, b) => (stats.routeStats[b]?.total ?? 0) - (stats.routeStats[a]?.total ?? 0))
                  .map((rt) => {
                    const rs = stats.routeStats[rt]!;
                    const otPct   = pct(rs.onTarget, rs.total);
                    const manOTPct  = pct(rs.manOT,  rs.man);
                    const zoneOTPct = pct(rs.zoneOT, rs.zone);
                    return (
                      <tr key={rt} className="hover:bg-slate-800/40">
                        <td className="py-1.5 pr-3 text-white font-medium capitalize">{rt}</td>
                        <td className="py-1.5 px-2 text-right text-blue-400">{rs.total}</td>
                        <td className={`py-1.5 px-2 text-right font-semibold ${onTargetColor(otPct)}`}>
                          {fmtPct(otPct)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-400">{rs.man || "—"}</td>
                        <td className={`py-1.5 px-2 text-right ${onTargetColor(manOTPct)}`}>
                          {rs.man > 0 ? fmtPct(manOTPct) : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-400">{rs.zone || "—"}</td>
                        <td className={`py-1.5 pl-2 text-right ${onTargetColor(zoneOTPct)}`}>
                          {rs.zone > 0 ? fmtPct(zoneOTPct) : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div className="mt-2 flex gap-4 text-[10px] text-slate-600">
              <span><span className="text-purple-500">M</span> = Man coverage</span>
              <span><span className="text-teal-500">Z</span> = Zone coverage</span>
              <span>OT% = on-target percentage</span>
            </div>
          </div>
        </div>
      )}

      {/* Coverage summary */}
      {stats.thrown > 0 && (stats.cvgStats.man.count > 0 || stats.cvgStats.zone.count > 0) && (
        <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
          <div className="text-xs text-slate-500 mb-3">Accuracy by Coverage</div>
          <div className="grid grid-cols-2 gap-4">
            {(["man", "zone"] as const).map((cvg) => {
              const c = stats.cvgStats[cvg];
              const otPct = pct(c.onTarget, c.count);
              return (
                <div key={cvg} className="p-3 bg-slate-800/50 rounded-lg">
                  <div className="text-xs text-slate-400 font-medium mb-2 capitalize">vs. {cvg}</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Throws</span><span className="text-slate-300">{c.count}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">On Target</span><span className="text-emerald-300">{c.onTarget || "—"}</span></div>
                    <div className="flex justify-between border-t border-slate-700 pt-1">
                      <span className="text-slate-500">On Target%</span>
                      <span className={`font-semibold ${onTargetColor(otPct)}`}>{fmtPct(otPct)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Play Notes */}
      <PlayerNotesList
        totalPlays={stats.totalPlays}
        notes={plays.map((p) => p.play_notes).filter((n): n is string => !!(n?.trim()))}
      />
    </div>
  );
}
