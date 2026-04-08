"use client";
import { useState, useEffect } from "react";
import { CURRENT_YEAR } from "../lib/helpers";

// Sleeper dynasty league filter — same criteria used everywhere in the app.
const isDynastyLeague = (l: any) =>
  ((l.settings?.taxi_slots ?? 0) > 0 || (l.roster_positions?.length ?? 0) > 20) &&
  (l.settings?.best_ball ?? 0) === 0;

interface UseSleeperUserOptions {
  /** Called after leagues are loaded (connect or initial hydration). */
  onLeaguesLoaded?: (leagues: any[]) => void;
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
  const [user, setUser] = useState<any>(null);
  const [leagues, setLeagues] = useState<any[]>([]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("sleeperUser");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      setUser(parsed);
      fetch(`https://api.sleeper.app/v1/user/${parsed.user_id}/leagues/nfl/${CURRENT_YEAR}`)
        .then((res) => res.json())
        .then((data: any[]) => {
          const filtered = data.filter(isDynastyLeague);
          setLeagues(filtered);
          onLeaguesLoaded?.(filtered);
        });
    } catch { /* ignore corrupt localStorage */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectSleeper = async () => {
    const res = await fetch(`https://api.sleeper.app/v1/user/${username}`);
    const data = await res.json();
    setUser(data);
    localStorage.setItem("sleeperUser", JSON.stringify(data));

    const leaguesRes = await fetch(
      `https://api.sleeper.app/v1/user/${data.user_id}/leagues/nfl/${CURRENT_YEAR}`
    );
    const leaguesData: any[] = await leaguesRes.json();
    const filtered = leaguesData.filter(isDynastyLeague);
    setLeagues(filtered);
    onLeaguesLoaded?.(filtered);
  };

  const disconnectSleeper = () => {
    setUser(null);
    setLeagues([]);
    localStorage.removeItem("sleeperUser");
    onDisconnect?.();
  };

  return {
    username,
    setUsername,
    user,
    setUser,
    leagues,
    setLeagues,
    connectSleeper,
    disconnectSleeper,
  };
}
