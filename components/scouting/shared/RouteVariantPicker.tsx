"use client";
import type { RouteType } from "../../../lib/types";
import { routeVariantSpec, routeVariantsFor, type RouteVariantBoard } from "../../../lib/scouting/routeVariants";
import { ROUTE_LABELS } from "./chartingConstants";
import type { UseRouteVariantReturn } from "./hooks/useRouteVariant";

const ACTIVE = { blue: "bg-blue-600 text-white", green: "bg-blue-700 text-white" } as const;
const IDLE = "bg-slate-800 text-slate-400 hover:bg-slate-700";

interface Props {
  route: RouteType | null;
  variant: UseRouteVariantReturn;
  /** Which board it's on: a few sub-routes are one board's only (Called Scramble Drill, QB). */
  board: RouteVariantBoard;
  /** The board's accent: WR and QB "blue" (bg-blue-600), TE "green" (its route buttons are bg-blue-700). */
  accent: "blue" | "green";
  /** Full-height (h-10) buttons, to match a logger whose other buttons are h-10. */
  tall?: boolean;
}

/**
 * The sub-route row under the route buttons (lib/scouting/routeVariants.ts):
 * the route's default is already lit, so a typical route needs no extra
 * click. Other starts unpicked and is outlined in amber until a pick.
 * Depth sub-routes show PFF's yard band.
 */
export default function RouteVariantPicker({ route, variant, board, accent, tall = false }: Props) {
  if (!route) return null;
  const specs = routeVariantsFor(route, board);
  const unpicked = variant.missing(route);
  const height = tall ? "h-10" : "py-1.5";
  const name = ROUTE_LABELS[route];
  return (
    <div role="group" aria-label={`${name} type`} className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className={`text-xs mr-1 ${unpicked ? "text-amber-400" : "text-slate-500"}`}>{name} type</span>
      {specs.map((spec) => {
        const on = variant.value === spec.key;
        return (
          <button key={spec.key} type="button" aria-pressed={on} onClick={() => variant.set(spec.key)}
            title={spec.yards ? `${spec.label}: ${spec.yards} yards (PFF depth)` : spec.label}
            className={`flex-1 whitespace-nowrap px-3 ${height} rounded text-xs font-medium transition ${on ? ACTIVE[accent] : IDLE} ${unpicked ? "ring-1 ring-amber-500/70" : ""}`}>
            {spec.label}
            {spec.yards && <span className={`ml-1 text-[10px] ${on ? "text-blue-100/80" : "text-slate-500"}`}>{spec.yards}</span>}
          </button>
        );
      })}
      {unpicked && <span className="text-[10px] text-amber-400">pick one to log</span>}
      {variant.legacy && variant.value === null && (
        <span className="text-[10px] text-slate-500">charted before sub-routes · optional</span>
      )}
    </div>
  );
}

/** Play-list mark: the route's sub-route, short. Nothing for a route charted before sub-routes. */
export function RouteVariantMark({ route, variant }: { route: RouteType | null; variant: string | null | undefined }) {
  const spec = routeVariantSpec(route, variant);
  if (!spec) return null;
  return <span className="text-slate-400 whitespace-nowrap" title={`${spec.label}${spec.yards ? ` (${spec.yards} yds)` : ""}`}>{spec.short}</span>;
}
