"use client";
import { useState, useEffect } from "react";
import type { SleeperLeague, SleeperRoster, SleeperPlayer, SleeperTransaction } from "../lib/types";

interface TradeIntelEntry {
  tradeCount30d: number;
  bought: Record<string, number>;
  picksIn: number;
  picksOut: number;
  lastTradeAt: number | null;
}

export function useLeagueMateIntel(
  selectedLeague: SleeperLeague | null,
  rosters: SleeperRoster[],
  players: Record<string, SleeperPlayer>
) {
  const [leagueMateTradeIntel, setLeagueMateTradeIntel] = useState<Record<string, TradeIntelEntry>>({});
  const [loadingLeagueMateIntel, setLoadingLeagueMateIntel] = useState(false);

  useEffect(() => {
    if (!selectedLeague?.league_id || !rosters.length || !Object.keys(players || {}).length) {
      setLeagueMateTradeIntel({});
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoadingLeagueMateIntel(true);
      try {
        const [t1, t2] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${selectedLeague.league_id}/transactions/1`)
            .then((r) => r.json() as Promise<SleeperTransaction[]>)
            .catch(() => [] as SleeperTransaction[]),
          fetch(`https://api.sleeper.app/v1/league/${selectedLeague.league_id}/transactions/2`)
            .then((r) => r.json() as Promise<SleeperTransaction[]>)
            .catch(() => [] as SleeperTransaction[]),
        ]);

        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const rosterStats: Record<string, TradeIntelEntry> = {};
        const ensureRoster = (rosterId: number | string) => {
          const key = String(rosterId);
          if (!rosterStats[key]) {
            rosterStats[key] = {
              tradeCount30d: 0,
              bought: { QB: 0, RB: 0, WR: 0, TE: 0 },
              picksIn: 0,
              picksOut: 0,
              lastTradeAt: null,
            };
          }
          return rosterStats[key];
        };

        [...(Array.isArray(t1) ? t1 : []), ...(Array.isArray(t2) ? t2 : [])]
          .filter(
            (trade) =>
              trade?.type === "trade" &&
              trade?.status === "complete" &&
              Number(trade?.created || 0) >= thirtyDaysAgo
          )
          .forEach((trade) => {
            (trade.roster_ids || []).forEach((rosterId: number) => {
              const entry = ensureRoster(rosterId);
              entry.tradeCount30d += 1;
              entry.lastTradeAt = Math.max(entry.lastTradeAt || 0, Number(trade.created || 0));
            });

            (Object.entries(trade.adds || {}) as [string, number][]).forEach(
              ([playerId, rosterId]) => {
                const pos = players[playerId]?.position;
                if (!["QB", "RB", "WR", "TE"].includes(pos)) return;
                const entry = ensureRoster(rosterId);
                entry.bought[pos] = (entry.bought[pos] || 0) + 1;
              }
            );

            (trade.draft_picks || []).forEach((pick) => {
              if (pick?.owner_id != null) ensureRoster(pick.owner_id).picksIn += 1;
              if (pick?.previous_owner_id != null)
                ensureRoster(pick.previous_owner_id).picksOut += 1;
            });
          });

        if (!cancelled) setLeagueMateTradeIntel(rosterStats);
      } finally {
        if (!cancelled) setLoadingLeagueMateIntel(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [selectedLeague?.league_id, rosters, players]);

  return { leagueMateTradeIntel, loadingLeagueMateIntel };
}
