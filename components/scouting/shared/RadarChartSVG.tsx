"use client";

// Generic polar "spoke" chart — extracted from the WR route-tree radar (V10)
// so RB/QB/TE can each plug in their own spoke set (key/label/angle) without
// re-implementing the SVG math. One spoke = one direction + one 0-100% value;
// length encodes value relative to maxPct, color encodes percentile tier.

export type RadarTier = "top" | "mid" | "bot" | "none";

export const RADAR_TIER_COLOR: Record<RadarTier, string> = {
  top: "#22c55e", mid: "#eab308", bot: "#ef4444", none: "#6b7280",
};

const MIN_DIST_SIZE = 5;

// Percentile-buckets `value` against `dist` (values for the same metric across
// every other charted prospect). Needs at least MIN_DIST_SIZE comparables or
// the spoke renders as "none" (gray, no fill) rather than a misleading tier.
export function computeRadarTier(value: number, dist: number[]): RadarTier {
  if (dist.length < MIN_DIST_SIZE) return "none";
  const sorted = [...dist].sort((a, b) => a - b);
  const n = sorted.length;
  const lo = sorted[Math.floor(n / 3)];
  const hi = sorted[Math.floor((n * 2) / 3)];
  if (value >= hi) return "top";
  if (value >= lo) return "mid";
  return "bot";
}

export interface RadarSpoke {
  key: string;
  label: string;
  angleDeg: number;
  valuePct: number;
  tier: RadarTier;
  hasData: boolean;
}

// SVG layout constants
const CX = 208, CY = 205, R = 115, L_DIST = 150;

function toRad(deg: number) { return (deg * Math.PI) / 180; }

export default function RadarChartSVG({ spokes, maxPct }: { spokes: RadarSpoke[]; maxPct: number }) {
  return (
    <svg viewBox="0 0 400 400" className="w-full" aria-hidden="true">
      {/* Guide rings */}
      {[0.33, 0.66, 1].map((f) => (
        <circle key={f} cx={CX} cy={CY} r={R * f} fill="none" stroke="#1f2937" strokeWidth={1} />
      ))}
      <circle cx={CX} cy={CY} r={5} fill="#e5e7eb" />

      {spokes.map(({ key, label, angleDeg, valuePct, tier, hasData }) => {
        const rad = toRad(angleDeg);
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

        const color = RADAR_TIER_COLOR[tier];

        return (
          <g key={key}>
            {hasData && len > 0 && (
              <>
                <line x1={CX} y1={CY} x2={ex} y2={ey} stroke={color} strokeWidth={3.5} strokeLinecap="round" />
                <polygon points={`${ex},${ey} ${pAx},${pAy} ${pBx},${pBy}`} fill={color} />
              </>
            )}
            <text x={lx} y={ly - 6} textAnchor={anchor} fill="#9ca3af" fontSize={8.5} fontWeight="700" letterSpacing="0.08em">
              {label}
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

// Shared card header for radar chart cards — same look WR's route-tree radar
// introduced, reused as-is by the RB/QB/TE extensions (H1) instead of each
// position re-styling its own gradient header.
export function RadarCardHeader({ title, name, school, draftYear }: {
  title: string; name: string; school: string; draftYear: number;
}) {
  const parts = name.split(" ");
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
          {school} · {draftYear}
        </div>
      </div>
      <div className="absolute top-3 right-4 text-[8px] font-bold tracking-widest text-gray-600 uppercase">
        Draft Prospect
      </div>
    </div>
  );
}

export function RadarTierLegend({ noDataLabel }: { noDataLabel: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-6 text-xs text-gray-400">
      {(["top", "mid", "bot", "none"] as RadarTier[]).map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: RADAR_TIER_COLOR[t] }} />
          {t === "top" ? "Top 1/3" : t === "mid" ? "Mid 1/3" : t === "bot" ? "Bottom 1/3" : noDataLabel}
        </span>
      ))}
    </div>
  );
}
