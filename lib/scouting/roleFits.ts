// Every prospect's role buckets, one map for the screens (Big Board, Analysis,
// Compare). WR's arrive on the prospect (ProspectWithStats.role_fit, built
// from the per-game route cells in aggregateMerge.ts); RB / QB / TE are
// computed from their plays here.
import type { Prospect, QBPlay, RBPlay, ScoutingGame, TEPlay } from "../types";
import type { PffTotals } from "../pff/totals";
import type { RoleFit, RolePos } from "./roleFit";
import { computeRBRoleFits } from "./roleFitRB";
import { computeQBRoleFits } from "./roleFitQB";
import { computeTERoleFits } from "./roleFitTE";

type FitProspect = Prospect & { role_fit?: RoleFit | null };

export function computeRoleFits(
  prospects: readonly FitProspect[],
  games: ScoutingGame[],
  rbPlays: RBPlay[],
  qbPlays: QBPlay[],
  tePlays: TEPlay[],
  /** PFF over each prospect's charted games: QB rushing; RB pass blocking, 10+ yard runs and missed tackles. */
  pff?: ReadonlyMap<string, PffTotals>,
): Map<string, RoleFit> {
  const out = new Map<string, RoleFit>();
  for (const pos of ["WR", "RB", "QB", "TE"] as const) {
    for (const [id, fit] of computePositionRoleFits(pos, prospects, games, rbPlays, qbPlays, tePlays, pff)) out.set(id, fit);
  }
  return out;
}

/** One position's role buckets (a position hub needs only its own). */
export function computePositionRoleFits(
  pos: RolePos,
  prospects: readonly FitProspect[],
  games: ScoutingGame[],
  rbPlays: RBPlay[],
  qbPlays: QBPlay[],
  tePlays: TEPlay[],
  pff?: ReadonlyMap<string, PffTotals>,
): Map<string, RoleFit> {
  const out = new Map<string, RoleFit>();
  if (pos === "WR") {
    for (const p of prospects) if (p.position === "WR" && p.role_fit) out.set(p.id, p.role_fit);
    return out;
  }
  const list = [...prospects];
  const fits = pos === "RB" ? computeRBRoleFits(list, games, rbPlays, pff)
    : pos === "QB" ? computeQBRoleFits(list, games, qbPlays, pff)
      : computeTERoleFits(list, games, tePlays);
  for (const [id, fit] of fits) if (fit) out.set(id, fit);
  return out;
}
