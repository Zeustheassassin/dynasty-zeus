"use client";
import { useMemo } from "react";
import type { Prospect, ProspectWithStats, ScoutingGame, TEPlay, TEPositioning } from "../../../lib/types";
import { ROUTE_RADAR_TYPES, ROUTE_RADAR_LABEL, ROUTE_RADAR_ANGLE_DEG } from "../shared/routeTreeRadar";
import RadarChartSVG, {
  computeRadarTier,
  RadarCardHeader,
  RadarTierLegend,
  type RadarSpoke,
  type RadarTier,
} from "../shared/RadarChartSVG";

// H1 — TE tracks route_type with the same RouteType union as WR, so its
// "Open% by Route" radar reuses the exact WR route-tree fan (same angles/
// labels). "Open% by Positioning" is a second radar analogous to WR's
// alignment chart, using TE's own positioning categories.
const MIN_ROUTES_FOR_TIER = 3;

const POSITIONING_LABEL: Record<TEPositioning, string> = {
  wide: "WIDE", slot: "SLOT", inline: "INLINE",
  full_back: "FULL BACK", running_back: "RUNNING BACK", wing_back: "WING BACK",
};

const POSITIONING_ANGLE_DEG: Record<TEPositioning, number> = {
  wide: 90, slot: 30, inline: -30,
  full_back: -90, running_back: -150, wing_back: 150,
};

const ALL_POSITIONINGS: TEPositioning[] = ["wide", "slot", "inline", "full_back", "running_back", "wing_back"];

function openPct(plays: TEPlay[]): number | null {
  const rated = plays.filter((p) => p.was_open !== null);
  if (rated.length === 0) return null;
  return (rated.filter((p) => p.was_open === true).length / rated.length) * 100;
}

interface Props {
  prospect: Prospect;
  allProspects: ProspectWithStats[];
  allGames: ScoutingGame[];
  leaguePlays: TEPlay[];
}

export default function TEPlayerCharts({ prospect, allProspects, allGames, leaguePlays }: Props) {
  const { routeSpokes, posSpokes, hasAnyData, chartedCount } = useMemo(() => {
    const gameToProspect = new Map(allGames.map((g) => [g.id, g.prospect_id]));
    const playsByProspect = new Map<string, TEPlay[]>();
    for (const pl of leaguePlays) {
      const pid = gameToProspect.get(pl.game_id);
      if (!pid) continue;
      if (!playsByProspect.has(pid)) playsByProspect.set(pid, []);
      playsByProspect.get(pid)!.push(pl);
    }

    const teProspectIds = allProspects.filter((p) => p.position === "TE").map((p) => p.id);

    const routeDist: Partial<Record<string, number[]>> = {};
    const posDist: Partial<Record<TEPositioning, number[]>> = {};
    let chartedCount = 0;
    for (const pid of teProspectIds) {
      const routePlays = (playsByProspect.get(pid) ?? []).filter((p) => p.play_type === "route_run");
      if (routePlays.length === 0) continue;
      chartedCount++;
      for (const rt of ROUTE_RADAR_TYPES) {
        const subset = routePlays.filter((p) => p.route_type === rt);
        if (subset.length < MIN_ROUTES_FOR_TIER) continue;
        const v = openPct(subset);
        if (v !== null) (routeDist[rt] ??= []).push(v);
      }
      for (const pos of ALL_POSITIONINGS) {
        const subset = routePlays.filter((p) => p.positioning === pos);
        if (subset.length < MIN_ROUTES_FOR_TIER) continue;
        const v = openPct(subset);
        if (v !== null) (posDist[pos] ??= []).push(v);
      }
    }

    const myRoutePlays = (playsByProspect.get(prospect.id) ?? []).filter((p) => p.play_type === "route_run");

    const routeSpokes: RadarSpoke[] = ROUTE_RADAR_TYPES.map((rt) => {
      const subset = myRoutePlays.filter((p) => p.route_type === rt);
      const v = openPct(subset);
      const hasData = v !== null;
      const tier: RadarTier = hasData && subset.length >= MIN_ROUTES_FOR_TIER
        ? computeRadarTier(v!, routeDist[rt] ?? [])
        : "none";
      return { key: rt, label: ROUTE_RADAR_LABEL[rt], angleDeg: ROUTE_RADAR_ANGLE_DEG[rt], valuePct: hasData ? v! : 0, tier, hasData };
    });

    const posSpokes: RadarSpoke[] = ALL_POSITIONINGS.map((pos) => {
      const subset = myRoutePlays.filter((p) => p.positioning === pos);
      const v = openPct(subset);
      const hasData = v !== null;
      const tier: RadarTier = hasData && subset.length >= MIN_ROUTES_FOR_TIER
        ? computeRadarTier(v!, posDist[pos] ?? [])
        : "none";
      return { key: pos, label: POSITIONING_LABEL[pos], angleDeg: POSITIONING_ANGLE_DEG[pos], valuePct: hasData ? v! : 0, tier, hasData };
    });

    return { routeSpokes, posSpokes, hasAnyData: myRoutePlays.length > 0, chartedCount };
  }, [prospect, allProspects, allGames, leaguePlays]);

  if (!hasAnyData) {
    return (
      <div className="text-gray-500 text-sm text-center py-12">
        No routes charted yet — charts will appear once plays are logged.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6 justify-center">
        <div className="bg-gray-950 border border-gray-700 rounded-xl overflow-hidden w-full sm:w-[370px]">
          <RadarCardHeader
            title="Open% by Route"
            name={prospect.name}
            school={prospect.school}
            draftYear={prospect.draft_class_year}
          />
          <RadarChartSVG spokes={routeSpokes} maxPct={100} />
        </div>
        <div className="bg-gray-950 border border-gray-700 rounded-xl overflow-hidden w-full sm:w-[370px]">
          <RadarCardHeader
            title="Open% by Positioning"
            name={prospect.name}
            school={prospect.school}
            draftYear={prospect.draft_class_year}
          />
          <RadarChartSVG spokes={posSpokes} maxPct={100} />
        </div>
      </div>

      <RadarTierLegend noDataLabel={`< ${MIN_ROUTES_FOR_TIER} routes`} />
      <p className="text-center text-[11px] text-gray-600">
        Percentiles vs {chartedCount} charted TE prospects · all years
      </p>
    </div>
  );
}
