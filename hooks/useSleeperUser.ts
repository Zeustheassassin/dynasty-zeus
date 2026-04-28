"use client";
import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { CURRENT_YEAR } from "../lib/helpers";
import { sleeperApi } from "../lib/sleeperApi";
import type { SleeperUser, SleeperLeague } from "../lib/types";
import { getLocalStorageItem, setLocalStorageItem, removeLocalStorageItem } from "@/lib/hooks/useLocalStorage";

// Sleeper dynasty league filter — same criteria used everywhere in the app.
const isDynastyLeague = (l: SleeperLeague) =>
  ((l.settings?.taxi_slots ?? 0) > 0 || (l.roster_positions?.length ?? 0) > 20) &&
  (l.settings?.best_ball ?? 0) === 0;

interface UseSleeperUserOptions {
  /** Called after leagues are loaded (connect or initial hydration). */
  onLeaguesLoaded?: (leagues: SleeperLeague[]) => void;
  /** Called after the core disconnect (clear user/leagues/localStorage) so callers can clear dependent state. */
  onDisconnect?: () => void;
}

export interface UseSleeperUserReturn {
  username: string;
  setUsername: Dispatch<SetStateAction<string>>;
  user: SleeperUser | null;
  setUser: Dispatch<SetStateAction<SleeperUser | null>>;
  leagues: SleeperLeague[];
  setLeagues: Dispatch<SetStateAction<SleeperLeague[]>>;
  connectLoading: boolean;
  connectError: string;
  connectSuccess: string;
  connectSleeper: () => Promise<void>;
  disconnectSleeper: () => void;
}

/**
 * useSleeperUser
 *
 * Manages the Sleeper username / user object and dynasty-league list.
 * Hydrates from localStorage on mount and exposes connectSleeper /
 * disconnectSleeper actions.
 *
 * Usage in Home:
 *   const { user, username, setUsername, leagues, setLeagues,
 *           connectSleeper, disconnectSleeper } = useSleeperUser({
 *     onLeaguesLoaded: (l) => { ... },
 *   });
 */
export function useSleeperUser({ onLeaguesLoaded, onDisconnect }: UseSleeperUserOptions = {}): UseSleeperUserReturn {
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [connectSuccess, setConnectSuccess] = useState("");

  const onLeaguesLoadedRef = useRef(onLeaguesLoaded);
  onLeaguesLoadedRef.current = onLeaguesLoaded;

  // Hydrate from localStorage on mount
  useEffect(() => {
    const parsed = getLocalStorageItem<SleeperUser | null>("sleeperUser", null);
    if (!parsed) return;

    // sleeperApi routes through `/api/sleeper/*` with a localStorage TTL cache;
    // it does not accept an AbortSignal, so unmount-safety uses a flag instead.
    let cancelled = false;
    try {
      setUser(parsed);
      setUsername(parsed.display_name || parsed.username || "");
      sleeperApi
        .getUserLeagues(parsed.user_id, CURRENT_YEAR)
        .then((data) => {
          if (cancelled) return;
          const filtered = Array.isArray(data) ? data.filter(isDynastyLeague) : [];
          setLeagues(filtered);
          onLeaguesLoadedRef.current?.(filtered);
        })
        .catch(() => {
          if (cancelled) return;
          // Sleeper may be unreachable — keep the user object but show empty leagues.
          // The user can manually reconnect when the service is back.
          setLeagues([]);
        });
    } catch { /* ignore corrupt localStorage */ }

    return () => { cancelled = true; };
  }, []);

  const connectSleeper = async () => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setConnectError("Enter your Sleeper username first.");
      setConnectSuccess("");
      return;
    }

    setConnectLoading(true);
    setConnectError("");
    setConnectSuccess("");

    try {
      // Sleeper returns 200 + null body for unknown usernames, so the proxy
      // resolves with a falsy payload — `!data?.user_id` covers that case.
      const data = (await sleeperApi.getUserByUsername(trimmedUsername)) as SleeperUser | null;

      if (!data?.user_id) {
        setConnectError("Sleeper username not found. Double-check the spelling and try again.");
        setLeagues([]);
        return;
      }

      setUser(data);
      setUsername(data.display_name || data.username || trimmedUsername);
      setLocalStorageItem("sleeperUser", data);

      const leaguesData = await sleeperApi.getUserLeagues(data.user_id, CURRENT_YEAR);
      const filtered = Array.isArray(leaguesData) ? leaguesData.filter(isDynastyLeague) : [];
      setLeagues(filtered);
      setConnectSuccess(
        filtered.length > 0
          ? `Connected to Sleeper as ${data.display_name || data.username}.`
          : `Connected as ${data.display_name || data.username}, but no dynasty leagues were found for ${CURRENT_YEAR}.`
      );
      onLeaguesLoaded?.(filtered);
    } catch {
      setConnectError("Could not reach Sleeper right now. Check your connection and try again.");
    } finally {
      setConnectLoading(false);
    }
  };

  const disconnectSleeper = () => {
    setUser(null);
    setLeagues([]);
    setConnectError("");
    setConnectSuccess("");
    removeLocalStorageItem("sleeperUser");
    onDisconnect?.();
  };

  return {
    username,
    setUsername,
    user,
    setUser,
    leagues,
    setLeagues,
    connectLoading,
    connectError,
    connectSuccess,
    connectSleeper,
    disconnectSleeper,
  };
}
