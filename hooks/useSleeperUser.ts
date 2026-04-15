"use client";
import { useState, useEffect } from "react";
import { CURRENT_YEAR } from "../lib/helpers";
import type { SleeperUser, SleeperLeague } from "../lib/types";

// Sleeper dynasty league filter — same criteria used everywhere in the app.
const isDynastyLeague = (l: SleeperLeague) =>
  ((l.settings?.taxi_slots ?? 0) > 0 || (l.roster_positions?.length ?? 0) > 20) &&
  ((l.settings as unknown as Record<string, number>)?.best_ball ?? 0) === 0;

interface UseSleeperUserOptions {
  /** Called after leagues are loaded (connect or initial hydration). */
  onLeaguesLoaded?: (leagues: SleeperLeague[]) => void;
  /** Called after the core disconnect (clear user/leagues/localStorage) so callers can clear dependent state. */
  onDisconnect?: () => void;
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
export function useSleeperUser({ onLeaguesLoaded, onDisconnect }: UseSleeperUserOptions = {}) {
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [connectSuccess, setConnectSuccess] = useState("");

  // Hydrate from localStorage on mount
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("sleeperUser"); } catch { return; }
    if (!saved) return;
    try {
      const parsed: SleeperUser = JSON.parse(saved);
      setUser(parsed);
      setUsername(parsed.display_name || parsed.username || "");
      fetch(`https://api.sleeper.app/v1/user/${parsed.user_id}/leagues/nfl/${CURRENT_YEAR}`)
        .then((res) => {
          if (!res.ok) throw new Error(`Sleeper returned ${res.status}`);
          return res.json() as Promise<SleeperLeague[]>;
        })
        .then((data) => {
          const filtered = Array.isArray(data) ? data.filter(isDynastyLeague) : [];
          setLeagues(filtered);
          onLeaguesLoaded?.(filtered);
        })
        .catch(() => {
          // Sleeper may be unreachable — keep the user object but show empty leagues.
          // The user can manually reconnect when the service is back.
          setLeagues([]);
        });
    } catch { /* ignore corrupt localStorage */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      localStorage.setItem("sleeperUser", JSON.stringify(data));

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
    try { localStorage.removeItem("sleeperUser"); } catch { /* private browsing */ }
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
