"use client";
import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { CURRENT_YEAR } from "../lib/helpers";
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
    const controller = new AbortController();
    const { signal } = controller;

    const parsed = getLocalStorageItem<SleeperUser | null>("sleeperUser", null);
    if (!parsed) return;
    try {
      setUser(parsed);
      setUsername(parsed.display_name || parsed.username || "");
      fetch(`https://api.sleeper.app/v1/user/${parsed.user_id}/leagues/nfl/${CURRENT_YEAR}`, { signal })
        .then((res) => {
          if (!res.ok) throw new Error(`Sleeper returned ${res.status}`);
          return res.json() as Promise<SleeperLeague[]>;
        })
        .then((data) => {
          if (signal.aborted) return;
          const filtered = Array.isArray(data) ? data.filter(isDynastyLeague) : [];
          setLeagues(filtered);
          onLeaguesLoadedRef.current?.(filtered);
        })
        .catch(() => {
          if (signal.aborted) return;
          // Sleeper may be unreachable — keep the user object but show empty leagues.
          // The user can manually reconnect when the service is back.
          setLeagues([]);
        });
    } catch { /* ignore corrupt localStorage */ }

    return () => { controller.abort(); };
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
      const res = await fetch(`https://api.sleeper.app/v1/user/${trimmedUsername}`);
      const data: SleeperUser = await res.json();

      if (!res.ok || !data?.user_id) {
        setConnectError("Sleeper username not found. Double-check the spelling and try again.");
        setLeagues([]);
        return;
      }

      setUser(data);
      setUsername(data.display_name || data.username || trimmedUsername);
      setLocalStorageItem("sleeperUser", data);

      const leaguesRes = await fetch(
        `https://api.sleeper.app/v1/user/${data.user_id}/leagues/nfl/${CURRENT_YEAR}`
      );
      const leaguesData: SleeperLeague[] = await leaguesRes.json();
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
