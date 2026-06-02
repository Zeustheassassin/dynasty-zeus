"use client";
import { useState, useEffect, useRef, useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import type { AlertsCenterItem, WatchlistEntry } from "../lib/types";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";

const log = logger("hooks/useAlerts");

/**
 * useAlerts
 *
 * Manages dashboard alerts, watchlist entries, and dismissed alert IDs.
 * Persists to localStorage (scoped by user ID) and syncs with Supabase
 * when the user is logged in.
 *
 * Supabase tables used (must match supabase/schema.sql):
 *   - watchlists:  player_id, label, threshold_up, threshold_down, league_id
 *   - alerts:      alert_id, category, source, severity, title, detail,
 *                  actionable, dismissed, player_id, league_id, payload, updated_at
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
  supabaseUser: { id: string } | null;
  players: Record<string, { player_id: string; full_name?: string; position?: string; team?: string | null }>;
}

export interface UseAlertsReturn {
  dashboardAlerts: AlertsCenterItem[];
  setDashboardAlerts: Dispatch<SetStateAction<AlertsCenterItem[]>>;
  dismissedAlertIds: string[];
  setDismissedAlertIds: Dispatch<SetStateAction<string[]>>;
  watchlistEntries: WatchlistEntry[];
  setWatchlistEntries: Dispatch<SetStateAction<WatchlistEntry[]>>;
  mergeDashboardAlerts: (incoming: AlertsCenterItem[]) => void;
  dismissAlert: (alertId: string) => void;
  addWatchlistEntry: (playerId: string) => Promise<void>;
  removeWatchlistEntry: (playerId: string) => Promise<void>;
  /**
   * IDs of alerts already persisted in Supabase (seeded from the localStorage
   * and DB hydration paths, extended on each successful upsert). The bulk-persist
   * effect skips these so loaded alerts are never re-UPDATEd — the
   * `alerts_set_updated_at` trigger would otherwise re-stamp `updated_at = now()`
   * every session, keeping stale rows perpetually in the recency window.
   */
  persistedAlertIdsRef: MutableRefObject<Set<string>>;
  alertStoreScope: string;
  watchlistStorageKey: string;
  alertStorageKey: string;
  dismissedAlertStorageKey: string;
}

export function useAlerts({ supabaseUser, players }: UseAlertsOptions): UseAlertsReturn {
  const alertStoreScope = supabaseUser?.id || "guest";
  const watchlistStorageKey = `watchlists_v1_${alertStoreScope}`;
  const alertStorageKey = `alerts_v1_${alertStoreScope}`;
  const dismissedAlertStorageKey = `dismissedAlerts_v1_${alertStoreScope}`;

  const [dashboardAlerts, setDashboardAlerts] = useState<AlertsCenterItem[]>([]);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
  const [watchlistEntries, setWatchlistEntries] = useState<WatchlistEntry[]>([]);

  const latestDismissedRef = useRef<string[]>([]);
  useEffect(() => { latestDismissedRef.current = dismissedAlertIds; }, [dismissedAlertIds]);

  // Alerts already persisted in Supabase — see UseAlertsReturn.persistedAlertIdsRef.
  const persistedAlertIdsRef = useRef<Set<string>>(new Set());

  // Hydrate from localStorage whenever the scope keys change (login/logout).
  // Synchronous setState here is intentional: we read a snapshot from an external
  // store (localStorage) and apply it as the initial value when the user scope changes.
  // A lazy initializer cannot be used because the storage key depends on supabaseUser.id
  // which changes after mount. Block-level disable is necessary — this is a known
  // exception to the set-state-in-effect rule for external-store hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Scope changed (login/logout) — drop the previous user's persisted-id set
    // so we never carry one account's alert IDs into another's.
    persistedAlertIdsRef.current = new Set();
    const watchlist = getLocalStorageItem<WatchlistEntry[] | null>(watchlistStorageKey, null);
    if (watchlist) setWatchlistEntries(watchlist);
    const alerts = getLocalStorageItem<AlertsCenterItem[] | null>(alertStorageKey, null);
    if (alerts) {
      setDashboardAlerts(alerts);
      // These mirror DB rows, so they're already persisted — don't re-upsert them.
      alerts.forEach((a) => persistedAlertIdsRef.current.add(a.id));
    }
    const dismissed = getLocalStorageItem<string[] | null>(dismissedAlertStorageKey, null);
    if (dismissed) setDismissedAlertIds(dismissed);
  }, [watchlistStorageKey, alertStorageKey, dismissedAlertStorageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Sync from Supabase when user logs in
  useEffect(() => {
    if (!supabaseUser) return;

    // Watchlists — shape matches WatchlistEntry interface
    supabase
      .from("watchlists")
      .select("player_id, label, threshold_up, threshold_down, league_id, updated_at")
      .eq("user_id", supabaseUser.id)
      .then(({ data, error }: { data: WatchlistEntry[] | null; error: { message: string } | null }) => {
        if (error) { log.error("watchlists load failed", { err: error.message }); return; }
        if (data && data.length > 0) {
          setWatchlistEntries(data);
          setLocalStorageItem(watchlistStorageKey, data);
        }
      });

    // Alerts — shape matches AlertsCenterItem; use alert_id as id, updated_at as timestamp.
    // Excludes legacy `trade-*` rows: the leaguemate-alerts cron that wrote them was
    // retired, and the same trade activity is now surfaced under the Trades tab via
    // the league-transactions cache instead of duplicating it in the Alerts feed.
    supabase
      .from("alerts")
      .select("alert_id, category, source, severity, title, detail, actionable, dismissed, player_id, league_id, payload, updated_at")
      .eq("user_id", supabaseUser.id)
      .not("alert_id", "like", "trade-%")
      .order("updated_at", { ascending: false })
      .limit(80)
      .then(({ data, error }: { data: Array<{
        alert_id: string;
        category: string;
        source: string;
        severity: string;
        title: string;
        detail: string;
        actionable: boolean;
        dismissed: boolean;
        player_id: string | null;
        league_id: string | null;
        payload: Record<string, unknown>;
        updated_at: string;
      }> | null; error: { message: string } | null }) => {
        if (error) { log.error("alerts load failed", { err: error.message }); return; }
        if (data && data.length > 0) {
          const rows: AlertsCenterItem[] = data.map((row) => ({
            id: row.alert_id,
            category: (row.category || "watchlist") as AlertsCenterItem["category"],
            source: (row.source || "internal") as AlertsCenterItem["source"],
            severity: (row.severity || "low") as AlertsCenterItem["severity"],
            title: row.title || "Saved alert",
            detail: row.detail || "",
            actionable: row.actionable !== false,
            dismissed: !!row.dismissed,
            playerId: row.player_id,
            leagueId: row.league_id,
            link: (row.payload as Record<string, unknown> | null)?.link as string | null ?? null,
            payload: row.payload ?? {},
            timestamp: new Date(row.updated_at).getTime(),
          }));
          const dismissed = rows.filter((r) => r.dismissed).map((r) => r.id);
          setDashboardAlerts(rows);
          setDismissedAlertIds(dismissed);
          // Loaded straight from the alerts table — already persisted, so the
          // bulk-persist effect must not re-UPDATE (and thus re-stamp) them.
          rows.forEach((r) => persistedAlertIdsRef.current.add(r.id));
          setLocalStorageItem(alertStorageKey, rows);
          setLocalStorageItem(dismissedAlertStorageKey, dismissed);
        }
      });
  }, [supabaseUser, watchlistStorageKey, alertStorageKey, dismissedAlertStorageKey]);

  const mergeDashboardAlerts = useCallback((incoming: AlertsCenterItem[]) => {
    if (!incoming.length) return;
    setDashboardAlerts((prev) => {
      const merged = new Map<string, AlertsCenterItem>();
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
  }, []);

  const dismissAlert = (alertId: string) => {
    const nextDismissed = Array.from(new Set([...latestDismissedRef.current, alertId]));
    setDismissedAlertIds(nextDismissed);
    setLocalStorageItem(dismissedAlertStorageKey, nextDismissed);
    setDashboardAlerts((prev) =>
      prev.map((alert) => alert.id === alertId ? { ...alert, dismissed: true } : alert)
    );
    if (supabaseUser) {
      // Upsert so that dismissing an alert that isn't yet persisted still creates the row
      supabase
        .from("alerts")
        .upsert(
          { user_id: supabaseUser.id, alert_id: alertId, dismissed: true, updated_at: new Date().toISOString() },
          { onConflict: "user_id,alert_id" }
        )
        .then(() => {}, (err: unknown) => log.error("alert dismiss upsert failed", { err: String(err) }));
      // The row now exists in the DB — keep the bulk-persist effect from touching it.
      persistedAlertIdsRef.current.add(alertId);
    }
  };

  const removeWatchlistEntry = async (playerId: string) => {
    const nextEntries = watchlistEntries.filter((e) => e.player_id !== playerId);
    setWatchlistEntries(nextEntries);
    setLocalStorageItem(watchlistStorageKey, nextEntries);
    if (supabaseUser) {
      try {
        await supabase
          .from("watchlists")
          .delete()
          .eq("user_id", supabaseUser.id)
          .eq("player_id", playerId);
      } catch (err: unknown) {
        log.error("watchlist delete failed", { err: String(err) });
      }
    }
  };

  const addWatchlistEntry = async (playerId: string) => {
    const player = players[playerId];
    if (!player) return;
    if (watchlistEntries.some((e) => e.player_id === playerId)) return;

    const entry: WatchlistEntry = {
      player_id: playerId,
      label: player.full_name ?? playerId,
      threshold_up: 250,
      threshold_down: 250,
    };
    const nextEntries = [...watchlistEntries, entry];
    setWatchlistEntries(nextEntries);
    setLocalStorageItem(watchlistStorageKey, nextEntries);
    if (supabaseUser) {
      try {
        await supabase
          .from("watchlists")
          .upsert(
            {
              user_id: supabaseUser.id,
              player_id: playerId,
              label: entry.label,
              threshold_up: entry.threshold_up,
              threshold_down: entry.threshold_down,
            },
            { onConflict: "user_id,player_id" }
          );
      } catch (err: unknown) {
        log.error("watchlist upsert failed", { err: String(err) });
      }
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
    persistedAlertIdsRef,
    alertStoreScope,
    watchlistStorageKey,
    alertStorageKey,
    dismissedAlertStorageKey,
  };
}
