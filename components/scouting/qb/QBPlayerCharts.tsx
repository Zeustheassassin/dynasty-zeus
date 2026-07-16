"use client";
import { useMemo } from "react";
import type { Prospect, ProspectWithStats, ScoutingGame, QBPlay } from "../../../lib/types";
import { ROUTE_RADAR_TYPES, ROUTE_RADAR_LABEL, ROUTE_RADAR_ANGLE_DEG } from "../shared/routeTreeRadar";
import RadarChartSVG, {
  computeRadarTier,
  RadarCardHeader,
  RadarTierLegend,
  type RadarSpoke,
  type RadarTier,
} from "../shared/RadarChartSVG";

// H1 — the same route-tree fan the WR/TE radars use, but the value is
// on-target% (from the Overview tab's "Accuracy by Route Type & Coverage"
// table) rather than open%, since a QB's route charting grades the throw,
// not whether the target itself got open.
const MIN_THROWS_FOR_TIER = 5;

function isGradedThrow(p: QBPlay): boolean {
  return p.play_type !== "run"
    && p.timing !== "scramble" && p.timing !== "sack" && p.timing !== "throw_away"
    && p.accuracy !== "tipped_ball" && p.accuracy != null;
}

function onTargetPct(plays: QBPlay[]): number | null {
  if (plays.length === 0) return null;
  return (plays.filter((p) => p.accuracy === "on_target").length / plays.length) * 100;
}

interface Props {
  prospect: Prospect;
  allProspects: ProspectWithStats[];
  allGames: ScoutingGame[];
  leaguePlays: QBPlay[];
}

export default function QBPlayerCharts({ prospect, allProspects, allGames, leaguePlays }: Props) {
  const { spokes, hasAnyData, chartedCount } = useMemo(() => {
    const gameToProspect = new Map(allGames.map((g) => [g.id, g.prospect_id]));
    const playsByProspect = new Map<string, QBPlay[]>();
    for (const pl of leaguePlays) {
      const pid = gameToProspect.get(pl.game_id);
      if (!pid) continue;
      if (!playsByProspect.has(pid)) playsByProspect.set(pid, []);
      playsByProspect.get(pid)!.push(pl);
    }

    const qbProspectIds = allProspects.filter((p) => p.position === "QB").map((p) => p.id);

    const dist: Partial<Record<string, number[]>> = {};
    let chartedCount = 0;
    for (const pid of qbProspectIds) {
      const graded = (playsByProspect.get(pid) ?? []).filter(isGradedThrow);
      if (graded.length === 0) continue;
      chartedCount++;
      for (const rt of ROUTE_RADAR_TYPES) {
        const subset = graded.filter((p) => p.route_type === rt);
        if (subset.length < MIN_THROWS_FOR_TIER) continue;
        const v = onTargetPct(subset);
        if (v !== null) (dist[rt] ??= []).push(v);
      }
    }

    const myGraded = (playsByProspect.get(prospect.id) ?? []).filter(isGradedThrow);
    const spokes: RadarSpoke[] = ROUTE_RADAR_TYPES.map((rt) => {
      const subset = myGraded.filter((p) => p.route_type === rt);
      const v = onTargetPct(subset);
      const hasData = v !== null;
      const tier: RadarTier = hasData && subset.length >= MIN_THROWS_FOR_TIER
        ? computeRadarTier(v!, dist[rt] ?? [])
        : "none";
      return { key: rt, label: ROUTE_RADAR_LABEL[rt], angleDeg: ROUTE_RADAR_ANGLE_DEG[rt], valuePct: hasData ? v! : 0, tier, hasData };
    });

    return { spokes, hasAnyData: myGraded.length > 0, chartedCount };
  }, [prospect, allProspects, allGames, leaguePlays]);

  if (!hasAnyData) {
    return (
      <div className="text-gray-500 text-sm text-center py-12">
        No graded throws charted yet — charts will appear once plays are logged.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6 justify-center">
        <div className="bg-gray-950 border border-gray-700 rounded-xl overflow-hidden w-full sm:w-[370px]">
          <RadarCardHeader
            title="On-Target% by Route Type"
            name={prospect.name}
            school={prospect.school}
            draftYear={prospect.draft_class_year}
          />
          <RadarChartSVG spokes={spokes} maxPct={100} />
        </div>
      </div>

      <RadarTierLegend noDataLabel={`< ${MIN_THROWS_FOR_TIER} throws`} />
      <p className="text-center text-[11px] text-gray-600">
        Percentiles vs {chartedCount} charted QB prospects · all years
      </p>
    </div>
  );
}
