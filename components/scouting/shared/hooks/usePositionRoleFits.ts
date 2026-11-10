"use client";
import { useEffect, useMemo } from "react";
import type { RoleFit, RolePos } from "../../../../lib/scouting/roleFit";
import { computePositionRoleFits } from "../../../../lib/scouting/roleFits";
import type { OverviewData } from "../../overview/useProspectReport";

/**
 * One position's role buckets for a position hub (Should Play, read only).
 * RB / QB / TE need every play at the position, which load lazily, so this asks
 * for them; until they land, those fits are missing. A WR's arrives on his row.
 * `ready` is false while the plays are still loading.
 */
export function usePositionRoleFits(pos: RolePos, data: OverviewData): { fits: Map<string, RoleFit>; ready: boolean } {
  const { prospects, games, rbPlays, qbPlays, tePlays, pffTotals, loadPositionPlays, playsLoaded } = data;
  useEffect(() => {
    if (pos !== "WR") loadPositionPlays(pos);
  }, [pos, loadPositionPlays]);
  const fits = useMemo(
    () => computePositionRoleFits(pos, prospects, games, rbPlays, qbPlays, tePlays, pffTotals),
    [pos, prospects, games, rbPlays, qbPlays, tePlays, pffTotals],
  );
  return { fits, ready: pos === "WR" || (playsLoaded?.[pos] ?? true) };
}
