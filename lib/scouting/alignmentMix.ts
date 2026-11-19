// Where a WR / TE ran his routes in each charted game, as the share outside /
// slot / box (line season grades plan, Stage 2). Pure; client-safe.
//
// The opponent's season coverage grade comes in three (lib/pff/teamUnits.ts:
// weighted by the defenders' coverage snaps at corner, slot and box). A game's
// coverage input is the blend that matches where HE lined up that game:
//   WR (route cells, every charted route): left / right → outside, slot →
//     slot, backfield → box.
//   TE (route-run plays): wide → outside, slot → slot, inline / wing /
//     backfield (full_back, running_back, wing_back) → box.
// A game with no routes to go on (his routes weren't charted by alignment)
// takes his usual mix over all his games.

import type { ScoutingGame, TEPlay } from "../types";
import type { CoverageSpot } from "../pff/teamUnits";

export type AlignmentMix = Record<CoverageSpot, number>;

interface CellsRow { prospect_id: string; game_id: string; cells: Record<string, [number, number]> | null }

const WR_SPOT: Record<string, CoverageSpot> = { left: "outside", right: "outside", slot: "slot", backfield: "box" };
const TE_SPOT: Record<string, CoverageSpot> = {
  wide: "outside", slot: "slot", inline: "box", wing_back: "box", full_back: "box", running_back: "box",
};

const empty = (): AlignmentMix => ({ outside: 0, slot: 0, box: 0 });
const total = (m: AlignmentMix) => m.outside + m.slot + m.box;

/**
 * A WR's routes per game by spot, from his route cells (key
 * route|coverage|alignment|on_line, or the longer tagged keys: the alignment
 * is the third part either way; counts [routes, open]). `rows` = the per-game
 * route cells; `tagRows` fill in games the plain cells don't have.
 */
export function wrRoutesBySpot(rows: readonly CellsRow[], tagRows: readonly CellsRow[] = []): Map<string, AlignmentMix> {
  const out = new Map<string, AlignmentMix>();
  const add = (list: readonly CellsRow[], skip: ReadonlySet<string>) => {
    for (const r of list) {
      if (skip.has(r.game_id)) continue;
      for (const [key, counts] of Object.entries(r.cells ?? {})) {
        const spot = WR_SPOT[key.split("|")[2] ?? ""];
        const n = Array.isArray(counts) ? counts[0] : 0;
        if (!spot || !(n > 0)) continue;
        const m = out.get(r.game_id) ?? empty();
        m[spot] += n;
        out.set(r.game_id, m);
      }
    }
  };
  add(rows, new Set());
  add(tagRows, new Set(out.keys()));
  return out;
}

/** A TE's charted routes per game by spot. */
export function teRoutesBySpot(plays: readonly Pick<TEPlay, "game_id" | "play_type" | "positioning">[]): Map<string, AlignmentMix> {
  const out = new Map<string, AlignmentMix>();
  for (const p of plays) {
    if (p.play_type !== "route_run") continue;
    const spot = TE_SPOT[p.positioning];
    if (!spot) continue;
    const m = out.get(p.game_id) ?? empty();
    m[spot] += 1;
    out.set(p.game_id, m);
  }
  return out;
}

/**
 * Each game's mix as shares (summing to 1): his routes that game, else his
 * usual mix over all his games. Games of a prospect with no routes anywhere
 * get none.
 */
export function alignmentMixByGame(
  games: readonly Pick<ScoutingGame, "id" | "prospect_id">[],
  routesByGame: ReadonlyMap<string, AlignmentMix>,
): Map<string, AlignmentMix> {
  const usual = new Map<string, AlignmentMix>();
  for (const g of games) {
    const r = routesByGame.get(g.id);
    if (!r) continue;
    const u = usual.get(g.prospect_id) ?? empty();
    u.outside += r.outside; u.slot += r.slot; u.box += r.box;
    usual.set(g.prospect_id, u);
  }
  const share = (m: AlignmentMix): AlignmentMix | null => {
    const t = total(m);
    return t > 0 ? { outside: m.outside / t, slot: m.slot / t, box: m.box / t } : null;
  };
  const out = new Map<string, AlignmentMix>();
  for (const g of games) {
    const own = routesByGame.get(g.id);
    const mix = (own && share(own)) ?? (usual.has(g.prospect_id) ? share(usual.get(g.prospect_id)!) : null);
    if (mix) out.set(g.id, mix);
  }
  return out;
}

/** The coverage grade that matches his mix: spots without a grade drop out and the rest re-weight. */
export function blendCoverage(mix: AlignmentMix, grades: Record<CoverageSpot, number | null>): number | null {
  let w = 0, s = 0;
  for (const spot of ["outside", "slot", "box"] as const) {
    const g = grades[spot];
    if (g == null || !(mix[spot] > 0)) continue;
    w += mix[spot]; s += mix[spot] * g;
  }
  return w > 0 ? s / w : null;
}
