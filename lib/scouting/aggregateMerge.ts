import type {
  Prospect,
  ProspectWithStats,
  RouteStat,
  CoverageStat,
  RouteType,
  RoutePlay,
} from "../types";
import { deriveChartingDecision } from "../../components/scouting/shared/chartingConstants";

const ROUTE_TYPES: RouteType[] = [
  "nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other",
];

// SAE buckets: press is a subtype of man, so it folds into the man bucket for
// the expected-rate math (and stays a display-only column elsewhere). Three
// mutually exclusive buckets keep the weighted average mathematically sound.
const SAE_COVERAGES: Array<"man" | "zone" | "double"> = ["man", "zone", "double"];

export interface ProspectRouteStatsRow {
  prospect_id: string;
  total_games: number;
  total_snaps: number;
  total_routes: number;
  total_yards: number;
  open_routes: number;
  targets: number;
  catches: number;
  drops: number;
  contested: number;
  contested_catches: number;
  success_rate: number | null;
  target_rate: number | null;
  avg_ypc: number | null;
  pct_left: number | null;
  pct_right: number | null;
  pct_slot: number | null;
  pct_backfield: number | null;
  pct_on_line: number | null;
  depth_behind_los: number;
  depth_on_los: number;
  has_charted_open_data: boolean;
  route_stats_raw: Record<string, { count: number; open: number; targets: number; catches: number }>;
  route_type_counts: Record<string, number>;
  coverage_stats_raw: Record<string, { count: number; open: number; catches: number }>;
  coverage_counts: Record<string, number>;
  align_n_slot: number;
  align_n_slot_on_line: number;
  align_n_slot_off_line: number;
  align_n_right: number;
  align_n_right_on_line: number;
  align_n_right_off_line: number;
  align_n_left: number;
  align_n_left_on_line: number;
  align_n_left_off_line: number;
  align_n_backfield: number;
  open_pct_slot: number | null;
  open_pct_slot_on_line: number | null;
  open_pct_slot_off_line: number | null;
  open_pct_right: number | null;
  open_pct_right_on_line: number | null;
  open_pct_right_off_line: number | null;
  open_pct_left: number | null;
  open_pct_left_on_line: number | null;
  open_pct_left_off_line: number | null;
  open_pct_backfield: number | null;
}

export interface LeagueRouteBaselineRow {
  kind: "route" | "coverage";
  key: string;
  n: number;
  open_n: number;
}

interface BaselineMaps {
  route: Map<string, { n: number; open: number }>;
  coverage: Map<string, { n: number; open: number }>;
}

export function indexBaselines(rows: LeagueRouteBaselineRow[]): BaselineMaps {
  const route = new Map<string, { n: number; open: number }>();
  const coverage = new Map<string, { n: number; open: number }>();
  for (const r of rows) {
    if (r.kind === "route") route.set(r.key, { n: r.n, open: r.open_n });
    else if (r.kind === "coverage") coverage.set(r.key, { n: r.n, open: r.open_n });
  }
  return { route, coverage };
}

// Shared weighted-average SAE math: actual open rate vs. an expected rate
// blended from route-type mix and coverage mix against league baselines.
// No minimum-sample gate here — callers that need the reliability floor
// (season/career) apply it themselves before calling in.
function saeFromCounts(
  totalRoutes: number,
  openRoutes: number,
  routeTypeCounts: Record<string, number>,
  coverageCounts: Record<string, number>,
  baselines: BaselineMaps,
): number | null {
  if (totalRoutes === 0) return null;
  const actualOpen = openRoutes / totalRoutes;

  let expRoute = 0, routeW = 0;
  for (const rt of ROUTE_TYPES) {
    const rtCount = routeTypeCounts[rt] ?? 0;
    const lg = baselines.route.get(rt);
    if (rtCount > 0 && lg && lg.n > 0) {
      expRoute += (rtCount / totalRoutes) * (lg.open / lg.n);
      routeW += rtCount / totalRoutes;
    }
  }

  let expCvg = 0, cvgW = 0;
  for (const cvgType of SAE_COVERAGES) {
    // Man bucket combines man + press for both player count and league baseline.
    const cvgCount = cvgType === "man"
      ? (coverageCounts["man"] ?? 0) + (coverageCounts["press"] ?? 0)
      : (coverageCounts[cvgType] ?? 0);
    let lg: { n: number; open: number } | undefined;
    if (cvgType === "man") {
      const m = baselines.coverage.get("man");
      const pr = baselines.coverage.get("press");
      const n = (m?.n ?? 0) + (pr?.n ?? 0);
      const open = (m?.open ?? 0) + (pr?.open ?? 0);
      if (n > 0) lg = { n, open };
    } else {
      lg = baselines.coverage.get(cvgType);
    }
    if (cvgCount > 0 && lg && lg.n > 0) {
      expCvg += (cvgCount / totalRoutes) * (lg.open / lg.n);
      cvgW += cvgCount / totalRoutes;
    }
  }

  const normRoute = routeW > 0 ? expRoute / routeW : null;
  const normCvg = cvgW > 0 ? expCvg / cvgW : null;
  let combined: number | null = null;
  if (normRoute != null && normCvg != null) combined = (normRoute + normCvg) / 2;
  else if (normRoute != null) combined = normRoute;
  else if (normCvg != null) combined = normCvg;
  return combined != null ? parseFloat(((actualOpen - combined) * 100).toFixed(2)) : null;
}

// Mirrors the JS SAE computation in ScoutingHub.prospectsWithStats.
function computeSAE(
  v: ProspectRouteStatsRow,
  baselines: BaselineMaps,
): number | null {
  if (!v.has_charted_open_data || v.total_routes < 15) return null;
  return saeFromCounts(v.total_routes, v.open_routes, v.route_type_counts, v.coverage_counts, baselines);
}

// Per-game SAE (no minimum-sample gate — a single game's worth of routes is
// expected to be noisy; this is a quick "did this game look good/bad" read,
// not the reliability-gated season/career metric). Tallies route-type and
// coverage counts directly from the raw route_plays for one game.
export function computeSAEForPlays(
  routePlays: RoutePlay[],
  baselines: BaselineMaps,
): number | null {
  const rated = routePlays.filter((p) => !p.no_route_run);
  const totalRoutes = rated.length;
  const openRoutes = rated.filter((p) => p.was_open).length;
  const routeTypeCounts: Record<string, number> = {};
  const coverageCounts: Record<string, number> = {};
  for (const p of rated) {
    routeTypeCounts[p.route_type] = (routeTypeCounts[p.route_type] ?? 0) + 1;
    if (p.coverage) coverageCounts[p.coverage] = (coverageCounts[p.coverage] ?? 0) + 1;
  }
  return saeFromCounts(totalRoutes, openRoutes, routeTypeCounts, coverageCounts, baselines);
}

function buildRouteStats(
  raw: Record<string, { count: number; open: number; targets: number; catches: number }>,
  has_charted_open_data: boolean,
): Partial<Record<RouteType, RouteStat>> {
  const out: Partial<Record<RouteType, RouteStat>> = {};
  for (const rt of ROUTE_TYPES) {
    const r = raw[rt];
    if (r && r.count > 0) {
      out[rt] = {
        count: r.count,
        open: has_charted_open_data ? r.open : 0,
        targets: r.targets,
        catches: has_charted_open_data ? r.catches : -1,
      };
    }
  }
  return out;
}

function buildCoverageStats(
  raw: Record<string, { count: number; open: number; catches: number }>,
  has_charted_open_data: boolean,
): Record<"man" | "zone" | "double" | "press", CoverageStat> {
  const make = (type: "man" | "zone" | "double" | "press"): CoverageStat => {
    const r = raw[type];
    const count = r?.count ?? 0;
    return {
      count,
      open: has_charted_open_data ? (r?.open ?? 0) : 0,
      catches: has_charted_open_data ? (r?.catches ?? 0) : -1,
    };
  };
  return { man: make("man"), zone: make("zone"), double: make("double"), press: make("press") };
}

function avgExternalRank(p: Prospect): number | null {
  const ranks = [p.pff_rank, p.mock_draft_rank, p.drafttek_rank, p.pfn_rank].filter(
    (r): r is number => r !== null && r !== undefined,
  );
  if (ranks.length === 0) return null;
  return parseFloat((ranks.reduce((s, r) => s + r, 0) / ranks.length).toFixed(1));
}

export interface ProspectThresholdCounts {
  /** Per-prospect QB throw count (from prospect_qb_stats.total_throws) */
  qbThrowsByProspect?: Map<string, number>;
  /** Per-prospect TE route count (from prospect_te_stats.total_routes) */
  teRoutesByProspect?: Map<string, number>;
}

export function buildProspectsWithStats(
  prospects: Prospect[],
  viewRows: ProspectRouteStatsRow[],
  baselineRows: LeagueRouteBaselineRow[],
  thresholdCounts: ProspectThresholdCounts = {},
): ProspectWithStats[] {
  const byProspect = new Map(viewRows.map((r) => [r.prospect_id, r]));
  const baselines = indexBaselines(baselineRows);
  const { qbThrowsByProspect, teRoutesByProspect } = thresholdCounts;

  return prospects.map((p) => {
    const v = byProspect.get(p.id);

    const total_games = v?.total_games ?? 0;
    const has_charted_open_data = v?.has_charted_open_data ?? false;

    // Per-position threshold count for the "fully charted" auto-promote:
    //   WR → routes from prospect_route_stats, TE → routes from te_plays,
    //   QB → throws from qb_plays. RB falls through to the games-based path.
    const wrRoutes = v?.total_routes ?? 0;
    const teRoutes = teRoutesByProspect?.get(p.id) ?? 0;
    const qbThrows = qbThrowsByProspect?.get(p.id) ?? 0;

    return {
      ...p,
      charting_decision: deriveChartingDecision(
        p.charting_decision,
        total_games,
        p.position,
        p.position === "TE" ? teRoutes : wrRoutes,
        qbThrows,
      ),
      total_snaps: v?.total_snaps ?? 0,
      total_routes: v?.total_routes ?? 0,
      total_games,
      targets: v?.targets ?? 0,
      catches: v?.catches ?? 0,
      drops: v?.drops ?? 0,
      contested: v?.contested ?? 0,
      contested_catches: v?.contested_catches ?? 0,
      total_yards: v?.total_yards ?? 0,
      success_rate: v?.success_rate ?? null,
      target_rate: v?.target_rate ?? null,
      avg_ypc: v?.avg_ypc ?? null,
      pct_left: v?.pct_left ?? null,
      pct_right: v?.pct_right ?? null,
      pct_slot: v?.pct_slot ?? null,
      pct_backfield: v?.pct_backfield ?? null,
      pct_on_line: v?.pct_on_line ?? null,
      adj_success_above_exp: v ? computeSAE(v, baselines) : null,
      avg_external_rank: avgExternalRank(p),
      depth_behind_los: v?.depth_behind_los ?? 0,
      depth_on_los: v?.depth_on_los ?? 0,
      has_charted_open_data,
      route_stats: buildRouteStats(v?.route_stats_raw ?? {}, has_charted_open_data),
      coverage_stats: buildCoverageStats(v?.coverage_stats_raw ?? {}, has_charted_open_data),
      open_pct_slot: v?.open_pct_slot ?? null,
      open_pct_slot_on_line: v?.open_pct_slot_on_line ?? null,
      open_pct_slot_off_line: v?.open_pct_slot_off_line ?? null,
      open_pct_right: v?.open_pct_right ?? null,
      open_pct_right_on_line: v?.open_pct_right_on_line ?? null,
      open_pct_right_off_line: v?.open_pct_right_off_line ?? null,
      open_pct_left: v?.open_pct_left ?? null,
      open_pct_left_on_line: v?.open_pct_left_on_line ?? null,
      open_pct_left_off_line: v?.open_pct_left_off_line ?? null,
      open_pct_backfield: v?.open_pct_backfield ?? null,
      align_n_slot: v?.align_n_slot ?? 0,
      align_n_slot_on_line: v?.align_n_slot_on_line ?? 0,
      align_n_slot_off_line: v?.align_n_slot_off_line ?? 0,
      align_n_right: v?.align_n_right ?? 0,
      align_n_right_on_line: v?.align_n_right_on_line ?? 0,
      align_n_right_off_line: v?.align_n_right_off_line ?? 0,
      align_n_left: v?.align_n_left ?? 0,
      align_n_left_on_line: v?.align_n_left_on_line ?? 0,
      align_n_left_off_line: v?.align_n_left_off_line ?? 0,
      align_n_backfield: v?.align_n_backfield ?? 0,
    };
  });
}

