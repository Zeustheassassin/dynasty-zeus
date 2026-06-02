"use client";
import { useState, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
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
  { id: "fantasypros" as const, label: "FantasyPros",     tier: 1, weight: 0.45 },
  { id: "numberfire"  as const, label: "numberFire",      tier: 1, weight: 0.35 },
  { id: "sleeper"     as const, label: "RotoWire/Sleeper", tier: 2, weight: 0.20 },
];
export type ProjSourceId = typeof PROJ_SOURCES[number]["id"];

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

  const loadProjections = useCallback(async (week: number | "season", extraSources: string[] = []) => {
    const requestId = ++requestIdRef.current;
    setLoadingProjections(true);
    const statusMap: Record<string, boolean> = {};
    const now = new Date();
    const currentNflYear = now.getFullYear();
    // NFL regular season runs Sep–Jan. Months 0–7 (Jan–Aug) = offseason.
    const isOffseason = now.getMonth() < 8;
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
      }>();

      // Per-player scaling ratio: leagueFpts / defaultFpts derived from Sleeper raw stats.
      // Applied to FantasyPros/numberFire projections (which return a single fpts number
      // with no raw stat breakdown) to approximate league-specific scoring for those sources.
      const scalingRatios = new Map<string, number>();

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
          totalWeightedFpts: 0, totalWeight: 0, sources: [], kickoffAt: null,
        };
        existing.totalWeightedFpts += fpts * weight;
        existing.totalWeight += weight;
        if (!existing.sources.includes(sourceId)) existing.sources.push(sourceId);
        if (!existing.kickoffAt && kickoffAt) existing.kickoffAt = kickoffAt;
        sourceRows.set(sleeperId, existing);
      };

      let usingSeasonFallback = false;
      if (typeof week === "number" && isOffseason) {
        // Offseason: use Sleeper season projections ÷ 17
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
            });
            statusMap["sleeper"] = true;
            usingSeasonFallback = true;
          }
        } catch { /* silently ignore */ }
        setProjectionUsesSeasonFallback(usingSeasonFallback);
      } else {
        // In-season: multi-source weekly consensus
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
            // Build per-player scaling ratio for FantasyPros/numberFire adjustment
            const defaultFpts = calcDefaultFpts(item.stats as Record<string, number> | undefined, pos);
            if (defaultFpts > 0) scalingRatios.set(String(item.player_id), leagueFpts / defaultFpts);
          });
          statusMap["sleeper"] = true;
        } catch { statusMap["sleeper"] = false; }

        // Source 2: FantasyPros — opt-in only; user must explicitly enable it after
        // verifying the link shows the correct year. During offseason their ?week=draft
        // endpoint has no year parameter and returns prior-season data.
        if (extraSources.includes("fantasypros")) {
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

        // Source 3: numberFire — opt-in only for the same reason; YEARLY returns prior-season
        // data until FanDuel publishes updated preseason projections.
        if (extraSources.includes("numberfire")) {
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

        setProjectionUsesSeasonFallback(false);
      }

      // Build final consensus list
      const rows: ProjectionRow[] = [];
      sourceRows.forEach((row, sleeperId) => {
        const p = players[sleeperId];
        if (!p) return;
        const consensusFpts = row.totalWeight > 0
          ? row.totalWeightedFpts / row.totalWeight
          : 0;
        rows.push({
          sleeperId,
          full_name: p.full_name,
          position: p.position,
          team: p.team ?? null,
          fpts: Math.round(consensusFpts * 10) / 10,
          sources: row.sources,
          kickoffAt: row.kickoffAt,
        });
      });
      rows.sort((a, b) => b.fpts - a.fpts);
      if (requestId !== requestIdRef.current) return; // superseded by a newer call
      setProjectionData(rows);
      setProjectionSeasonYear(resolvedProjectionYear);
      setProjectionSourceStatus(statusMap);
      setProjectionLoaded(true);
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
