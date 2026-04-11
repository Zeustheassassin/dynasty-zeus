"use client";
import { useState } from "react";
import { normalizeProjName, getProjectionKickoffAt } from "../lib/helpers";

// ── Projection sources (weights sum to 1.0) ────────────────────────────────
export const PROJ_SOURCES = [
  { id: "fantasypros" as const, label: "FantasyPros",     tier: 1, weight: 0.45 },
  { id: "numberfire"  as const, label: "numberFire",      tier: 1, weight: 0.35 },
  { id: "sleeper"     as const, label: "RotoWire/Sleeper", tier: 2, weight: 0.20 },
];
export type ProjSourceId = typeof PROJ_SOURCES[number]["id"];

// ── Hook ────────────────────────────────────────────────────────────────────
/**
 * useProjections
 *
 * Manages all projection-related state and the loadProjections action.
 * Pass the current `players` map from Sleeper so the hook can build its
 * name → sleeperId index.
 */
export function useProjections(players: Record<string, any>) {
  const [projectionData, setProjectionData] = useState<any[]>([]);
  const [loadingProjections, setLoadingProjections] = useState(false);
  const [projectionWeek, setProjectionWeek] = useState(1);
  const [projectionSeasonYear, setProjectionSeasonYear] = useState<number | null>(null);
  const [projectionPosFilter, setProjectionPosFilter] = useState("ALL");
  const [projectionSourceStatus, setProjectionSourceStatus] = useState<Record<string, boolean>>({});
  const [projectionLoaded, setProjectionLoaded] = useState(false);
  const [projectionUsesSeasonFallback, setProjectionUsesSeasonFallback] = useState(false);

  const loadProjections = async (week: number | "season", extraSources: string[] = []) => {
    setLoadingProjections(true);
    const statusMap: Record<string, boolean> = {};
    const now = new Date();
    const currentNflYear = now.getFullYear();
    // NFL regular season runs Sep–Jan. Months 0–7 (Jan–Aug) = offseason.
    const isOffseason = now.getMonth() < 8;
    let resolvedProjectionYear = currentNflYear;
    setProjectionSeasonYear(currentNflYear);

    // Compute PPR fantasy points from a Sleeper stats object.
    const calcSleeperPPR = (stats: any, pos: string): number => {
      if (!stats) return 0;
      const stored = stats.pts_ppr ?? 0;
      if (stored > 0) return stored;
      return (
        (stats.pass_yd ?? 0) * 0.04 +
        (stats.pass_td ?? 0) * 4 +
        (stats.pass_int ?? 0) * -2 +
        (stats.rush_yd ?? 0) * 0.1 +
        (stats.rush_td ?? 0) * 6 +
        (stats.rec ?? 0) * 1 +
        (stats.rec_yd ?? 0) * 0.1 +
        (stats.rec_td ?? 0) * 6 +
        (pos === "TE" ? (stats.rec ?? 0) * 0.5 : 0)
      );
    };

    try {
      // Build name→sleeperId lookup
      const nameIndex = new Map<string, string>();
      Object.values(players).forEach((p: any) => {
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

      const getKickoffAt = (row: any): number | null => {
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
              fetch(`https://api.sleeper.app/projections/nfl/${currentNflYear}?season_type=regular&position=${pos}`)
                .then((r) => r.json())
                .catch(() => [])
            )
          );
          const seasonRaw: any[] = posResults.flat();
          if (seasonRaw.length > 0) {
            seasonRaw.forEach((item: any) => {
              const pos: string = item.player?.position ?? "";
              if (!["QB", "RB", "WR", "TE"].includes(pos) || !item.player_id) return;
              const seasonFpts = calcSleeperPPR(item.stats, pos);
              if (seasonFpts <= 0) return;
              addRow(String(item.player_id), seasonFpts / 17, "sleeper", 1.0);
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
          let sleeperData: any[] = [];
          if (week === "season") {
            const curUrl = `https://api.sleeper.app/projections/nfl/${currentNflYear}?season_type=regular&${posParams}`;
            let data: any[] = await fetch(curUrl).then((r) => r.json());
            if (!Array.isArray(data) || data.length === 0) {
              const prevUrl = `https://api.sleeper.app/projections/nfl/${currentNflYear - 1}?season_type=regular&${posParams}`;
              data = await fetch(prevUrl).then((r) => r.json());
              if (Array.isArray(data) && data.length > 0) resolvedProjectionYear = currentNflYear - 1;
            }
            sleeperData = Array.isArray(data) ? data : [];
          } else {
            const url = `https://api.sleeper.app/projections/nfl/${currentNflYear}/${week}?season_type=regular&${posParams}`;
            const data: any[] = await fetch(url).then((r) => r.json());
            sleeperData = Array.isArray(data) ? data : [];
          }
          sleeperData.forEach((item: any) => {
            const pos: string = item.player?.position ?? "";
            if (!["QB", "RB", "WR", "TE"].includes(pos) || !item.player_id) return;
            const fpts = calcSleeperPPR(item.stats, pos);
            if (fpts <= 0) return;
            addRow(String(item.player_id), fpts, "sleeper", sleeperWeight, getKickoffAt(item));
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
              addRow(sleeperId, item.fpts, src.id, src.weight);
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
              addRow(sleeperId, item.fpts, src.id, src.weight);
            });
            statusMap["numberfire"] = true;
          } catch { statusMap["numberfire"] = false; }
        }

        setProjectionUsesSeasonFallback(false);
      }

      // Build final consensus list
      const rows: any[] = [];
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
          team: p.team,
          fpts: Math.round(consensusFpts * 10) / 10,
          sources: row.sources,
          kickoffAt: row.kickoffAt,
        });
      });
      rows.sort((a, b) => b.fpts - a.fpts);
      setProjectionData(rows);
      setProjectionSeasonYear(resolvedProjectionYear);
      setProjectionSourceStatus(statusMap);
      setProjectionLoaded(true);
    } finally {
      setLoadingProjections(false);
    }
  };

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
  };
}
