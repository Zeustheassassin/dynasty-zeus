"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseclient";
// Using any[] for watchlist/alert data since the runtime shape differs from
// the strict interface definitions in lib/types.ts.

/**
 * useAlerts
 *
 * Manages dashboard alerts, watchlist entries, and dismissed alert IDs.
 * Persists to localStorage (scoped by user ID) and syncs with Supabase
 * when the user is logged in.
 *
 * Usage in Home:
 *   const {
 *     dashboardAlerts, setDashboardAlerts,
 *     dismissedAlertIds, setDismissedAlertIds,
 *     watchlistEntries, setWatchlistEntries,
 *     dismissAlert, addWatchlistEntry, removeWatchlistEntry,
 *     mergeDashboardAlerts,
 *   } = useAlerts({ supabaseUser, players });
 */
interface UseAlertsOptions {
  supabaseUser: any;
  players: Record<string, any>;
}

export function useAlerts({ supabaseUser, players }: UseAlertsOptions) {
  const alertStoreScope = supabaseUser?.id || "guest";
  const watchlistStorageKey = `watchlists_v1_${alertStoreScope}`;
  const alertStorageKey = `alerts_v1_${alertStoreScope}`;
  const dismissedAlertStorageKey = `dismissedAlerts_v1_${alertStoreScope}`;

  const [dashboardAlerts, setDashboardAlerts] = useState<any[]>([]);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
  const [watchlistEntries, setWatchlistEntries] = useState<any[]>([]);

  const latestDismissedRef = useRef<string[]>([]);
  useEffect(() => { latestDismissedRef.current = dismissedAlertIds; }, [dismissedAlertIds]);

  // Hydrate from localStorage whenever the scope keys change (login/logout)
  useEffect(() => {
    try {
      const storedWatchlists = localStorage.getItem(watchlistStorageKey);
      if (storedWatchlists) setWatchlistEntries(JSON.parse(storedWatchlists));
    } catch {}
    try {
      const storedAlerts = localStorage.getItem(alertStorageKey);
      if (storedAlerts) setDashboardAlerts(JSON.parse(storedAlerts));
    } catch {}
    try {
      const storedDismissed = localStorage.getItem(dismissedAlertStorageKey);
      if (storedDismissed) setDismissedAlertIds(JSON.parse(storedDismissed));
    } catch {}
  }, [watchlistStorageKey, alertStorageKey, dismissedAlertStorageKey]);

  // Sync from Supabase when user logs in
  useEffect(() => {
    if (!supabaseUser) return;
    supabase
      .from("watchlists")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .then(({ data }: { data: any[] | null }) => {
        if (data && data.length > 0) {
          const rows: any[] = data.map((row: any) => ({
            player_id: row.player_id,
            added_at: row.added_at,
            display_name: row.display_name,
            position: row.position,
            team: row.team,
          }));
          setWatchlistEntries(rows);
          localStorage.setItem(watchlistStorageKey, JSON.stringify(rows));
        }
      });
    supabase
      .from("alerts_center")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .order("timestamp", { ascending: false })
      .limit(80)
      .then(({ data }: { data: any[] | null }) => {
        if (data && data.length > 0) {
          const rows = data.map((row: any) => ({
            id: row.id,
            type: row.type,
            message: row.message,
            timestamp: row.timestamp,
            dismissed: row.dismissed ?? false,
            leagueId: row.league_id,
            leagueName: row.league_name,
            playerId: row.player_id,
          }));
          setDashboardAlerts(rows);
          localStorage.setItem(alertStorageKey, JSON.stringify(rows));
        }
        supabase
          .from("dismissed_alerts")
          .select("alert_id")
          .eq("user_id", supabaseUser.id)
          .then(({ data: dismissed }: { data: any[] | null }) => {
            if (dismissed && dismissed.length > 0) {
              const ids = dismissed.map((d: any) => d.alert_id);
              setDismissedAlertIds(ids);
              localStorage.setItem(dismissedAlertStorageKey, JSON.stringify(ids));
            }
          });
      });
  }, [supabaseUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mergeDashboardAlerts = (incoming: any[]) => {
    if (!incoming.length) return;
    setDashboardAlerts((prev) => {
      const merged = new Map<string, any>();
      [...prev, ...incoming].forEach((alert) => {
        const existing = merged.get(alert.id);
        merged.set(alert.id, {
          ...existing,
          ...alert,
          dismissed: alert.dismissed ?? existing?.dismissed ?? false,
        });
      });
      return [...merged.values()]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 80);
    });
  };

  const dismissAlert = (alertId: string) => {
    const nextDismissed = Array.from(new Set([...latestDismissedRef.current, alertId]));
    setDismissedAlertIds(nextDismissed);
    localStorage.setItem(dismissedAlertStorageKey, JSON.stringify(nextDismissed));
    if (supabaseUser) {
      supabase
        .from("dismissed_alerts")
        .upsert(
          { user_id: supabaseUser.id, alert_id: alertId, dismissed_at: new Date().toISOString() },
          { onConflict: "user_id,alert_id" }
        )
        .then(() => {});
    }
  };

  const removeWatchlistEntry = async (playerId: string) => {
    const nextEntries = watchlistEntries.filter((e) => e.player_id !== playerId);
    setWatchlistEntries(nextEntries);
    localStorage.setItem(watchlistStorageKey, JSON.stringify(nextEntries));
    if (supabaseUser) {
      await supabase
        .from("watchlists")
        .delete()
        .eq("user_id", supabaseUser.id)
        .eq("player_id", playerId);
    }
  };

  const addWatchlistEntry = async (playerId: string) => {
    const player = players[playerId];
    if (!player) return;
    if (watchlistEntries.some((e) => e.player_id === playerId)) return;

    const entry: any = {
      player_id: playerId,
      added_at: new Date().toISOString(),
      display_name: player.full_name,
      position: player.position,
      team: player.team,
    };
    const nextEntries = [...watchlistEntries, entry];
    setWatchlistEntries(nextEntries);
    localStorage.setItem(watchlistStorageKey, JSON.stringify(nextEntries));
    if (supabaseUser) {
      await supabase
        .from("watchlists")
        .upsert(
          { user_id: supabaseUser.id, player_id: playerId, display_name: entry.display_name, position: entry.position, team: entry.team, added_at: entry.added_at },
          { onConflict: "user_id,player_id" }
        );
    }
  };

  return {
    dashboardAlerts,
    setDashboardAlerts,
    dismissedAlertIds,
    setDismissedAlertIds,
    watchlistEntries,
    setWatchlistEntries,
    mergeDashboardAlerts,
    dismissAlert,
    addWatchlistEntry,
    removeWatchlistEntry,
    // Storage keys exposed so page.tsx can still access them if needed
    watchlistStorageKey,
    alertStorageKey,
    dismissedAlertStorageKey,
  };
}
