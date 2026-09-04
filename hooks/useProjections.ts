"use client";
import { useState, useRef, useEffect, useMemo, useCallback, type Dispatch, type SetStateAction } from "react";
import { normalizeProjName, getProjectionKickoffAt } from "../lib/helpers";
import { SLEEPER_PROJECTIONS_BASE } from "../lib/constants";
import { computeLeagueFpts, DEFAULT_SCORING } from "../lib/helpers/scoring";
import { useLocalStorage } from "../lib/hooks/useLocalStorage";
import type { SleeperPlayer, ProjectionRow } from "../lib/types";

const ENABLED_EXTRA_SOURCES_KEY = "dz.projections.enabledExtraSources";

/** Raw item shape returned by Sleeper's projections API endpoints. */
interface SleeperRawProjectionItem {
  player_id?: string | number;
  player?: { position?: string; first_name?: string; last_name?: string };
  stats?: Record<string, number>;
  game?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── Projection sources (weights sum to 1.0) ────────────────────────────────
export const PROJ_SOURCES = [
  { id: "fantasypros" as const, label: "FantasyPros",     tier: 1, weight: 0.35 },
  { id: "numberfire"  as const, label: "numberFire",      tier: 1, weight: 0.25 },
  { id: "espn"        as const, label: "ESPN",            tier: 1, weight: 0.25 },
  { id: "sleeper"     as const, label: "RotoWire/Sleeper", tier: 2, weight: 0.15 },
];
export type ProjSourceId = typeof PROJ_SOURCES[number]["id"];

// Raw stat categories tracked for the per-player consensus stat line (feeds
// the Stat Detail tab + CSV export). Only sources with real stat breakdowns
// (Sleeper, ESPN) contribute here — FantasyPros/numberFire report a single
// blended fpts number with no category breakdown.
const STAT_CATEGORIES = [
  "pass_yd", "pass_td", "pass_int",
  "rush_yd", "rush_td",
  "rec", "rec_yd", "rec_td",
] as const;

function pickStatCategories(stats: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!stats) return out;
  for (const key of STAT_CATEGORIES) {
    const v = stats[key];
    if (typeof v === "number" && v !== 0) out[key] = v;
  }
  return out;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export interface UseProjectionsReturn {
  projectionData: ProjectionRow[];
  setProjectionData: Dispatch<SetStateAction<ProjectionRow[]>>;
  loadingProjections: boolean;
  projectionWeek: number;
  setProjectionWeek: Dispatch<SetStateAction<number>>;
  projectionSeasonYear: number | null;
  projectionPosFilter: string;
  setProjectionPosFilter: Dispatch<SetStateAction<string>>;
  projectionSourceStatus: Record<string, boolean>;
  projectionLoaded: boolean;
  setProjectionLoaded: Dispatch<SetStateAction<boolean>>;
  projectionUsesSeasonFallback: boolean;
  loadProjections: (week: number | "season", extraSources?: string[]) => Promise<void>;
  enabledExtraSources: string[];
  toggleExtraSource: (id: string) => void;
}

/**
 * useProjections
 *
 * Manages all projection-related state and the loadProjections action.
 * Pass the current `players` map from Sleeper so the hook can build its
 * name → sleeperId index, and optionally pass `leagueScoringSettings` from
 * the selected league so projections reflect that league's exact scoring rules.
 * Falls back to DEFAULT_SCORING (full PPR, 4pt TDs, 0.5 TEP) when null.
 */
export function useProjections(
  players: Record<string, SleeperPlayer>,
  leagueScoringSettings: Record<string, number> | null
): UseProjectionsReturn {
  const [projectionData, setProjectionData] = useState<ProjectionRow[]>([]);
  const [loadingProjections, setLoadingProjections] = useState(false);
  const [projectionWeek, setProjectionWeek] = useState(1);
  const [projectionSeasonYear, setProjectionSeasonYear] = useState<number | null>(null);
  const [projectionPosFilter, setProjectionPosFilter] = useState("ALL");
  const [projectionSourceStatus, setProjectionSourceStatus] = useState<Record<string, boolean>>({});
  const [projectionLoaded, setProjectionLoaded] = useState(false);
  const [projectionUsesSeasonFallback, setProjectionUsesSeasonFallback] = useState(false);

  // Persisted across sessions so the user's chosen extra sources (FantasyPros,
  // numberFire) survive page navigation and reloads. Sleeper is always on and
  // never lives in this set.
  const [enabledExtraSources, setEnabledExtraSources] = useLocalStorage<string[]>(
    ENABLED_EXTRA_SOURCES_KEY,
    []
  );
  const toggleExtraSource = useCallback(
    (id: string) => {
      const set = new Set(enabledExtraSources);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      setEnabledExtraSources([...set]);
      // Force the auto-load effect to re-run with the new source set; clear
      // current rows so users see a loading state instead of stale data.
      setProjectionData([]);
      setProjectionLoaded(false);
    },
    [enabledExtraSources, setEnabledExtraSources]
  );

  // Monotonic counter: if a newer call starts before the previous one finishes,
  // the older result is discarded so it can never overwrite fresher data.
  const requestIdRef = useRef(0);

  // projectionData has no league_id/scoring attached to its rows — it's fpts
  // baked with whatever scoring was active when it was computed. Track that
  // scoring here so switching leagues (different scoring_settings) invalidates
  // the cache instead of silently reusing another league's fpts numbers.
  const scoringKey = useMemo(
    () => JSON.stringify(leagueScoringSettings ?? DEFAULT_SCORING),
    [leagueScoringSettings]
  );
  const loadedScoringKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (loadedScoringKeyRef.current !== null && loadedScoringKeyRef.current !== scoringKey) {
      setProjectionData([]);
      setProjectionLoaded(false);
    }
  }, [scoringKey]);

  const loadProjections = useCallback(async (week: number | "season", extraSources: string[] = []) => {
    const requestId = ++requestIdRef.current;
    setLoadingProjections(true);
    const statusMap: Record<string, boolean> = {};
    const now = new Date();
    const currentNflYear = now.getFullYear();
    let resolvedProjectionYear = currentNflYear;
    setProjectionSeasonYear(currentNflYear);

    // Use the selected league's scoring settings, or fall back to DEFAULT_SCORING.
    // Always use raw stat fields — never pts_ppr — so the formula is fully controlled.
    const activeScoring = leagueScoringSettings ?? DEFAULT_SCORING;

    // Compute league-specific fpts from raw Sleeper stat fields.
    const calcFpts = (stats: Record<string, number> | undefined, pos: string): number => {
      if (!stats) return 0;
      return computeLeagueFpts(stats as Record<string, number | null | undefined>, activeScoring, pos);
    };

    // Compute default (full PPR, 4pt TDs, 0.5 TEP) fpts for the same stats.
    // Used to build a per-player scaling ratio applied to FantasyPros/numberFire
    // projections, which return a single fpts number with no raw stats breakdown.
    const calcDefaultFpts = (stats: Record<string, number> | undefined, pos: string): number => {
      if (!stats) return 0;
      return computeLeagueFpts(stats as Record<string, number | null | undefined>, DEFAULT_SCORING, pos);
    };

    try {
      // Build name→sleeperId lookup
      const nameIndex = new Map<string, string>();
      Object.values(players).forEach((p: SleeperPlayer) => {
        if (!["QB", "RB", "WR", "TE"].includes(p.position)) return;
        const full = normalizeProjName(p.full_name ?? "");
        if (full) nameIndex.set(full, p.player_id);
        const parts = (p.full_name ?? "").split(" ");
        if (parts.length >= 2) {
          const short = normalizeProjName(parts[0][0] + parts.slice(1).join(""));
          if (short) nameIndex.set(short, p.player_id);
        }
      });

      const sourceRows = new Map<string, {
        totalWeightedFpts: number;
        totalWeight: number;
        sources: string[];
        kickoffAt: number | null;
        // Each source's own (league-scored) fpts for this player, keyed by source
        // id — kept alongside the weighted blend above so the floor/ceiling spread
        // across sources can be read later (see lib/helpers/projectionVolatility.ts).
        perSourceFpts: Record<string, number>;
      }>();

      // Per-player scaling ratio: leagueFpts / defaultFpts, blended (weighted by
      // source weight) across every source that reports raw stats (Sleeper, ESPN).
      // Applied to FantasyPros/numberFire projections (which return a single fpts
      // number with no raw stat breakdown) to approximate league-specific scoring —
      // more raw-stat sources feeding this blend means a sturdier estimate of what
      // those single-number sources are implicitly assuming.
      const ratioAcc = new Map<string, { sum: number; weight: number }>();
      const addRatio = (sleeperId: string, ratio: number, weight: number) => {
        const existing = ratioAcc.get(sleeperId) ?? { sum: 0, weight: 0 };
        existing.sum += ratio * weight;
        existing.weight += weight;
        ratioAcc.set(sleeperId, existing);
      };

      // Per-player consensus raw stat line (weighted average across raw-stat
      // sources), surfaced on each row for the Stat Detail tab + CSV export.
      const statAcc = new Map<string, { sums: Record<string, number>; weight: number }>();
      const addStats = (sleeperId: string, stats: Record<string, number>, weight: number) => {
        const existing = statAcc.get(sleeperId) ?? { sums: {}, weight: 0 };
        for (const [key, value] of Object.entries(pickStatCategories(stats))) {
          existing.sums[key] = (existing.sums[key] ?? 0) + value * weight;
        }
        existing.weight += weight;
        statAcc.set(sleeperId, existing);
      };

      const getKickoffAt = (row: SleeperRawProjectionItem): number | null => {
        const direct = getProjectionKickoffAt(row);
        if (direct) return direct;
        const candidates = [
          row?.game?.kickoffAt, row?.game?.kickoff_at,
          row?.game?.scheduled, row?.game?.start_time,
          row?.metadata?.kickoffAt, row?.metadata?.kickoff_at,
        ];
        const nested = candidates
          .map(Number)
          .find((v) => Number.isFinite(v) && v > 0);
        return nested || null;
      };

      const addRow = (
        sleeperId: string,
        fpts: number,
        sourceId: string,
        weight: number,
        kickoffAt?: number | null
      ) => {
        const existing = sourceRows.get(sleeperId) ?? {
          totalWeightedFpts: 0, totalWeight: 0, sources: [], kickoffAt: null, perSourceFpts: {},
        };
        existing.totalWeightedFpts += fpts * weight;
        existing.totalWeight += weight;
        if (!existing.sources.includes(sourceId)) existing.sources.push(sourceId);
        if (!existing.kickoffAt && kickoffAt) existing.kickoffAt = kickoffAt;
        existing.perSourceFpts[sourceId] = fpts;
        sourceRows.set(sleeperId, existing);
      };

      // Always attempt real weekly data first, regardless of calendar date —
      // external sources (FantasyPros, numberFire) often publish real weekly
      // projections well before Sleeper's own per-week endpoint does, so a
      // blind "Jan-Aug = offseason" cutoff was skipping sources that already
      // had good data. Only fall back to Sleeper's full-season ÷ 17 estimate
      // below if every active source truly comes back empty for this week.
      let usingSeasonFallback = false;
      const posParams = "position[]=QB&position[]=RB&position[]=WR&position[]=TE";

      // Source 1: Sleeper/RotoWire
      // Sleeper is always included. When it's the only active source the consensus
      // math still works correctly because totalWeight equals sleeperWeight for every row.
      try {
        const sleeperWeight = PROJ_SOURCES.find((s) => s.id === "sleeper")!.weight;
        let sleeperData: SleeperRawProjectionItem[] = [];
        if (week === "season") {
          const curUrl = `${SLEEPER_PROJECTIONS_BASE}/${currentNflYear}?season_type=regular&${posParams}`;
          let data: SleeperRawProjectionItem[] = await fetch(curUrl).then((r) => r.json());
          if (!Array.isArray(data) || data.length === 0) {
            const prevUrl = `${SLEEPER_PROJECTIONS_BASE}/${currentNflYear - 1}?season_type=regular&${posParams}`;
            data = await fetch(prevUrl).then((r) => r.json());
            if (Array.isArray(data) && data.length > 0) resolvedProjectionYear = currentNflYear - 1;
          }
          sleeperData = Array.isArray(data) ? data : [];
        } else {
          const url = `${SLEEPER_PROJECTIONS_BASE}/${currentNflYear}/${week}?season_type=regular&${posParams}`;
          const data: SleeperRawProjectionItem[] = await fetch(url).then((r) => r.json());
          sleeperData = Array.isArray(data) ? data : [];
        }
        sleeperData.forEach((item: SleeperRawProjectionItem) => {
          const pos: string = item.player?.position ?? "";
          if (!["QB", "RB", "WR", "TE"].includes(pos) || !item.player_id) return;
          const leagueFpts = calcFpts(item.stats as Record<string, number> | undefined, pos);
          if (leagueFpts <= 0) return;
          addRow(String(item.player_id), leagueFpts, "sleeper", sleeperWeight, getKickoffAt(item));
          // Feed the scaling-ratio + consensus stat-line accumulators for
          // FantasyPros/numberFire adjustment and the Stat Detail tab.
          const defaultFpts = calcDefaultFpts(item.stats as Record<string, number> | undefined, pos);
          if (defaultFpts > 0) addRatio(String(item.player_id), leagueFpts / defaultFpts, sleeperWeight);
          addStats(String(item.player_id), item.stats as Record<string, number> | undefined ?? {}, sleeperWeight);
        });
        statusMap["sleeper"] = true;
      } catch { statusMap["sleeper"] = false; }

      // FantasyPros/numberFire's weekly endpoints carry no season/year of their
      // own the way Sleeper's does (year baked straight into the URL path) — before
      // a new season's real week-N numbers are published, a scrape/query for
      // "week 1" can come back with stale or ambiguous prior-season content and
      // there's no field in the response to catch that. Only trust them for a
      // specific week once Sleeper's year-explicit fetch above already found
      // real data for this exact year/week; full-season ("draft"/YEARLY)
      // requests are unaffected by this gate.
      const weeklyDataYearVerified = week === "season" || sourceRows.size > 0;

      // Source 2: ESPN — opt-in, like FantasyPros/numberFire below, but unlike
      // them it reports a real per-category stat breakdown (pass/rush/rec yards,
      // TDs, etc.), so it's scored directly via calcFpts rather than scaled by a
      // ratio, and it feeds both the ratio and stat-line accumulators just like
      // Sleeper does.
      if (extraSources.includes("espn") && weeklyDataYearVerified) {
        try {
          const weekParam = week === "season" ? "0" : String(week);
          const data: Array<{ name: string; position: string; fpts: number; stats: Record<string, number> }> =
            await fetch(`/api/projections/espn?week=${weekParam}`).then((r) => r.json());
          const src = PROJ_SOURCES.find((s) => s.id === "espn")!;
          data.forEach((item) => {
            const key = normalizeProjName(item.name);
            const sleeperId = nameIndex.get(key);
            if (!sleeperId) return;
            const leagueFpts = calcFpts(item.stats, item.position);
            if (leagueFpts <= 0) return;
            addRow(sleeperId, leagueFpts, src.id, src.weight);
            const defaultFpts = calcDefaultFpts(item.stats, item.position);
            if (defaultFpts > 0) addRatio(sleeperId, leagueFpts / defaultFpts, src.weight);
            addStats(sleeperId, item.stats, src.weight);
          });
          statusMap["espn"] = true;
        } catch { statusMap["espn"] = false; }
      }

      // Finalize the blended scaling ratio (weighted average across every
      // raw-stat source that matched each player) before it's applied below.
      const scalingRatios = new Map<string, number>();
      ratioAcc.forEach((acc, sleeperId) => {
        if (acc.weight > 0) scalingRatios.set(sleeperId, acc.sum / acc.weight);
      });

      // Source 3: FantasyPros — opt-in only; user must explicitly enable it after
      // verifying the link shows the correct year. During offseason their ?week=draft
      // endpoint has no year parameter and returns prior-season data.
      if (extraSources.includes("fantasypros") && weeklyDataYearVerified) {
        try {
          const weekParam = week === "season" ? "draft" : String(week);
          const data: Array<{ name: string; position: string; fpts: number }> =
            await fetch(`/api/projections/fantasypros?week=${weekParam}`).then((r) => r.json());
          const src = PROJ_SOURCES.find((s) => s.id === "fantasypros")!;
          data.forEach((item) => {
            if (item.fpts <= 0) return;
            const key = normalizeProjName(item.name);
            const sleeperId = nameIndex.get(key);
            if (!sleeperId) return;
            // Scale by per-player ratio derived from Sleeper's raw stats so this
            // source reflects the league's scoring rather than standard PPR.
            const ratio = scalingRatios.get(sleeperId) ?? 1;
            addRow(sleeperId, item.fpts * ratio, src.id, src.weight);
          });
          statusMap["fantasypros"] = true;
        } catch { statusMap["fantasypros"] = false; }
      }

      // Source 4: numberFire — opt-in only for the same reason; YEARLY returns prior-season
      // data until FanDuel publishes updated preseason projections.
      if (extraSources.includes("numberfire") && weeklyDataYearVerified) {
        try {
          const weekParam = week === "season" ? "0" : String(week);
          const data: Array<{ name: string; position: string; fpts: number }> =
            await fetch(`/api/projections/numberfire?week=${weekParam}`).then((r) => r.json());
          const src = PROJ_SOURCES.find((s) => s.id === "numberfire")!;
          data.forEach((item) => {
            if (item.fpts <= 0) return;
            const key = normalizeProjName(item.name);
            const sleeperId = nameIndex.get(key);
            if (!sleeperId) return;
            // Same scaling applied as FantasyPros — approximate league scoring adjustment.
            const ratio = scalingRatios.get(sleeperId) ?? 1;
            addRow(sleeperId, item.fpts * ratio, src.id, src.weight);
          });
          statusMap["numberfire"] = true;
        } catch { statusMap["numberfire"] = false; }
      }

      // Fall back to Sleeper's full-season projections ÷ 17 only for a specific
      // week whose weekly attempt above truly came back empty across every
      // active source — the genuine early-offseason case, before anyone has
      // published week-by-week numbers yet.
      if (typeof week === "number" && sourceRows.size === 0) {
        try {
          const posResults = await Promise.all(
            ["QB", "RB", "WR", "TE"].map((pos) =>
              fetch(`${SLEEPER_PROJECTIONS_BASE}/${currentNflYear}?season_type=regular&position=${pos}`)
                .then((r) => r.json())
                .catch(() => [])
            )
          );
          const seasonRaw: SleeperRawProjectionItem[] = posResults.flat();
          if (seasonRaw.length > 0) {
            seasonRaw.forEach((item: SleeperRawProjectionItem) => {
              const pos: string = item.player?.position ?? "";
              if (!["QB", "RB", "WR", "TE"].includes(pos) || !item.player_id) return;
              const leagueFpts = calcFpts(item.stats as Record<string, number> | undefined, pos);
              if (leagueFpts <= 0) return;
              addRow(String(item.player_id), leagueFpts / 17, "sleeper", 1.0);
              // Build per-player scaling ratio for FantasyPros/numberFire adjustment
              const defaultFpts = calcDefaultFpts(item.stats as Record<string, number> | undefined, pos);
              if (defaultFpts > 0) scalingRatios.set(String(item.player_id), leagueFpts / defaultFpts);
              // ÷17 to match the per-week fpts estimate above — this fallback's raw
              // stats are full-season totals, same as the fpts they're derived from.
              const weeklyStats: Record<string, number> = {};
              for (const [k, v] of Object.entries(pickStatCategories(item.stats as Record<string, number> | undefined))) {
                weeklyStats[k] = v / 17;
              }
              addStats(String(item.player_id), weeklyStats, 1.0);
            });
            statusMap["sleeper"] = true;
            usingSeasonFallback = true;
          }
        } catch { /* silently ignore */ }
      }
      setProjectionUsesSeasonFallback(usingSeasonFallback);

      // Build final consensus list
      const rows: ProjectionRow[] = [];
      sourceRows.forEach((row, sleeperId) => {
        const p = players[sleeperId];
        if (!p) return;
        const consensusFpts = row.totalWeight > 0
          ? row.totalWeightedFpts / row.totalWeight
          : 0;
        const statRow = statAcc.get(sleeperId);
        const consensusStats = statRow && statRow.weight > 0
          ? Object.fromEntries(
              Object.entries(statRow.sums).map(([k, v]) => [k, Math.round((v / statRow.weight) * 10) / 10])
            )
          : null;
        rows.push({
          sleeperId,
          full_name: p.full_name,
          position: p.position,
          team: p.team ?? null,
          fpts: Math.round(consensusFpts * 10) / 10,
          sources: row.sources,
          kickoffAt: row.kickoffAt,
          stats: consensusStats,
          sourceFpts: Object.keys(row.perSourceFpts).length > 0
            ? Object.fromEntries(
                Object.entries(row.perSourceFpts).map(([k, v]) => [k, Math.round(v * 10) / 10])
              )
            : null,
        });
      });
      rows.sort((a, b) => b.fpts - a.fpts);
      if (requestId !== requestIdRef.current) return; // superseded by a newer call
      setProjectionData(rows);
      setProjectionSeasonYear(resolvedProjectionYear);
      setProjectionSourceStatus(statusMap);
      setProjectionLoaded(true);
      loadedScoringKeyRef.current = JSON.stringify(activeScoring);
    } finally {
      if (requestId === requestIdRef.current) setLoadingProjections(false);
    }
  }, [players, leagueScoringSettings]);

  return {
    projectionData,
    setProjectionData,
    loadingProjections,
    projectionWeek,
    setProjectionWeek,
    projectionSeasonYear,
    projectionPosFilter,
    setProjectionPosFilter,
    projectionSourceStatus,
    projectionLoaded,
    setProjectionLoaded,
    projectionUsesSeasonFallback,
    loadProjections,
    enabledExtraSources,
    toggleExtraSource,
  };
}
