"use client";
import { useMemo } from "react";
import type { ProspectWithStats, RouteType } from "../../lib/types";

const ROUTE_TYPES: RouteType[] = [
  "nine", "post", "dig", "curl", "slant", "screen", "other", "flat", "comeback", "corner", "out",
];
const ROUTE_LABEL: Record<RouteType, string> = {
  nine: "NINE", post: "POST", dig: "DIG", curl: "CURL", slant: "SLANT",
  screen: "SCREEN", other: "OTHER", flat: "FLAT", comeback: "COMEBACK",
  corner: "CORNER", out: "OUT",
};
// degrees from east (right), counter-clockwise — mirrors Reception Perception layout
const ROUTE_ANGLE_DEG: Record<RouteType, number> = {
  nine: 90, post: 55, dig: 10, curl: -32, slant: -60, screen: -80,
  other: -118, flat: 178, comeback: 210, corner: 133, out: 162,
};

const TIER_COLOR = { top: "#22c55e", mid: "#eab308", bot: "#ef4444", none: "#6b7280" } as const;
type Tier = "top" | "mid" | "bot" | "none";

const MIN_ROUTES_FOR_TIER = 3;
const MIN_DIST_SIZE = 5;

function computeTier(value: number, dist: number[]): Tier {
  if (dist.length < MIN_DIST_SIZE) return "none";
  const sorted = [...dist].sort((a, b) => a - b);
  const n = sorted.length;
  const lo = sorted[Math.floor(n / 3)];
  const hi = sorted[Math.floor((n * 2) / 3)];
  if (value >= hi) return "top";
  if (value >= lo) return "mid";
  return "bot";
}

interface Spoke { rt: RouteType; valuePct: number; tier: Tier; hasData: boolean; }

// SVG layout constants
const CX = 208, CY = 205, R = 115, L_DIST = 150;

function toRad(deg: number) { return (deg * Math.PI) / 180; }

function ChartSVG({ spokes, maxPct }: { spokes: Spoke[]; maxPct: number }) {
  return (
    <svg viewBox="0 0 400 400" className="w-full">
      {/* Guide rings */}
      {[0.33, 0.66, 1].map((f) => (
        <circle key={f} cx={CX} cy={CY} r={R * f} fill="none" stroke="#1f2937" strokeWidth={1} />
      ))}
      <circle cx={CX} cy={CY} r={5} fill="#e5e7eb" />

      {spokes.map(({ rt, valuePct, tier, hasData }) => {
        const deg = ROUTE_ANGLE_DEG[rt];
        const rad = toRad(deg);
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        const len = hasData && maxPct > 0 ? Math.max(22, (valuePct / maxPct) * R) : 0;

        const ex = CX + cosA * len;
        const ey = CY - sinA * len;

        // Arrowhead geometry
        const hLen = 10, hW = 5;
        const bx = ex - cosA * hLen;
        const by = ey + sinA * hLen;
        const pAx = bx + sinA * hW, pAy = by + cosA * hW;
        const pBx = bx - sinA * hW, pBy = by - cosA * hW;

        // Label position
        const lx = CX + cosA * L_DIST;
        const ly = CY - sinA * L_DIST;
        const anchor: "start" | "middle" | "end" =
          cosA > 0.15 ? "start" : cosA < -0.15 ? "end" : "middle";

        const color = TIER_COLOR[tier];

        return (
          <g key={rt}>
            {hasData && len > 0 && (
              <>
                <line x1={CX} y1={CY} x2={ex} y2={ey} stroke={color} strokeWidth={3.5} strokeLinecap="round" />
                <polygon points={`${ex},${ey} ${pAx},${pAy} ${pBx},${pBy}`} fill={color} />
              </>
            )}
            <text x={lx} y={ly - 6} textAnchor={anchor} fill="#9ca3af" fontSize={8.5} fontWeight="700" letterSpacing="0.08em">
              {ROUTE_LABEL[rt]}
            </text>
            <text x={lx} y={ly + 6} textAnchor={anchor} fill={hasData ? color : "#4b5563"} fontSize={9.5} fontWeight="800">
              {hasData ? `${valuePct.toFixed(1)}%` : "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
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
        <div className="text-[9px] text-gray-400 tracking-[0.1em] uppercase mt-0.5">
          {prospect.school} · {prospect.draft_class_year}
        </div>
      </div>
      <div className="absolute top-3 right-4 text-[8px] font-bold tracking-widest text-gray-600 uppercase">
        Draft Prospect
      </div>
    </div>
  );
}

interface Props {
  prospect: ProspectWithStats;
  allProspects: ProspectWithStats[];
}

export default function PlayerCharts({ prospect, allProspects }: Props) {
  const { successSpokes, pctSpokes, pctMax } = useMemo(() => {
    const sucDist: Partial<Record<RouteType, number[]>> = {};
    const pctDist: Partial<Record<RouteType, number[]>> = {};

    for (const p of allProspects) {
      if (p.total_routes === 0) continue;
      for (const rt of ROUTE_TYPES) {
        const rs = p.route_stats[rt];
        if (!rs || rs.count < MIN_ROUTES_FOR_TIER) continue;
        (sucDist[rt] ??= []).push((rs.open / rs.count) * 100);
        (pctDist[rt] ??= []).push((rs.count / p.total_routes) * 100);
      }
    }

    const pRS = prospect.route_stats;
    const pTotal = prospect.total_routes;

    const successSpokes: Spoke[] = ROUTE_TYPES.map((rt) => {
      const rs = pRS[rt];
      const hasData = !!rs && rs.count > 0;
      const valuePct = hasData ? (rs!.open / rs!.count) * 100 : 0;
      const tier: Tier = hasData && rs!.count >= MIN_ROUTES_FOR_TIER
        ? computeTier(valuePct, sucDist[rt] ?? [])
        : "none";
      return { rt, valuePct, tier, hasData };
    });

    const pctSpokes: Spoke[] = ROUTE_TYPES.map((rt) => {
      const rs = pRS[rt];
      const hasData = !!rs && rs.count > 0 && pTotal > 0;
      const valuePct = hasData ? (rs!.count / pTotal) * 100 : 0;
      const tier: Tier = hasData && rs!.count >= MIN_ROUTES_FOR_TIER
        ? computeTier(valuePct, pctDist[rt] ?? [])
        : "none";
      return { rt, valuePct, tier, hasData };
    });

    const pctMax = Math.max(...pctSpokes.filter((s) => s.hasData).map((s) => s.valuePct), 1);

    return { successSpokes, pctSpokes, pctMax };
  }, [prospect, allProspects]);

  if (prospect.total_routes === 0) {
    return (
      <div className="text-gray-500 text-sm text-center py-12">
        No routes charted yet — charts will appear once plays are logged.
      </div>
    );
  }

  const chartedCount = allProspects.filter((p) => p.total_routes > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6 justify-center">
        <div className="bg-gray-950 border border-gray-700 rounded-xl overflow-hidden w-full sm:w-[370px]">
          <CardHeader title="Success Rate by Route" prospect={prospect} />
          <ChartSVG spokes={successSpokes} maxPct={100} />
        </div>
        <div className="bg-gray-950 border border-gray-700 rounded-xl overflow-hidden w-full sm:w-[370px]">
          <CardHeader title="Route Percentage" prospect={prospect} />
          <ChartSVG spokes={pctSpokes} maxPct={pctMax} />
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-6 text-xs text-gray-400">
        {(["top", "mid", "bot", "none"] as Tier[]).map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: TIER_COLOR[t] }} />
            {t === "top" ? "Top 1/3" : t === "mid" ? "Mid 1/3" : t === "bot" ? "Bottom 1/3" : `< ${MIN_ROUTES_FOR_TIER} routes`}
          </span>
        ))}
      </div>
      <p className="text-center text-[11px] text-gray-600">
        Percentiles vs {chartedCount} charted prospects · all years
      </p>
    </div>
  );
}
