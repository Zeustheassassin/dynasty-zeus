"use client";
import { useState } from "react";
import { CURRENT_YEAR, YEARS, ROUNDS, getDraftRoundSlot } from "../lib/helpers";
import { fetchSleeperUser } from "../lib/sleeperUserCache";

interface UseLeaguesOptions {
  /** The currently connected Sleeper user. */
  user: any;
  /** Full Sleeper players map (needed to build free agents list). */
  players: Record<string, any>;
  /** Called when a league is selected and fully loaded. */
  onLeagueLoaded?: (league: any, data: LeagueLoadResult) => void;
}

export interface LeagueLoadResult {
  league: any;
  roster: any;
  rosters: any[];
  picks: any[];
  allPicks: any[];
  standings: any[];
  users: Record<string, string>;
  freeAgents: any[];
  draftId: string | null;
  draftPicks: any[];
  draftOrder: Record<string, number>;
  draftSettings: any;
  selectedLeagueDraftHasOccurred: boolean;
}

/**
 * useLeagues
 *
 * Manages the selected league and its roster/picks/draft data.
 * Provides a `loadRoster` action that fetches all required league data
 * from Sleeper in a single coordinated operation.
 *
 * Usage in Home:
 *   const {
 *     selectedLeague, setSelectedLeague,
 *     roster, rosters, picks, allPicks, standings, users,
 *     freeAgents, draftId, draftPicks, draftOrder, draftSettings,
 *     selectedLeagueDraftHasOccurred,
 *     loadRoster,
 *   } = useLeagues({ user, players });
 */
export function useLeagues({ user, players, onLeagueLoaded }: UseLeaguesOptions) {
  const [selectedLeague, setSelectedLeague] = useState<any>(null);
  const [roster, setRoster] = useState<any>(null);
  const [rosters, setRosters] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [allPicks, setAllPicks] = useState<any[]>([]);
  const [standings, setStandings] = useState<any[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [freeAgents, setFreeAgents] = useState<any[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftPicks, setDraftPicks] = useState<any[]>([]);
  const [draftOrder, setDraftOrder] = useState<Record<string, number>>({});
  const [draftSettings, setDraftSettings] = useState<any>(null);
  const [selectedLeagueDraftHasOccurred, setSelectedLeagueDraftHasOccurred] = useState(false);

  const loadRoster = async (league: any) => {
    // Persist to recent leagues list
    try {
      const stored = localStorage.getItem("recentLeagues");
      let recents = stored ? JSON.parse(stored) : [];
      recents = recents.filter((l: any) => l.league_id !== league.league_id);
      recents.unshift({ league_id: league.league_id, name: league.name });
      localStorage.setItem("recentLeagues", JSON.stringify(recents.slice(0, 5)));
    } catch {}

    setSelectedLeague(league);

    // Step 1: Rosters
    const allRosters: any[] = await fetch(
      `https://api.sleeper.app/v1/league/${league.league_id}/rosters`
    ).then((r) => r.json());
    setRosters(allRosters);

    const rosteredIds = new Set<string>();
    allRosters.forEach((r: any) => {
      (r.players || []).forEach((p: string) => rosteredIds.add(p));
    });

    const rosterToUser: Record<number, string> = {};
    allRosters.forEach((r: any) => { rosterToUser[r.roster_id] = r.owner_id; });

    const myRoster = allRosters.find((r: any) => r.owner_id === user?.user_id);
    if (!myRoster) return;
    setRoster(myRoster);

    const freeAgentsList = Object.values(players)
      .filter((p: any) => p && !rosteredIds.has(String(p.player_id)))
      .sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
      .slice(0, 20);
    setFreeAgents(freeAgentsList);

    // Step 2: Traded picks, drafts, and user names — all in parallel.
    // fetchSleeperUser uses a module-level cache so re-selecting a league or
    // switching between leagues that share owners avoids redundant network hits.
    const [tradedPicksData, draftsData, userResults] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).then((r) => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then((r) => r.json()).catch(() => []),
      Promise.all(allRosters.map((r: any) => fetchSleeperUser(r.owner_id))),
    ]);

    // Build initial (pre-trade) picks for all rounds up to MAX_SUPPORTED (6).
    // We trim below once we know the actual round count from draft settings.
    // Starting large and trimming down preserves all original slot-assignment
    // logic that already works for rounds 1-4.
    const MAX_SUPPORTED_ROUNDS = 6;
    const ALL_ROUNDS = Array.from({ length: MAX_SUPPORTED_ROUNDS }, (_, i) => i + 1);
    let tempPicks: any[] = [];
    YEARS.forEach((year) => {
      allRosters.forEach((r: any) => {
        ALL_ROUNDS.forEach((round) => {
          tempPicks.push({ season: year, round, roster_id: r.roster_id, owner_id: r.roster_id });
        });
      });
    });

    // Apply traded picks
    tradedPicksData.forEach((tp: any) => {
      const match = tempPicks.find(
        (p) =>
          p.season === tp.season &&
          p.round === tp.round &&
          p.roster_id === tp.roster_id
      );
      if (match) match.owner_id = tp.owner_id;
    });

    // Assign draft slots
    const currentDraft = (draftsData as any[]).find((d: any) => d.season === CURRENT_YEAR);

    // Trim to the league's actual round count.
    // Sleeper draft objects sometimes put `rounds` at the top level, sometimes under
    // `settings` — check both, same as DraftHub's own round detection does.
    const settingsRounds = Number(currentDraft?.settings?.rounds ?? currentDraft?.rounds) || 0;
    const tradedMaxRound = (tradedPicksData as any[]).reduce(
      (max: number, tp: any) => Math.max(max, Number(tp.round) || 0), 0
    );
    const leagueRounds = Math.max(settingsRounds, tradedMaxRound, ROUNDS.length);
    tempPicks = tempPicks.filter((p) => Number(p.round) <= leagueRounds);

    const myPicks = tempPicks.filter((p) => p.owner_id === myRoster.roster_id);
    const order: Record<string, number> = currentDraft?.draft_order || {};
    setSelectedLeagueDraftHasOccurred(currentDraft?.status !== "pre_draft");
    const totalDraftTeams = allRosters.length || Number(currentDraft?.settings?.teams) || 0;

    tempPicks.forEach((pick: any) => {
      if (pick.season === CURRENT_YEAR) {
        const userId = rosterToUser[pick.roster_id];
        const baseSlot = Number(order[String(userId)] || 0);
        const slot = getDraftRoundSlot(currentDraft, Number(pick.round), baseSlot, totalDraftTeams);
        pick.slot = slot
          ? `${pick.round}.${String(slot).padStart(2, "0")}`
          : `${pick.round}.${String(pick.roster_id).padStart(2, "0")}`;
      } else {
        pick.slot = `${pick.round}`;
      }
    });

    setAllPicks(tempPicks);
    setPicks(myPicks);

    // Build user display names map
    const userMap: Record<string, string> = {};
    userResults.forEach((u: any) => {
      if (u?.user_id) {
        userMap[u.user_id] = u.display_name || u.username || `User ${u.user_id}`;
      }
    });
    setUsers(userMap);

    // Build standings
    const rosterUserId = myRoster.owner_id;
    const builtStandings = allRosters.map((r: any) => ({
      ...r,
      displayName: userMap[r.owner_id] || `Team ${r.roster_id}`,
      isMe: r.owner_id === rosterUserId,
    }));
    builtStandings.sort(
      (a: any, b: any) =>
        (b.settings?.wins || 0) - (a.settings?.wins || 0) ||
        (b.settings?.fpts || 0) - (a.settings?.fpts || 0)
    );
    setStandings(builtStandings);

    // Load draft picks if we have a current draft
    let loadedDraftPicks: any[] = [];
    let loadedDraftSettings: any = null;
    if (currentDraft?.draft_id) {
      setDraftId(currentDraft.draft_id);
      setDraftOrder(order);
      setDraftSettings(currentDraft);
      loadedDraftSettings = currentDraft;
      try {
        loadedDraftPicks = await fetch(
          `https://api.sleeper.app/v1/draft/${currentDraft.draft_id}/picks`
        ).then((r) => r.json());
        setDraftPicks(loadedDraftPicks);
      } catch {}
    }

    const result: LeagueLoadResult = {
      league,
      roster: myRoster,
      rosters: allRosters,
      picks: myPicks,
      allPicks: tempPicks,
      standings: builtStandings,
      users: userMap,
      freeAgents: freeAgentsList,
      draftId: currentDraft?.draft_id || null,
      draftPicks: loadedDraftPicks,
      draftOrder: order,
      draftSettings: loadedDraftSettings,
      selectedLeagueDraftHasOccurred: currentDraft?.status !== "pre_draft",
    };

    onLeagueLoaded?.(league, result);
  };

  return {
    selectedLeague,
    setSelectedLeague,
    roster,
    setRoster,
    rosters,
    setRosters,
    picks,
    setPicks,
    allPicks,
    setAllPicks,
    standings,
    setStandings,
    users,
    setUsers,
    freeAgents,
    setFreeAgents,
    draftId,
    draftPicks,
    setDraftPicks,
    draftOrder,
    setDraftOrder,
    draftSettings,
    setDraftSettings,
    selectedLeagueDraftHasOccurred,
    setSelectedLeagueDraftHasOccurred,
    loadRoster,
  };
}
