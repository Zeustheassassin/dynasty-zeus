"use client";
import { useMemo } from "react";
import type { ProspectWithStats, RouteType } from "../../../lib/types";
import { ROUTE_RADAR_TYPES, ROUTE_RADAR_LABEL, ROUTE_RADAR_ANGLE_DEG } from "../shared/routeTreeRadar";
import RadarChartSVG, {
  computeRadarTier,
  RadarTierLegend,
  type RadarSpoke,
  type RadarTier,
} from "../shared/RadarChartSVG";

const ROUTE_TYPES = ROUTE_RADAR_TYPES;

const MIN_ROUTES_FOR_TIER = 3;

function computeTier(value: number, dist: number[]): RadarTier {
  return computeRadarTier(value, dist);
}

interface Spoke { rt: RouteType; valuePct: number; tier: RadarTier; hasData: boolean; }

function toRouteRadarSpokes(spokes: Spoke[]): RadarSpoke[] {
  return spokes.map(({ rt, valuePct, tier, hasData }) => ({
    key: rt,
    label: ROUTE_RADAR_LABEL[rt],
    angleDeg: ROUTE_RADAR_ANGLE_DEG[rt],
    valuePct,
    tier,
    hasData,
  }));
}

function ChartSVG({ spokes, maxPct }: { spokes: Spoke[]; maxPct: number }) {
  return <RadarChartSVG spokes={toRouteRadarSpokes(spokes)} maxPct={maxPct} />;
}

function CardHeader({ title, prospect }: { title: string; prospect: ProspectWithStats }) {
  const parts = prospect.name.split(" ");
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  return (
    <div
      className="relative px-5 py-4 overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0c1a2e 60%, #1a3a5c 100%)" }}
    >
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)",
          backgroundSize: "8px 8px",
        }}
      />
      <div className="relative z-10">
        <div className="text-[9px] font-bold tracking-[0.18em] text-blue-400 uppercase mb-1">{title}</div>
        <div className="text-base font-black text-white leading-tight">
          {first} <span className="text-yellow-400">{last}</span>
        </div>
        <div className="text-[9px] text-slate-400 tracking-[0.1em] uppercase mt-0.5">
          {prospect.school} · {prospect.draft_class_year}
        </div>
      </div>
      <div className="absolute top-3 right-4 text-[8px] font-bold tracking-widest text-slate-600 uppercase">
        Draft Prospect
      </div>
    </div>
  );
}

type AlignKey =
  | "slot" | "slot_on" | "slot_off"
  | "right" | "right_on" | "right_off"
  | "left" | "left_on" | "left_off"
  | "backfield";

const ALIGN_LABEL: Record<AlignKey, string> = {
  slot: "SLOT", slot_on: "SLT ON", slot_off: "SLT OFF",
  right: "RIGHT", right_on: "RT ON", right_off: "RT OFF",
  left: "LEFT", left_on: "LT ON", left_off: "LT OFF",
  backfield: "BF",
};

const ALIGN_ANGLE_DEG: Record<AlignKey, number> = {
  left: 165, left_on: 145, left_off: 185,
  slot: 90, slot_on: 115, slot_off: 65,
  right: 15, right_on: 35, right_off: -5,
  backfield: -90,
};

function getAlignValue(p: ProspectWithStats, k: AlignKey): number | null {
  switch (k) {
    case "slot":      return p.open_pct_slot;
    case "slot_on":   return p.open_pct_slot_on_line;
    case "slot_off":  return p.open_pct_slot_off_line;
    case "right":     return p.open_pct_right;
    case "right_on":  return p.open_pct_right_on_line;
    case "right_off": return p.open_pct_right_off_line;
    case "left":      return p.open_pct_left;
    case "left_on":   return p.open_pct_left_on_line;
    case "left_off":  return p.open_pct_left_off_line;
    case "backfield": return p.open_pct_backfield;
  }
}

const ALL_ALIGN_KEYS: AlignKey[] = [
  "left", "left_on", "left_off",
  "slot", "slot_on", "slot_off",
  "right", "right_on", "right_off",
  "backfield",
];

interface AlignSpoke { key: AlignKey; valuePct: number; tier: RadarTier; hasData: boolean; }

function AlignChartSVG({ spokes }: { spokes: AlignSpoke[] }) {
  const radarSpokes: RadarSpoke[] = spokes.map(({ key, valuePct, tier, hasData }) => ({
    key,
    label: ALIGN_LABEL[key],
    angleDeg: ALIGN_ANGLE_DEG[key],
    valuePct,
    tier,
    hasData,
  }));
  return <RadarChartSVG spokes={radarSpokes} maxPct={100} />;
}

interface Props {
  prospect: ProspectWithStats;
  allProspects: ProspectWithStats[];
}

export default function PlayerCharts({ prospect, allProspects }: Props) {
  const { successSpokes, pctSpokes, pctMax, alignSpokes, hasAlignData } = useMemo(() => {
    const sucDist: Partial<Record<RouteType, number[]>> = {};
    const pctDist: Partial<Record<RouteType, number[]>> = {};
    const alignDist: Partial<Record<AlignKey, number[]>> = {};

    for (const p of allProspects) {
      if (p.total_routes === 0) continue;
      for (const rt of ROUTE_TYPES) {
        const rs = p.route_stats[rt];
        if (!rs || rs.count < MIN_ROUTES_FOR_TIER) continue;
        (sucDist[rt] ??= []).push((rs.open / rs.count) * 100);
        (pctDist[rt] ??= []).push((rs.count / p.total_routes) * 100);
      }
      for (const k of ALL_ALIGN_KEYS) {
        const v = getAlignValue(p, k);
        if (v !== null) (alignDist[k] ??= []).push(v);
      }
    }

    const pRS = prospect.route_stats;
    const pTotal = prospect.total_routes;

    const successSpokes: Spoke[] = ROUTE_TYPES.map((rt) => {
      const rs = pRS[rt];
      const hasData = !!rs && rs.count > 0;
      const valuePct = hasData ? (rs!.open / rs!.count) * 100 : 0;
      const tier: RadarTier = hasData && rs!.count >= MIN_ROUTES_FOR_TIER
        ? computeTier(valuePct, sucDist[rt] ?? [])
        : "none";
      return { rt, valuePct, tier, hasData };
    });

    const pctSpokes: Spoke[] = ROUTE_TYPES.map((rt) => {
      const rs = pRS[rt];
      const hasData = !!rs && rs.count > 0 && pTotal > 0;
      const valuePct = hasData ? (rs!.count / pTotal) * 100 : 0;
      const tier: RadarTier = hasData && rs!.count >= MIN_ROUTES_FOR_TIER
        ? computeTier(valuePct, pctDist[rt] ?? [])
        : "none";
      return { rt, valuePct, tier, hasData };
    });

    const pctMax = Math.max(...pctSpokes.filter((s) => s.hasData).map((s) => s.valuePct), 1);

    const alignSpokes: AlignSpoke[] = ALL_ALIGN_KEYS.map((key) => {
      const v = getAlignValue(prospect, key);
      const hasData = v !== null;
      const valuePct = hasData ? v! : 0;
      const tier: RadarTier = hasData ? computeTier(valuePct, alignDist[key] ?? []) : "none";
      return { key, valuePct, tier, hasData };
    });

    const hasAlignData = alignSpokes.some((s) => s.hasData);

    return { successSpokes, pctSpokes, pctMax, alignSpokes, hasAlignData };
  }, [prospect, allProspects]);

  if (prospect.total_routes === 0) {
    return (
      <div className="text-slate-500 text-sm text-center py-12">
        No routes charted yet — charts will appear once plays are logged.
      </div>
    );
  }

  const chartedCount = allProspects.filter((p) => p.total_routes > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6 justify-center">
        <div className="bg-slate-950 border border-slate-700 rounded-xl overflow-hidden w-full sm:w-[370px]">
          <CardHeader title="Success Rate by Route" prospect={prospect} />
          <ChartSVG spokes={successSpokes} maxPct={100} />
        </div>
        <div className="bg-slate-950 border border-slate-700 rounded-xl overflow-hidden w-full sm:w-[370px]">
          <CardHeader title="Route Percentage" prospect={prospect} />
          <ChartSVG spokes={pctSpokes} maxPct={pctMax} />
        </div>
        {hasAlignData && (
          <div className="bg-slate-950 border border-slate-700 rounded-xl overflow-hidden w-full sm:w-[370px]">
            <CardHeader title="Open% by Alignment" prospect={prospect} />
            <AlignChartSVG spokes={alignSpokes} />
          </div>
        )}
      </div>

      <RadarTierLegend noDataLabel={`< ${MIN_ROUTES_FOR_TIER} routes`} />
      <p className="text-center text-[11px] text-slate-600">
        Percentiles vs {chartedCount} charted prospects · all years
      </p>
    </div>
  );
}
