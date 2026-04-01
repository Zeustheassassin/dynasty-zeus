"use client";
import { useState, useEffect, useMemo } from "react";
import Dashboard from "../components/Dashboard";

// -------------------------
// MODULE-LEVEL CONSTANTS
// -------------------------
const CURRENT_YEAR = "2026";
const YEARS = ["2026", "2027", "2028"];
const ROUNDS = [1, 2, 3, 4];
const ROOKIE_YEAR = "2026";

// -------------------------
// PURE HELPER FUNCTIONS
// -------------------------
const getLineupSettings = (league: any) => {
  const positions = league?.roster_positions || [];
  const counts: any = {};
  positions.forEach((pos: string) => {
    if (pos === "BN" || pos === "IR" || pos === "TAXI") return;
    counts[pos] = (counts[pos] || 0) + 1;
  });
  const order = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX"];
  return order
    .filter((pos) => counts[pos])
    .map((pos) => `${pos === "SUPER_FLEX" ? "SFLEX" : pos} ${counts[pos]}`)
    .join(" • ");
};

const STANDARD_SCORING: any = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_first_down: 0,
  pass_cmp: 0, pass_inc: 0, pass_attempt: 0, pass_sack: 0,
  pass_sack_yd: 0, pass_pick_six: 0, bonus_pass_yd_40: 0,
  bonus_pass_td_40: 0, bonus_pass_td_50: 0, rush_yd: 0.1,
  rush_td: 6, rec: 0, rec_yd: 0.1, rec_td: 6,
  rec_2pt: 2, rush_2pt: 2, pass_2pt: 2,
};

const getNonStandardRules = (scoring: any) => {
  const changes: any[] = [];
  Object.keys(scoring || {}).forEach((key) => {
    const value = scoring[key];
    const standard = STANDARD_SCORING[key];
    if (value === 0 || value === null) return;
    if (standard === undefined || value !== standard) changes.push({ key, value });
  });
  return changes;
};

const formatRule = (key: string) => {
  const labels: Record<string, string> = {
    pass_int: "Interceptions Thrown", pass_td_40p: "40+ Yard TD Pass",
    pass_td_50p: "50+ Yard TD Pass", pass_int_td: "Pick Six Thrown",
    pass_att: "Pass Attempts", pass_sack: "Times Sacked",
    pass_cmp: "Completions", pass_cmp_40p: "40+ Yard Completion",
    pass_fd: "Passing First Downs", pass_inc: "Incompletions",
    rush_td_50p: "50+ Yard TD Run", rush_td_40p: "40+ Yard TD Run",
    rush_fd: "Rushing First Downs", rush_att: "Rush Attempts",
    rush_40p: "40+ Yard Rush", rec: "PPR", rec_fd: "Receiving First Downs",
    rec_0_4: "0–4 Yard Catch", rec_5_9: "5–9 Yard Catch",
    rec_10_19: "10–19 Yard Catch", rec_20_29: "20–29 Yard Catch",
    rec_30_39: "30–39 Yard Catch", rec_40p: "40+ Yard Catch",
    rec_td_40p: "40+ Yard TD Catch", rec_td_50p: "50+ Yard TD Catch",
    bonus_rec_rb: "RB Premium", bonus_rec_wr: "WR Premium", bonus_rec_te: "TE Premium",
  };
  return labels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
};

const groupRules = (rules: any[]) => ({
  Passing: rules.filter((r) =>
    r.key.startsWith("pass") || r.key === "pass_int_td" ||
    r.key === "pass_cmp" || r.key === "pass_attempt" || r.key === "pass_sack"
  ),
  Rushing: rules.filter((r) => r.key.startsWith("rush")),
  Receiving: rules.filter((r) =>
    r.key === "rec" || r.key.startsWith("rec_") || r.key.startsWith("bonus_rec")
  ),
});

const fetchFantasyCalcValues = async (): Promise<{ playerValues: Record<string, number>; pickValues: Record<string, number> }> => {
  const res = await fetch(
    "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1"
  );
  const data = await res.json();
  const playerValues: Record<string, number> = {};
  const pickBuckets: Record<string, number[]> = {};
  const pickRoundValues: Record<string, number> = {};

  data.forEach((entry: any) => {
    if (entry.player?.position === "PICK") {
      // Specific slot format: "2026 Pick 1.04"
      const slotMatch = entry.player.name?.match(/^(\d{4}) Pick (\d+)\./);
      if (slotMatch) {
        const key = `${slotMatch[1]}-${slotMatch[2]}`;
        if (!pickBuckets[key]) pickBuckets[key] = [];
        pickBuckets[key].push(entry.value);
        return;
      }
      // Future round format: "2027 1st", "2028 2nd", etc.
      const roundMatch = entry.player.name?.match(/^(\d{4})\s+(\d+)(?:st|nd|rd|th)$/);
      if (roundMatch) {
        pickRoundValues[`${roundMatch[1]}-${roundMatch[2]}`] = entry.value;
      }
    } else {
      const sleeperId = entry.player?.sleeperId;
      if (sleeperId) playerValues[String(sleeperId)] = entry.value;
    }
  });

  const pickValues: Record<string, number> = {};
  // Use averaged specific slot values for current year
  Object.entries(pickBuckets).forEach(([key, vals]) => {
    pickValues[key] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  });
  // Fill future years 1st round picks ("2027 1st", "2028 1st")
  Object.entries(pickRoundValues).forEach(([key, val]) => {
    if (!pickValues[key]) pickValues[key] = val;
  });
  // FC only provides future-year 1st round values; derive 2nd/3rd/4th using 2026 ratios
  const base1st = pickValues["2026-1"];
  if (base1st) {
    Object.entries(pickRoundValues).forEach(([key]) => {
      const [year, roundStr] = key.split("-");
      if (roundStr !== "1") return;
      const yr1stVal = pickValues[key];
      [2, 3, 4].forEach((r) => {
        const rKey = `${year}-${r}`;
        if (!pickValues[rKey]) {
          const base2026 = pickValues[`2026-${r}`];
          if (base2026) pickValues[rKey] = Math.round(yr1stVal * (base2026 / base1st));
        }
      });
    });
  }

  return { playerValues, pickValues };
};

const formatRelativeDate = (ts: number) => {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 21) return "2 weeks ago";
  if (days < 30) return "3 weeks ago";
  return "1 month ago";
};

export default function Home() {

  // -------------------------
  // CORE STATE
  // -------------------------
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<any>(null);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<any>(null);
  const [roster, setRoster] = useState<any>(null);
  const [rosters, setRosters] = useState<any[]>([]);
  const [players, setPlayers] = useState<any>({});
  const [activeTab, setActiveTab] = useState("QB");
  const [search, setSearch] = useState("");
  const [leagueSearch, setLeagueSearch] = useState("");

  const [picks, setPicks] = useState<any[]>([]);
  const [allPicks, setAllPicks] = useState<any[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
const [draftPicks, setDraftPicks] = useState<any[]>([]);
const [draftOrder, setDraftOrder] = useState<any>({});
const [draftSettings, setDraftSettings] = useState<any>(null);
const [draftScoutUserId, setDraftScoutUserId] = useState<string | null>(null);
const [draftScoutData, setDraftScoutData] = useState<any[] | null>(null);
const [loadingDraftScout, setLoadingDraftScout] = useState(false);
const [tradeHubUserId, setTradeHubUserId] = useState<string | null>(null);
const [tradeHubData, setTradeHubData] = useState<any[] | null>(null);
const [loadingTradeHub, setLoadingTradeHub] = useState(false);
const [tradeHubSection, setTradeHubSection] = useState<"TRADES" | "CALCULATOR">("TRADES");
const [pickFcValues, setPickFcValues] = useState<Record<string, number>>({});
const [calcFcValues, setCalcFcValues] = useState<Record<string, number>>({});
const [loadingCalcValues, setLoadingCalcValues] = useState(false);
const [calcValuesLeagueId, setCalcValuesLeagueId] = useState<string | null>(null);
const [calcOpponentRosterId, setCalcOpponentRosterId] = useState<number | null>(null);
const [calcGive, setCalcGive] = useState<string[]>([]);
const [calcReceive, setCalcReceive] = useState<string[]>([]);
const [calcGivePicks, setCalcGivePicks] = useState<string[]>([]);
const [calcReceivePicks, setCalcReceivePicks] = useState<string[]>([]);
const [calcSearchA, setCalcSearchA] = useState("");
const [calcSearchB, setCalcSearchB] = useState("");
  const [users, setUsers] = useState<any>({});
  const [standings, setStandings] = useState<any[]>([]);

  const [mainTab, setMainTab] = useState("DASHBOARD");

  const [allLeagueData, setAllLeagueData] = useState<any[]>([]);
  const [shareSearch, setShareSearch] = useState("");
  const [sharePosition, setSharePosition] = useState("ALL");
  const [freeAgents, setFreeAgents] = useState<any[]>([]);
  const [rookies, setRookies] = useState<any[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [rookieSearch, setRookieSearch] = useState("");
  const [userCache, setUserCache] = useState<any>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
const [externalShares, setExternalShares] = useState<any>(null);
const [loadingShares, setLoadingShares] = useState(false);
const [tempRanks, setTempRanks] = useState<{ [key: number]: string }>({});
// 🔥 BUILD FULL DRAFT BOARD (MATCHES PILLS)

const handleRankChange = (currentIndex: number, newRank: string) => {
  const rank = parseInt(newRank);
  
  if (!rank || rank < 1 || rank > rookies.length) return;

  const updated = [...rookies];
  const [moved] = updated.splice(currentIndex, 1);

  updated.splice(rank - 1, 0, moved);

  setRookies(updated);
};
 

// -------------------------
// LOAD PLAYERS
// -------------------------
useEffect(() => {
  const loadPlayers = async () => {
    const cached = localStorage.getItem("playersCache");
    const cachedAt = localStorage.getItem("playersCacheAt");
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (cached && cachedAt && Date.now() - Number(cachedAt) < ONE_DAY) {
      setPlayers(JSON.parse(cached));
      // Still load pick values even when players come from cache
      fetchFantasyCalcValues().then(({ pickValues }) => setPickFcValues(pickValues)).catch(() => {});
      return;
    }

    const res = await fetch("https://api.sleeper.app/v1/players/nfl");
    const data = await res.json();

    const { playerValues: fcValues, pickValues } = await fetchFantasyCalcValues();
    setPickFcValues(pickValues);

    Object.keys(data).forEach((id) => {
      if (fcValues[id]) {
        data[id].value = fcValues[id];
      }
    });

    // Slim down to only the fields we use before caching — full payload exceeds localStorage quota
    const slim: any = {};
    Object.keys(data).forEach((id) => {
      const p = data[id];
      slim[id] = {
        player_id: p.player_id,
        full_name: p.full_name,
        position: p.position,
        team: p.team,
        age: p.age,
        value: p.value,
      };
    });

    try {
      localStorage.setItem("playersCache", JSON.stringify(slim));
      localStorage.setItem("playersCacheAt", String(Date.now()));
    } catch {
      // localStorage full — skip caching, app still works fine
    }
    setPlayers(data);
  };

  loadPlayers();
}, []);

// Load league-specific FC values whenever the calculator tab is active and a league is selected
useEffect(() => {
  if (tradeHubSection === "CALCULATOR" && selectedLeague?.league_id) {
    loadCalcValues(selectedLeague.league_id);
  }
}, [tradeHubSection, selectedLeague?.league_id]);

useEffect(() => {
  const saved = localStorage.getItem("sleeperUser");

  if (saved) {
    const parsed = JSON.parse(saved);
    setUser(parsed);

    fetch(
      `https://api.sleeper.app/v1/user/${parsed.user_id}/leagues/nfl/${CURRENT_YEAR}`
    )
      .then((res) => res.json())
      .then((data) => setLeagues(
        data.filter((l: any) =>
          ((l.settings?.taxi_slots ?? 0) > 0 ||
          (l.roster_positions?.length ?? 0) > 20) &&
          (l.settings?.best_ball ?? 0) === 0
        )
      ));
  }
}, []);
useEffect(() => {
  if (rookies.length > 0) {
    localStorage.setItem(`rookieBoard_${ROOKIE_YEAR}`, JSON.stringify(rookies));
  }
}, [rookies]);
useEffect(() => {
  fetch("https://docs.google.com/spreadsheets/d/e/2PACX-1vROmAn0k3A92okpYE7UeelIy0vYUMY0NFAGHrI52V68Zm8ff9aruDXB1E6u0hRNr2EHgr54_D7gMBti/pub?output=csv")
    .then((res) => res.text())
    .then((text) => {
      const rows = text.split("\n").slice(1);

      const data = rows
        .map((row) => {
          const cols = row.split(",");

          return {
            name: cols[0]?.replace(/"/g, "").trim(),
            position: cols[1]?.replace(/"/g, "").trim(),
          };
        })
        .filter((p) => p.name);

      const saved = localStorage.getItem(`rookieBoard_${ROOKIE_YEAR}`);

if (saved) {
  const savedData = JSON.parse(saved);

  // 🔥 Create map of saved players by name
  const savedMap: any = {};
  savedData.forEach((p: any) => {
    savedMap[p.name] = p;
  });

  // 🔥 Merge sheet data + saved rankings
  const merged = data.map((p) => {
    if (savedMap[p.name]) {
      return savedMap[p.name]; // keep user ranking
    }
    return p; // new player from sheet
  });

  // 🔥 Add any players that were removed from sheet (optional)
  const mergedNames = new Set(merged.map((p) => p.name));

  savedData.forEach((p: any) => {
    if (!mergedNames.has(p.name)) {
      merged.push(p);
    }
  });

  setRookies(merged);
} else {
  setRookies(data);
}
    });
}, []);
useEffect(() => {
  if (!selectedLeague || mainTab !== "DRAFT") return;

  let interval: any;

  const loadDraft = async () => {
    try {
      // 1. Get drafts
      const draftsRes = await fetch(
        `https://api.sleeper.app/v1/league/${selectedLeague.league_id}/drafts`
      );
      const drafts = await draftsRes.json();

      const currentDraft = drafts[0];
if (!currentDraft) return;

setDraftId(currentDraft.draft_id);

// 🔥 ADD THESE TWO LINES
setDraftOrder(currentDraft.draft_order || currentDraft.slot_to_roster_id || {});
setDraftSettings(currentDraft.settings);

      // 2. Get picks
      const picksRes = await fetch(
        `https://api.sleeper.app/v1/draft/${currentDraft.draft_id}/picks`
      );
      const picks = await picksRes.json();

      setDraftPicks(picks);
    } catch (err) {
      console.warn("Draft polling failed");
    }
  };

  loadDraft();
  interval = setInterval(loadDraft, 5000);

  return () => clearInterval(interval);
}, [selectedLeague, mainTab]);
const getStarterSlots = (roster: any, league: any) => {
  if (!roster?.starters || !league?.roster_positions) return [];

  return roster.starters.map((playerId: string, i: number) => ({
    playerId,
    slot: league.roster_positions[i], // QB, RB, FLEX, etc
  }));
};
  // -------------------------
  // CONNECT
  // -------------------------
  const connectSleeper = async () => {
    const res = await fetch(`https://api.sleeper.app/v1/user/${username}`);
    const data = await res.json();
    setUser(data);
    localStorage.setItem("sleeperUser", JSON.stringify(data));

    const leaguesRes = await fetch(
      `https://api.sleeper.app/v1/user/${data.user_id}/leagues/nfl/${CURRENT_YEAR}`
    );
    const leaguesData = await leaguesRes.json();
    setLeagues(
      leaguesData.filter((l: any) =>
        (l.settings?.taxi_slots ?? 0) > 0 ||
        (l.roster_positions?.length ?? 0) > 20
      )
    );
  };
  const disconnectSleeper = () => {
  setUser(null);
  setLeagues([]);
  setSelectedLeague(null);
  setRoster(null);
  setRosters([]);
  setPicks([]);
  localStorage.removeItem("sleeperUser");
};

  // -------------------------
  // LOAD ALL LEAGUES FOR SHARES
  // -------------------------
  useEffect(() => {
    const loadAll = async () => {
      if (!user || !leagues.length) return;

      const results = await Promise.all(
        leagues.map(async (league) => {
          const res = await fetch(
            `https://api.sleeper.app/v1/league/${league.league_id}/rosters`
          );
          const rosters = await res.json();

          const myRoster = rosters.find(
            (r: any) => r.owner_id === user.user_id
          );

          return {
            leagueName: league.name,
            roster: myRoster,
          };
        })
      );

      setAllLeagueData(results);
        const savedLeague = localStorage.getItem("selectedLeague");

  if (savedLeague) {
    const parsedLeague = JSON.parse(savedLeague);

    const match = leagues.find(
      (l: any) => l.league_id === parsedLeague.league_id
    );

    if (match) {
      loadRoster(match);
    }
  }
    };

    loadAll();
  }, [user, leagues]);

  // -------------------------
  // SHARES
  // -------------------------
  const totalLeagues = allLeagueData.length || 1;

  const shares = useMemo(() => {
    const map: any = {};
    allLeagueData.forEach((entry) => {
      const roster = entry.roster;
      if (!roster) return;
      roster.players?.forEach((playerId: string) => {
        if (!map[playerId]) map[playerId] = { count: 0, leagues: [], starters: [] };
        map[playerId].count++;
        map[playerId].leagues.push(entry.leagueName);
        if (roster.starters?.includes(playerId)) map[playerId].starters.push(entry.leagueName);
      });
    });
    return map;
  }, [allLeagueData]);

  // -------------------------
// LOAD LEAGUE 
// -------------------------
const loadRoster = async (league: any) => {

  // ── Save recent league ───────────────────────────────────────────────────
  const stored = localStorage.getItem("recentLeagues");
  let recents = stored ? JSON.parse(stored) : [];
  recents = recents.filter((l: any) => l.league_id !== league.league_id);
  recents.unshift({ league_id: league.league_id, name: league.name });
  localStorage.setItem("recentLeagues", JSON.stringify(recents.slice(0, 5)));

  setSelectedLeague(league);

  // ── Step 1: Rosters (everything else depends on this) ────────────────────
  const rostersRes = await fetch(
    `https://api.sleeper.app/v1/league/${league.league_id}/rosters`
  );
  const allRosters = await rostersRes.json();
  setRosters(allRosters);

  // ── Step 2: Synchronous work derived from rosters ────────────────────────
  const rosteredIds = new Set<string>();
  allRosters.forEach((r: any) => {
    (r.players || []).forEach((p: string) => rosteredIds.add(p));
  });

  const rosterToUser: any = {};
  allRosters.forEach((r: any) => { rosterToUser[r.roster_id] = r.owner_id; });

  const myRoster = allRosters.find((r: any) => r.owner_id === user.user_id);
  if (!myRoster) return;
  setRoster(myRoster);

  setFreeAgents(
    Object.values(players || {})
      .filter((p: any) => p && !rosteredIds.has(String(p.player_id)))
      .sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
      .slice(0, 20)
  );

  let tempPicks: any[] = [];
  YEARS.forEach((year) => {
    allRosters.forEach((r: any) => {
      ROUNDS.forEach((round) => {
        tempPicks.push({ season: year, round, roster_id: r.roster_id, owner_id: r.roster_id });
      });
    });
  });

  // ── Step 3: Traded picks, draft order, and user names — all in parallel ──
  const [tradedPicksData, draftsData, userResults] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).then((r) => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then((r) => r.json()).catch(() => []),
    Promise.all(
      allRosters.map((r: any) =>
        fetch(`https://api.sleeper.app/v1/user/${r.owner_id}`).then((r) => r.json())
      )
    ),
  ]);

  // ── Step 4: Apply traded picks ───────────────────────────────────────────
  tradedPicksData.forEach((tp: any) => {
    const match = tempPicks.find(
      (p) => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id
    );
    if (match) match.owner_id = tp.owner_id;
  });

  // ── Step 5: My picks (after trades applied) ──────────────────────────────
  const myPicks = tempPicks.filter((p) => p.owner_id === myRoster.roster_id);

  // ── Step 6: Assign draft slots ───────────────────────────────────────────
  const currentDraft = draftsData.find((d: any) => d.season === CURRENT_YEAR);
  const order = currentDraft?.draft_order || {};

  tempPicks.forEach((pick: any) => {
    if (pick.season === CURRENT_YEAR) {
      const userId = rosterToUser[pick.roster_id];
      const slot = order[String(userId)];
      pick.slot = slot
        ? `${pick.round}.${String(slot).padStart(2, "0")}`
        : `${pick.round}.${String(pick.roster_id).padStart(2, "0")}`;
    } else {
      pick.slot = `${pick.round}`;
    }
  });

  setAllPicks(tempPicks);
  setPicks(
    myPicks.sort((a: any, b: any) => {
      if (a.season !== b.season) return a.season - b.season;
      if (a.round !== b.round) return a.round - b.round;
      const aSlot = parseInt(a.slot?.split(".")[1] || 0);
      const bSlot = parseInt(b.slot?.split(".")[1] || 0);
      return aSlot - bSlot;
    })
  );

  // ── Step 7: Apply user names ─────────────────────────────────────────────
  const userMap: any = {};
  allRosters.forEach((r: any, i: number) => {
    const u = userResults[i];
    if (u) {
      userMap[r.roster_id] = u.display_name;
      userMap[r.owner_id] = u.display_name;
    }
  });
  setUsers(userMap);

  // ── Step 8: Standings ────────────────────────────────────────────────────
  setStandings(
    allRosters
      .map((r: any) => ({
        roster_id: r.roster_id,
        wins: r.settings?.wins || 0,
        losses: r.settings?.losses || 0,
        ties: r.settings?.ties || 0,
        fpts: r.settings?.fpts || 0,
        max_pf: r.settings?.fpts_max || 0,
        owner_id: r.owner_id,
      }))
      .sort((a: any, b: any) =>
        b.wins !== a.wins ? b.wins - a.wins : b.fpts - a.fpts
      )
  );
};
const loadUserExposure = async (userId: string) => {
  // ✅ CACHE CHECK (PUT THIS FIRST)
if (userCache[userId]) {
  setExternalShares(userCache[userId]);
  setSelectedUserId(userId);
  return;
}
  try {
    setLoadingShares(true);
    setSelectedUserId(userId);

    // 1. Fetch leagues
    const leaguesRes = await fetch(
      `https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${CURRENT_YEAR}`
    );
    const leagues = await leaguesRes.json();

    // 2. Fetch rosters for each league
    const rosterResults = await Promise.all(
      leagues.map(async (league: any) => {
        const res = await fetch(
          `https://api.sleeper.app/v1/league/${league.league_id}/rosters`
        );
        const rosters = await res.json();

        return rosters.find((r: any) => r.owner_id === userId);
      })
    );

    const validRosters = rosterResults.filter(Boolean);
    const leagueCount = validRosters.length;

    // 3. Build player count map
    const map: any = {};

    validRosters.forEach((r: any) => {
      r.players?.forEach((id: string) => {
        if (!map[id]) map[id] = 0;
        map[id]++;
      });
    });

    // 4. Sort + take top 15
    const topPlayers = Object.entries(map)
  .sort((a: any, b: any) => b[1] - a[1])
  .slice(0, 15)
  .map(([playerId, count]: any) => ({
    playerId,
    count,
    percent: leagueCount
      ? Math.round((count / leagueCount) * 100)
      : 0,
  }));

// ✅ SAVE TO STATE
setExternalShares({
  players: topPlayers,
  leagueCount,
});

// ✅ SAVE TO CACHE
setUserCache((prev: any) => ({
  ...prev,
  [userId]: {
  players: topPlayers,
  leagueCount,
},
}));
  } catch (err) {
    console.error("Error loading user exposure:", err);
  } finally {
    setLoadingShares(false);
  }
};

const loadDraftScout = async (userId: string) => {
  setDraftScoutUserId(userId);
  setDraftScoutData(null);
  setLoadingDraftScout(true);

  try {
    // 1. All 2026 leagues for this user
    const leaguesRes = await fetch(
      `https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${CURRENT_YEAR}`
    );
    const leagues = await leaguesRes.json();

    // 2. For each league, fetch drafts + picks in parallel
    const results = await Promise.all(
      leagues.map(async (league: any) => {
        const draftsRes = await fetch(
          `https://api.sleeper.app/v1/league/${league.league_id}/drafts`
        );
        const drafts = await draftsRes.json();

        // Find a rookie-only draft: current year, started, and ≤5 rounds
        // Startup drafts cover full rosters (15–25+ rounds) so this reliably excludes them
        const rookieDraft = drafts.find(
          (d: any) =>
            d.season === CURRENT_YEAR &&
            d.status !== "pre_draft" &&
            (d.settings?.rounds ?? 99) <= 5
        );
        if (!rookieDraft) return null;

        const picksRes = await fetch(
          `https://api.sleeper.app/v1/draft/${rookieDraft.draft_id}/picks`
        );
        const allPicks = await picksRes.json();

        // Only this user's picks
        const myPicks = allPicks
          .filter((p: any) => p.picked_by === userId)
          .sort((a: any, b: any) => a.pick_no - b.pick_no)
          .map((p: any) => ({
            slot: `${p.round}.${String(p.draft_slot).padStart(2, "0")}`,
            round: p.round,
            player: players[p.player_id] || null,
            playerName: p.metadata?.first_name
              ? `${p.metadata.first_name} ${p.metadata.last_name}`
              : null,
            position: p.metadata?.position || null,
          }));

        return { leagueName: league.name, picks: myPicks };
      })
    );

    setDraftScoutData(results.filter(Boolean));
  } catch (err) {
    console.error("Draft scout error:", err);
  } finally {
    setLoadingDraftScout(false);
  }
};

const loadCalcValues = async (leagueId: string) => {
  if (calcValuesLeagueId === leagueId) return; // already loaded for this league
  setLoadingCalcValues(true);
  try {
    const res = await fetch(
      `https://api.fantasycalc.com/values/current?leagueId=${leagueId}&site=sleeper`
    );
    const data = await res.json();
    const vals: Record<string, number> = {};
    data.forEach((entry: any) => {
      const sleeperId = entry.player?.sleeperId;
      if (sleeperId) vals[String(sleeperId)] = entry.value;
    });
    setCalcFcValues(vals);
    setCalcValuesLeagueId(leagueId);
  } catch {
    // fall back to generic player values silently
  } finally {
    setLoadingCalcValues(false);
  }
};

const loadUserTrades = async (targetUserId: string) => {
  setTradeHubUserId(targetUserId);
  setTradeHubData(null);
  setLoadingTradeHub(true);

  try {
    // 1. All 2026 dynasty leagues for this user
    const leaguesRes = await fetch(
      `https://api.sleeper.app/v1/user/${targetUserId}/leagues/nfl/${CURRENT_YEAR}`
    );
    const allLeagues = await leaguesRes.json();

    const dynastyLeagues = allLeagues.filter((l: any) =>
      ((l.settings?.taxi_slots ?? 0) > 0 ||
        (l.roster_positions?.length ?? 0) > 20) &&
      (l.settings?.best_ball ?? 0) === 0
    );

    const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const allTrades: any[] = [];

    // 2. For each league fetch rosters + transactions rounds 1 & 2 + drafts in parallel
    await Promise.all(
      dynastyLeagues.map(async (league: any) => {
        const [rostersData, t1, t2, draftsData] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`)
            .then((r) => r.json()).catch(() => []),
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/1`)
            .then((r) => r.json()).catch(() => []),
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/2`)
            .then((r) => r.json()).catch(() => []),
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`)
            .then((r) => r.json()).catch(() => []),
        ]);

        const myRoster = rostersData.find((r: any) => r.owner_id === targetUserId);
        if (!myRoster) return;

        // Startup drafts have many rounds (15-25); rookie drafts have 4-5
        const startupDraft = (Array.isArray(draftsData) ? draftsData : [])
          .filter((d: any) => (d.settings?.rounds ?? 0) > 6)
          .sort((a: any, b: any) => (b.settings?.rounds ?? 0) - (a.settings?.rounds ?? 0))[0];

        const startupStart: number = startupDraft?.start_time ?? 0;
        // last_picked = timestamp of final pick; fall back to start + 60 days
        const startupEnd: number = startupDraft?.last_picked
          ?? (startupStart ? startupStart + 60 * 24 * 60 * 60 * 1000 : 0);

        const trades = [...(Array.isArray(t1) ? t1 : []), ...(Array.isArray(t2) ? t2 : [])]
          .filter((t: any) =>
            t.type === "trade" &&
            t.status === "complete" &&
            t.created > oneMonthAgo &&
            (t.roster_ids || []).includes(myRoster.roster_id) &&
            // Exclude trades made during the startup draft window
            !(startupStart > 0 && t.created >= startupStart && t.created <= startupEnd)
          );

        trades.forEach((trade: any) => {
          allTrades.push({
            ...trade,
            leagueName: league.name,
            leagueId: league.league_id,
            myRosterId: myRoster.roster_id,
          });
        });
      })
    );

    allTrades.sort((a: any, b: any) => b.created - a.created);
    setTradeHubData(allTrades.slice(0, 15));
  } catch (err) {
    console.error("Trade hub error:", err);
  } finally {
    setLoadingTradeHub(false);
  }
};

  // -------------------------
  // PLAYER LOGIC
  // -------------------------
  const getPlayerRole = (id: string) => {
    if (roster?.starters?.includes(id)) return "starter";
    if (roster?.taxi?.includes(id)) return "taxi";
    return "bench";
  };

  const rolePriority: any = { starter: 0, bench: 1, taxi: 2 };

  const groupPlayers = () => {
    if (!roster || !players) return {};
    const grouped: any = { QB: [], RB: [], WR: [], TE: [] };

    roster.players?.forEach((id: string) => {
      const p = players[id];
      if (!p) return;

      grouped[p.position]?.push({
        ...p,
        role: getPlayerRole(id),
      });
    });

    Object.keys(grouped).forEach((pos) => {
      grouped[pos].sort(
        (a: any, b: any) =>
          rolePriority[a.role] - rolePriority[b.role]
      );
    });

    return grouped;
  };

  const grouped = useMemo(() => groupPlayers(), [roster, players]);

  const filteredPlayers = grouped[activeTab]
  ?.filter((p: any) =>
    p.full_name?.toLowerCase().includes(search.toLowerCase())
  )
  ?.sort((a: any, b: any) => {
    const roleDiff = rolePriority[a.role] - rolePriority[b.role];
    if (roleDiff !== 0) return roleDiff;
    return (b.value || 0) - (a.value || 0);
  });

const getTeamSummary = () => {
  if (!roster || !players) return null;

  const summary: any = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    TAXI: roster?.taxi?.length || 0,
  };

  roster.players?.forEach((id: string) => {
    const p = players[id];
    if (!p) return;

    if (summary[p.position] !== undefined) {
      summary[p.position]++;
    }
  });

  const pickSummary: any = {
    "2026": 0,
    "2027": 0,
    "2028": 0,
  };

  picks.forEach((p: any) => {
    if (pickSummary[p.season] !== undefined) {
      pickSummary[p.season]++;
    }
  });

  return { summary, pickSummary };
};

  const teamSummary = useMemo(() => getTeamSummary(), [roster, players, picks]);
  // -------------------------
  // UI
  // -------------------------
  const movePlayer = (fromIndex: number, toIndex: number) => {
  const updated = [...rookies];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);
  setRookies(updated);
};
const moveToRank = (fromIndex: number, toRank: number) => {
  const toIndex = Math.max(0, Math.min(rookies.length - 1, toRank - 1));

  const updated = [...rookies];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);

  setRookies(updated);
};
// -------------------------
// MY CURRENT LEAGUE PLAYER SET
// -------------------------
const myPlayerSet = new Set<string>(roster?.players || []);
  return (
    <main className="min-h-screen bg-gray-950 text-white">

      {/* HEADER */}
      <div className="bg-gray-900 border-b border-gray-700 p-4 flex items-center justify-center">
  
  <div className="flex items-center gap-6">

  <h1 className="text-xl font-bold">DynastyZeus</h1>

  {user && (
    <span className="text-sm text-gray-400">
      Sleeper: {user.display_name}
    </span>
  )}

  {user && (
    <button
      onClick={disconnectSleeper}
      className="px-3 py-1 text-sm bg-gray-700 rounded hover:bg-gray-600"
    >
      Disconnect
    </button>
  )}

  {leagues.length > 0 && (
    <select
      value={selectedLeague?.league_id || ""}
      onChange={(e) => {
  const league = leagues.find(
    (l: any) => l.league_id === e.target.value
  );
  if (league) {
    loadRoster(league);
    if (mainTab === "DASHBOARD") setMainTab("LEAGUES");
    localStorage.setItem("selectedLeague", JSON.stringify(league));
  }
}}
      className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm"
    >
      <option value="">Select League</option>
      {leagues.map((l: any) => (
        <option key={l.league_id} value={l.league_id}>
          {l.name}
        </option>
      ))}
    </select>
  )}

</div>
</div>
      {/* NAV */}
      <div className="flex justify-center gap-6 p-4 border-b border-gray-700">
        <button
  onClick={() => setMainTab("DASHBOARD")}
  className={mainTab === "DASHBOARD" ? "text-blue-400" : ""}
>
  Dashboard
</button>
        <button
  onClick={() => user && setMainTab("LEAGUES")}
  className={`${mainTab === "LEAGUES" ? "text-blue-400" : ""} ${
    !user ? "opacity-50 cursor-not-allowed" : ""
  }`}
>
  Leagues & Depth Charts
</button>

        <button
  onClick={() => user && setMainTab("SHARES")}
  className={`${mainTab === "SHARES" ? "text-blue-400" : ""} ${
    !user ? "opacity-50 cursor-not-allowed" : ""
  }`}
>
  Player Ownership & Tools
</button>

        <button
  onClick={() => user && setMainTab("BIGBOARD")}
  className={`${mainTab === "BIGBOARD" ? "text-blue-400" : ""} ${
    !user ? "opacity-50 cursor-not-allowed" : ""
  }`}
>
  Rookie Big Board
</button>
<button
  onClick={() => user && setMainTab("DRAFT")}
  className={`${mainTab === "DRAFT" ? "text-blue-400" : ""} ${
    !user ? "opacity-50 cursor-not-allowed" : ""
  }`}
>
  Live Draft Hub
</button>
<button
  onClick={() => user && setMainTab("TRADE_HUB")}
  className={`${mainTab === "TRADE_HUB" ? "text-blue-400" : ""} ${
    !user ? "opacity-50 cursor-not-allowed" : ""
  }`}
>
  Trade Hub
</button>
      </div>

      <div className={mainTab === "DRAFT" ? "p-6" : "max-w-3xl mx-auto p-6"}>
{mainTab === "DASHBOARD" && (
  <>
    <>
  {!user && (
    <div className="flex gap-2 mb-6">
      <input
        className="p-2 rounded bg-gray-800 w-full"
        placeholder="Enter Sleeper username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <button
        onClick={connectSleeper}
        className="bg-blue-600 px-4 rounded"
      >
        Connect
      </button>
    </div>
  )}

  <Dashboard
    username={user?.display_name || ""}
    leagues={leagues}
    onSelectLeague={loadRoster}
    onNavigate={setMainTab}
  />
</>
  </>
)}
        {/* LEAGUES */}
        {mainTab === "LEAGUES" && (
          <>            
           {user && leagues.length > 0 && !selectedLeague && (
  <div className="max-w-4xl mx-auto">

    <h2 className="text-xl font-semibold mb-4 text-slate-300">
      Your Leagues
    </h2>

    <input
      className="w-full mb-6 px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-500"
      placeholder="Search leagues..."
      value={leagueSearch}
      onChange={(e) => setLeagueSearch(e.target.value)}
    />

    {leagues
      .filter((l: any) =>
        l.name.toLowerCase().includes(leagueSearch.toLowerCase())
      )
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map((l: any) => (
        <div
  key={l.league_id}
  onClick={() => loadRoster(l)}
  className="group bg-slate-900 border border-slate-800 p-4 rounded-xl mb-3 cursor-pointer hover:bg-slate-800 transition flex justify-between items-center"
>
  {/* LEFT */}
  <p className="font-medium">{l.name}</p>

  {/* RIGHT */}
  <span className="text-slate-500 group-hover:text-blue-400 transition">
    →
  </span>
</div>
      ))}
  </div>
)}
            {selectedLeague && roster && (
              <>
                <button
                  onClick={() => setSelectedLeague(null)}
                  className="mb-2 text-sm text-gray-400"
                >
                  ← Back
                </button>

                <div className="mb-4">
                  <h2 className="text-lg font-bold">
                    {selectedLeague.name}
                  </h2>
                  <div className="text-xs text-gray-400">
                    {roster.settings?.team_name || "Your Team"}
                  </div>

                  {/* 🔥 NEW LINEUP SETTINGS DISPLAY */}
                  <div className="text-xs text-blue-400 mt-1">
                    {getLineupSettings(selectedLeague)}
                  </div>
                </div>
                {(() => {
  const rules = getNonStandardRules(selectedLeague?.scoring_settings);
  const grouped = groupRules(rules);

  return Object.entries(grouped).map(([section, items]) => {
    if (items.length === 0) return null;

    return (
      <div key={section} className="mb-2">
  <div className="text-xs font-medium text-gray-400 mb-0.5 uppercase tracking-wide">
  {section}
</div>

  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">  {/* 👈 ADD THIS */}

    {items.map((rule: any, i: number) => (
      <div
        key={i}
        className="flex justify-between items-center bg-yellow-200/10 border border-yellow-500/20 rounded px-2 py-1.5"
      >
        <span className="text-yellow-300 text-xs">
          {formatRule(rule.key)}
        </span>

        <span className="text-green-400 text-xs">
          {rule.value > 0 ? `+${rule.value}` : rule.value}
        </span>
      </div>
    ))}

  </div> {/* 👈 ADD THIS */}

</div>
    );
  });
})()}
{/* 🔥 TEAM SUMMARY */}
{(() => {
  const data = teamSummary;
  if (!data) return null;

  const { summary, pickSummary } = data;

  return (
    <div className="mt-4 flex flex-wrap gap-2 text-xs mb-4">

      {/* POSITION COUNTS */}
      {["QB", "RB", "WR", "TE"].map((pos) => (
  <div
    key={pos}
    className="px-3 py-1 bg-gray-800/60 rounded-full border border-gray-700/50"
  >
    {pos}: {summary[pos]}
  </div>
))}

      {/* PICKS */}
      {Object.keys(pickSummary).map((year) => (
        <div
          key={year}
          className="px-3 py-1 bg-blue-900/40 rounded-full border border-blue-700"
        >
          {year} Picks: {pickSummary[year]}
        </div>
      ))}
    </div>
  );
})()}

<div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-4">

  {/* PLAYER TABS */}
  <div className="flex flex-wrap gap-2 mb-3">
    {["ROSTER", "QB", "RB", "WR", "TE", "PICKS", "FREE AGENTS"].map((pos) => (
      <button
        key={pos}
        onClick={() => setActiveTab(pos)}
        className={`px-3 py-1 rounded ${
          activeTab === pos
            ? "bg-blue-600"
            : "bg-gray-800 hover:bg-gray-700"
        }`}
      >
        {pos}
      </button>
    ))}
  </div>

  {/* SEARCH */}
  <input
    className="w-full p-2.5 rounded bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    placeholder="Search players..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
  />

</div>
                {["QB", "RB", "WR", "TE"].includes(activeTab) && (
  <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">

    <div className="text-sm font-semibold mb-3 text-gray-300">
      {activeTab}
    </div>

    {filteredPlayers?.map((p: any) => {
      const colors: any = {
        starter: "bg-green-800/60",
        bench: "bg-blue-800/40",
        taxi: "bg-purple-800/60",
      };

      return (
        <div
          key={p.player_id}
          className={`flex items-center justify-between px-3 py-1.5 mb-1 rounded text-sm ${colors[p.role]}`}
        >
          {/* LEFT */}
          <div className="flex items-center gap-2 truncate">
            <span className="font-medium">{p.full_name}</span>
            <span className="text-xs text-gray-400">{p.team}</span>
            <span className="text-xs text-gray-500">
              {p.role.toUpperCase()}
            </span>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-3 text-xs whitespace-nowrap">
            <span className="text-gray-400">
              Age {p.age || "—"}
            </span>
            <span className="text-blue-400 font-semibold">
              {p.value || 0}
            </span>
          </div>
        </div>
      );
    })}
  </div>
)}
  {activeTab === "ROSTER" && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
    {["QB", "RB", "WR", "TE"].map((pos) => {
  const taxiIds = new Set(roster?.taxi || []);
  const starterIds = new Set(roster?.starters || []);

  const allPlayers = (roster?.players || []).filter(
    (id: any) => !taxiIds.has(id)
  );

  const starterSlots = getStarterSlots(roster, selectedLeague);

const starters = starterSlots
  .map((s: any) => ({
    ...players[s.playerId],
    slot: s.slot,
  }))
  .filter((p: any) => p && p.position === pos);

  const bench = allPlayers
  .filter((id: any) => !starterIds.has(id))
  .map((id: any) => players[id])
  .filter((p: any) => p && p.position === pos)
  .sort((a: any, b: any) => (b.value || 0) - (a.value || 0));

  const playersByPos = [...starters, ...bench].sort(
    (a: any, b: any) => (b.value || 0) - (a.value || 0)
  );

  const totalVal = playersByPos.reduce(
    (sum: number, p: any) => sum + (p.value || 0),
    0
  );

  return (
    <div
      key={pos}
      className="bg-gray-900 border border-gray-700 rounded-lg p-4"
    >
      {/* HEADER */}
      <div className="flex justify-between mb-3">
        <div className="font-semibold text-sm">
          {pos} {playersByPos.length} TOTAL
        </div>
        <div className="text-xs text-gray-400">
          TOTAL {pos} VAL {totalVal}
        </div>
      </div>

      {/* STARTERS */}
      {starters.map((p: any, i: number) => (
        <div
          key={`s-${i}`}
          className="flex justify-between items-center bg-green-900/30 border border-green-700 rounded p-2 mb-2"
        >
          <div className="flex items-center gap-2">
            <div className="text-xs px-2 py-1 rounded bg-green-700">
              {p.slot.replace("_", " ")}
            </div>
            <div>{p.full_name}</div>
          </div>

          <div className="text-xs text-gray-300">
            VAL {p.value || 0}
          </div>
        </div>
      ))}

      {/* BENCH */}
      {bench.map((p: any, i: number) => (
        <div
          key={`b-${i}`}
          className="flex justify-between items-center bg-blue-900/30 border border-blue-700 rounded p-2 mb-2"
        >
          <div className="flex items-center gap-2">
            <div className="text-xs px-2 py-1 rounded bg-blue-700">
              {pos}{starters.length + i + 1}
            </div>
            <div>{p.full_name}</div>
          </div>

          <div className="text-xs text-gray-300">
            VAL {p.value || 0}
          </div>
        </div>
      ))}
    </div>
  );
})}
    {/* TAXI */}
{(roster?.taxi || []).length > 0 && (
  <div className="mt-6 bg-gray-900 border border-gray-700 rounded-lg p-4">
    <div className="flex justify-between mb-3">
      <div className="font-semibold text-sm text-purple-400">
        TAXI {roster.taxi.length} TOTAL
      </div>
      <div className="text-xs text-gray-400">
        TOTAL TAXI VAL{" "}
        {(roster.taxi || [])
          .map((id: any) => players[id])
          .filter((p: any) => p)
          .reduce((sum: number, p: any) => sum + (p.value || 0), 0)}
      </div>
    </div>

    {(roster.taxi || []).map((id: any, i: number) => {
      const p = players[id];
      if (!p) return null;

      return (
        <div
          key={i}
          className="flex justify-between items-center bg-gray-800 rounded p-2 mb-2"
        >
          <div className="flex items-center gap-2">
            <div className="text-xs px-2 py-1 rounded bg-purple-700">
              TX{i + 1}
            </div>
            <div>{p.full_name}</div>
          </div>

          <div className="text-xs text-gray-400">
            VAL {p.value || 0}
          </div>
        </div>
      );
    })}
  </div>
)}
{/* PICKS */}
<div className="mt-6">
  {["2026", "2027", "2028"].map((year) => {
    const yearPicks = picks
      .filter((p: any) => p.season === year)
      .sort((a: any, b: any) => {
        if (a.round !== b.round) return a.round - b.round;
        return (a.pick_no || 0) - (b.pick_no || 0);
      });

    if (!yearPicks.length) return null;

    return (
      <div
        key={year}
        className="mb-4 bg-gray-900 border border-gray-700 rounded-lg p-4"
      >
        <div className="flex justify-between mb-3">
          <div className="font-semibold text-sm">
            {year} Picks {yearPicks.length} TOTAL
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {yearPicks.map((pick: any, i: number) => {
            const ownerName =
              users[pick.roster_id] ||
              users[pick.owner_id] ||
              "Unknown";

            const label =
              pick.season === CURRENT_YEAR
                ? pick.slot
                : `${pick.round}${
                    ["th", "st", "nd", "rd"][pick.round] || "th"
                  }`;

            return (
              <div
                key={i}
                className={`px-3 py-1 rounded-full text-xs border ${
                  pick.round === 1
                    ? "bg-yellow-900/40 border-yellow-600 text-yellow-300"
                    : pick.round === 2
                    ? "bg-green-900/40 border-green-600 text-green-300"
                    : pick.round === 3
                    ? "bg-blue-900/40 border-blue-600 text-blue-300"
                    : "bg-orange-900/40 border-orange-600 text-orange-300"
                }`}
              >
                {label}
                <span className="ml-1 text-gray-400">
                  via {ownerName}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  })}
</div>
  </div>
)}
{activeTab === "PICKS" && (
  <div className="mt-2">

    {["2026", "2027", "2028"].map((year) => {
      const yearPicks = picks
        .filter((p: any) => p.season === year)
        .sort((a: any, b: any) => {
          if (a.round !== b.round) return a.round - b.round;
          return (a.pick_no || 0) - (b.pick_no || 0);
        });

      if (!yearPicks.length) return null;

      return (
        <div key={year} className="mb-4">
          <div className="text-sm font-bold mb-2">{year}</div>

          <div className="flex flex-wrap gap-2">
  {yearPicks.map((pick: any, i: number) => {
    const ownerName =
      users[pick.roster_id] ||
      users[pick.owner_id] ||
      "Unknown";

    const label =
      pick.season === CURRENT_YEAR
        ? pick.slot
        : `${pick.round}${["th","st","nd","rd"][pick.round] || "th"}`;

    return (
  <div
    key={i}
    className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1 ${
      pick.round === 1
        ? "bg-yellow-900/40 border-yellow-600 text-yellow-300"
        : pick.round === 2
        ? "bg-green-900/40 border-green-600 text-green-300"
        : pick.round === 3
        ? "bg-blue-900/40 border-blue-600 text-blue-300"
        : "bg-orange-900/40 border-orange-600 text-orange-300"
    }`}
  >
    <span className="font-semibold">{label}</span>
    <span className="text-[10px] text-gray-300">
      via {ownerName}
    </span>
  </div>
);
  })}
</div>
        </div>
      );
    })}

  </div>
)}
{activeTab === "FREE AGENTS" && (
  <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
    <div className="text-sm font-semibold mb-3 text-gray-300">
      Top Free Agents (by Value)
    </div>

    {freeAgents.map((p: any, i: number) => (
      <div
        key={p.player_id}
        className="flex justify-between items-center bg-gray-800/70 px-3 py-1.5 rounded-lg mb-1 text-sm"
      >
        <div className="flex items-center gap-2">
          <div className="text-[10px] px-2 py-0.5 rounded bg-gray-700/80">
            {p.position}
          </div>
          <div>{p.full_name}</div>
        </div>

        <div className="text-[11px] text-gray-400">
          VAL {p.value || 0}
        </div>
      </div>
    ))}
  </div>
)}
                {/* STANDINGS */}
                <div className="mt-4 bg-gray-900 border border-gray-700 rounded-xl p-5 shadow-md">
                  <h3 className="text-sm font-semibold text-gray-200 mb-4">
                    Standings
                  </h3>

                  {standings.map((team: any, index: number) => {
                    const isMe = team.roster_id === roster.roster_id;

                    const playoffTeams =
                      selectedLeague?.settings?.playoff_teams ||
                      Math.ceil(rosters.length / 2);

                    const isCutLine = index === playoffTeams - 1;

                    return (
                      <div key={team.roster_id}>
                        <div
                          className={`flex justify-between p-2 rounded mb-1 ${
                            isMe ? "bg-blue-800/40" : "bg-gray-800"
                          }`}
                        >
                          <div className="text-sm">
                            {index + 1}.{" "}
                            <span
  className="cursor-pointer hover:text-blue-400"
  onClick={() => loadUserExposure(team.owner_id)}
>
  {users[team.owner_id] || "Team"}
</span>
                          </div>

                          <div className="text-xs text-gray-400">
                            {team.wins}-{team.losses}
                            {team.ties ? `-${team.ties}` : ""} •{" "}
                            {Math.round(team.fpts)} pts • Max{" "}
                            {Math.round(team.max_pf)}
                          </div>
                        </div>

                        {isCutLine && (
                          <div className="border-t border-yellow-500 my-2 text-center text-xs text-yellow-400">
                            Playoff Cut Line
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* SHARES TAB (UNCHANGED) */}
        {mainTab === "SHARES" && (
          <>
            <input
              className="w-full p-2 mb-4 rounded bg-gray-800"
              placeholder="Search player shares..."
              value={shareSearch}
              onChange={(e) => setShareSearch(e.target.value)}
            />

            <div className="flex gap-2 mb-4">
              {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
                <button
                  key={pos}
                  onClick={() => setSharePosition(pos)}
                  className={`px-3 py-1 rounded ${
                    sharePosition === pos
                      ? "bg-blue-600"
                      : "bg-gray-800"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>

            {Object.entries(shares)
              .filter(([playerId]) => {
                const p = players[playerId];
                if (!p) return false;

                const matchesSearch = p.full_name
                  ?.toLowerCase()
                  .includes(shareSearch.toLowerCase());

                const matchesPosition =
                  sharePosition === "ALL" ||
                  p.position === sharePosition;

                return matchesSearch && matchesPosition;
              })
              .sort((a: any, b: any) => b[1].count - a[1].count)
              .map(([playerId, data]: any) => {
                const p = players[playerId];
                if (!p) return null;

                return (
                  <div
                    key={playerId}
                    className="bg-gray-800 p-3 rounded mb-3"
                  >
                    <div className="font-medium">
                      {p.full_name} ({data.count} shares •{" "}
                      {Math.round(
                        (data.count / totalLeagues) * 100
                      )}
                      %)
                    </div>

                    <div className="text-xs text-gray-400 mt-1">
  Owned or
  <span className="ml-2 text-green-400">
    (Starting)
  </span>
                      {[...data.leagues]
  .sort((a: string, b: string) => {
    const aStarter = data.starters.includes(a);
    const bStarter = data.starters.includes(b);

    // starters first
    if (aStarter && !bStarter) return -1;
    if (!aStarter && bStarter) return 1;

    return 0;
  })
  .map((l: string, i: number) => {
    const isStarter = data.starters.includes(l);

    return (
      <div
        key={i}
        className={`${
          isStarter ? "text-green-400 font-medium" : ""
        }`}
      >
        • {l} {isStarter && "🔥"}
      </div>
    );
  })}
                    </div>
                    
                  </div>
                );
              })}
          </>
        )}
        {mainTab === "BIGBOARD" && (
  <div className="p-4 max-w-3xl mx-auto">

    <div className="text-xl font-bold mb-4">
      Rookie / Dynasty Big Board
    </div>
    <input
  type="text"
  placeholder="Search rookies..."
  value={rookieSearch}
  onChange={(e) => setRookieSearch(e.target.value)}
  className="w-full mb-3 p-2 rounded bg-gray-800 text-sm"
/>

    <div className="space-y-2">
  {rookies
  .map((p, originalIndex) => ({ p, originalIndex }))
  .filter(({ p }) =>
    p.name.toLowerCase().includes(rookieSearch.toLowerCase())
  )
  .map(({ p, originalIndex }) => (
  <div
    key={originalIndex}
    draggable
    onDragStart={() => setDragIndex(originalIndex)}
    onDragOver={(e) => e.preventDefault()}
    onDrop={() => {
      if (dragIndex !== null) {
        movePlayer(dragIndex, originalIndex);
        setDragIndex(null);
      }
    }}
    className="flex items-center justify-between bg-gray-800/70 px-3 py-1.5 mb-1 rounded-lg text-sm cursor-move hover:bg-gray-700/70 transition"
  >
    <div className="flex gap-3 items-center">
      <input
  type="number"
  value={tempRanks[originalIndex] ?? originalIndex + 1}
  onChange={(e) => {
    setTempRanks((prev) => ({
      ...prev,
      [originalIndex]: e.target.value,
    }));
  }}
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      handleRankChange(originalIndex, tempRanks[originalIndex] ?? originalIndex + 1);
      setTempRanks((prev) => {
        const updated = { ...prev };
        delete updated[originalIndex];
        return updated;
      });
    }
  }}
  onBlur={() => {
    if (tempRanks[originalIndex] !== undefined) {
      handleRankChange(originalIndex, tempRanks[originalIndex]);
      setTempRanks((prev) => {
        const updated = { ...prev };
        delete updated[originalIndex];
        return updated;
      });
    }
  }}
  className="w-12 text-center bg-transparent text-gray-400 outline-none"
/>

      <div className="flex items-center gap-2">
        <span className="font-medium">{p.name}</span>
        <span
  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
    p.position === "QB"
      ? "bg-purple-500/20 text-purple-400"
      : p.position === "RB"
      ? "bg-green-500/20 text-green-400"
      : p.position === "WR"
      ? "bg-blue-500/20 text-blue-400"
      : p.position === "TE"
      ? "bg-orange-500/20 text-orange-400"
      : "bg-gray-700 text-gray-400"
  }`}
>
  {p.position}
</span>      
      </div>
    </div>
  </div>
))}
    </div>

  </div>
)}
{mainTab === "DRAFT" && (
  <div className="p-4">
    <div className="text-xl font-bold mb-4">
      Live Draft Hub
    </div>

    {!draftSettings && (
      <div className="text-gray-400">
        No draft data available
      </div>
    )}

    {draftSettings && (
      <div className="overflow-x-auto">

        {/* TEAM HEADER — ordered by actual draft slot */}
        <div className="flex mb-2">
          {Array.from({ length: rosters.length }, (_, i) => i + 1).map((slot) => {
            const userId = Object.keys(draftOrder).find(
              (uid) => draftOrder[uid] === slot
            );
            const teamName = (userId && users[userId]) || `Team ${slot}`;

            return (
              <button
                key={slot}
                onClick={() => userId && loadDraftScout(userId)}
                className="w-36 text-center text-xs text-blue-400 hover:text-blue-300 truncate px-1 cursor-pointer"
                title={`View ${teamName}'s 2026 draft picks`}
              >
                {teamName}
              </button>
            );
          })}
        </div>

        {/* GRID */}
        {/* GRID (NOW MATCHES PILLS) */}
{ROUNDS.map((round) => {
  const roundPicks = Array.from({ length: rosters.length }, (_, i) => {
  const slot = `${round}.${String(i + 1).padStart(2, "0")}`;

  const pick = allPicks.find((p: any) => p.slot === slot);

  return (
    pick || {
      slot,
      owner_id: null,
      roster_id: null,
    }
  );
});
    
  return (
    <div key={round} className="flex mb-2">
      {roundPicks.map((pick, i) => {

        const playerPick = draftPicks.find(
          (dp: any) =>
            dp.round === round &&
            dp.roster_id === pick.owner_id
        );

        const player = playerPick
          ? players[playerPick.player_id]
          : null;

        return (
          <div
            key={i}
            className="w-36 h-16 bg-gray-800 rounded-md flex flex-col justify-center items-center text-xs border border-gray-700 px-1 gap-0.5"
          >
            {player ? (
              <>
                <div className="text-center truncate w-full text-white font-medium">
                  {player.full_name}
                </div>
                <div className="text-gray-400 text-[10px]">
                  {player.position}
                </div>
              </>
            ) : (
              <>
                <div className="text-gray-500 font-semibold">
                  {pick.slot}
                </div>
                <div className="text-blue-400 text-[10px] text-center truncate w-full">
                  {users[pick.owner_id] || ""}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
})}
      </div>
    )}
  </div>
)}

      </div>

{/* ── TRADE HUB TAB ────────────────────────────────────────────────── */}
{mainTab === "TRADE_HUB" && (
  <div className="max-w-4xl mx-auto p-6">

    {/* Sub-tab nav */}
    <div className="flex gap-6 border-b border-gray-700 mb-6">
      <button
        onClick={() => setTradeHubSection("TRADES")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "TRADES"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        League Trade Database
      </button>
      <button
        onClick={() => setTradeHubSection("CALCULATOR")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "CALCULATOR"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Trade Calculator
      </button>
    </div>

    {/* ── League Trade Database ── */}
    {tradeHubSection === "TRADES" && (
      <>
        {!selectedLeague ? (
          <div className="text-gray-400 text-sm">
            Select a league from the dropdown above to view the Trade Hub.
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-xl font-bold">{selectedLeague.name}</h2>
              <p className="text-sm text-gray-400 mt-1">
                Click any manager to see their trades across all dynasty leagues in the past 30 days
              </p>
            </div>
            <div className="space-y-2">
              {rosters.map((r: any) => {
                const name = users[r.owner_id] || `Team ${r.roster_id}`;
                const isMe = r.owner_id === user?.user_id;
                return (
                  <div
                    key={r.roster_id}
                    onClick={() => loadUserTrades(r.owner_id)}
                    className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-800 transition"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">{name}</span>
                      {isMe && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-700 text-white">
                          You
                        </span>
                      )}
                    </div>
                    <span className="text-gray-500 text-xs">View trades →</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </>
    )}

    {/* ── Trade Calculator ── */}
    {tradeHubSection === "CALCULATOR" && (() => {
      const rosterToUser: Record<number, string> = {};
      rosters.forEach((r: any) => { rosterToUser[r.roster_id] = r.owner_id; });

      const myRoster = rosters.find((r: any) => r.owner_id === user?.user_id);
      const opponentRoster = calcOpponentRosterId != null
        ? rosters.find((r: any) => r.roster_id === calcOpponentRosterId)
        : null;

      // League-specific value lookup (falls back to generic if not yet loaded)
      const calcVal = (id: string) =>
        calcFcValues[id] ?? (players as any)[id]?.value ?? 0;

      // Player lists (excluding already-traded items), sorted by league-specific value
      const myAvailPlayers = (myRoster?.players || [] as string[])
        .map((id: string) => (players as any)[id])
        .filter((p: any) => p && ["QB","RB","WR","TE"].includes(p.position))
        .sort((a: any, b: any) => calcVal(b.player_id) - calcVal(a.player_id))
        .filter((p: any) => !calcGive.includes(p.player_id));

      const theirAvailPlayers = (opponentRoster?.players || [] as string[])
        .map((id: string) => (players as any)[id])
        .filter((p: any) => p && ["QB","RB","WR","TE"].includes(p.position))
        .sort((a: any, b: any) => calcVal(b.player_id) - calcVal(a.player_id))
        .filter((p: any) => !calcReceive.includes(p.player_id));

      // Pick lists (excluding already-added picks)
      const pickKey = (p: any) => `${p.season}-${p.round}-${p.roster_id}`;
      const myAvailPicks = (allPicks as any[]).filter(
        (p: any) => p.owner_id === myRoster?.roster_id && !calcGivePicks.includes(pickKey(p))
      );
      const theirAvailPicks = (allPicks as any[]).filter(
        (p: any) => p.owner_id === opponentRoster?.roster_id && !calcReceivePicks.includes(pickKey(p))
      );

      const getPickValue = (key: string) => {
        const parts = key.split("-");
        return pickFcValues[`${parts[0]}-${parts[1]}`] ?? 0;
      };
      const pickLabel = (p: any) => {
        const origOwnerUserId = rosterToUser[p.roster_id];
        const origName = (users as any)[origOwnerUserId] || `Team ${p.roster_id}`;
        const via = p.roster_id !== p.owner_id ? ` (via ${origName})` : "";
        // For current year, slot is "1.04" format; for future years slot is just the round number
        const slotLabel = p.slot && p.slot.includes(".")
          ? `${p.season} ${p.slot}`
          : `${p.season} Rd ${p.round}`;
        return `${slotLabel}${via}`;
      };

      // Trade totals using league-specific values
      const totalGive =
        calcGive.reduce((s: number, id: string) => s + calcVal(id), 0) +
        calcGivePicks.reduce((s: number, k: string) => s + getPickValue(k), 0);
      const totalReceive =
        calcReceive.reduce((s: number, id: string) => s + calcVal(id), 0) +
        calcReceivePicks.reduce((s: number, k: string) => s + getPickValue(k), 0);

      const net = totalReceive - totalGive;
      const verdict = Math.abs(net) <= 300 ? "EVEN" : net > 0 ? "YOU WIN" : "YOU LOSE";
      const verdictColor = verdict === "EVEN" ? "text-yellow-400" : verdict === "YOU WIN" ? "text-green-400" : "text-red-400";

      const filterPlayers = (list: any[], search: string) =>
        search.trim().length >= 1
          ? list.filter((p: any) => p.full_name?.toLowerCase().includes(search.toLowerCase()))
          : list;

      // Asset row component (inline)
      const assetRow = (label: string, value: number, onAdd: () => void) => (
        <button
          key={label}
          onClick={onAdd}
          className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition text-left"
        >
          <span className="text-sm truncate">{label}</span>
          <span className="text-xs text-blue-300 font-mono ml-2 shrink-0">{value > 0 ? value.toLocaleString() : "—"}</span>
        </button>
      );

      // Trade item row (inline)
      const tradeRow = (label: string, value: number, onRemove: () => void) => (
        <div key={label} className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
          <span className="text-sm truncate">{label}</span>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-xs text-blue-300 font-mono">{value > 0 ? value.toLocaleString() : "—"}</span>
            <button onClick={onRemove} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
          </div>
        </div>
      );

      if (!selectedLeague) {
        return <p className="text-gray-400 text-sm">Select a league from the dropdown above to use the Trade Calculator.</p>;
      }

      return (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            Powered by FantasyCalc — values calibrated for <strong className="text-gray-300">{selectedLeague.name}</strong>.
            {loadingCalcValues && <span className="ml-2 text-blue-400">Loading values…</span>}
          </p>

          {/* Opponent picker */}
          <div className="mb-6">
            <label className="text-xs text-gray-400 mb-1 block">Trade with</label>
            <select
              value={calcOpponentRosterId ?? ""}
              onChange={(e) => {
                setCalcOpponentRosterId(e.target.value ? Number(e.target.value) : null);
                setCalcReceive([]);
                setCalcReceivePicks([]);
                setCalcSearchB("");
              }}
              className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-full md:w-64"
            >
              <option value="">Select opponent...</option>
              {rosters
                .filter((r: any) => r.owner_id !== user?.user_id)
                .map((r: any) => (
                  <option key={r.roster_id} value={r.roster_id}>
                    {(users as any)[r.owner_id] || `Team ${r.roster_id}`}
                  </option>
                ))}
            </select>
          </div>

          {/* Two-column asset panels */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Your assets */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                Your Assets — {(users as any)[user?.user_id] || "You"}
              </div>
              <input
                type="text"
                value={calcSearchA}
                onChange={(e) => setCalcSearchA(e.target.value)}
                placeholder="Filter players..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs mb-3 focus:outline-none focus:border-blue-500"
              />
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {filterPlayers(myAvailPlayers, calcSearchA).map((p: any) =>
                  assetRow(`${p.full_name} (${p.position} · ${p.team})`, calcVal(p.player_id),
                    () => setCalcGive((prev) => [...prev, p.player_id]))
                )}
                {myAvailPicks.map((p: any) =>
                  assetRow(pickLabel(p), pickFcValues[`${p.season}-${p.round}`] ?? 0,
                    () => setCalcGivePicks((prev) => [...prev, pickKey(p)]))
                )}
                {myAvailPlayers.length === 0 && myAvailPicks.length === 0 && (
                  <p className="text-xs text-gray-600">No assets available</p>
                )}
              </div>
            </div>

            {/* Their assets */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                {opponentRoster
                  ? `${(users as any)[opponentRoster.owner_id] || "Opponent"}'s Assets`
                  : "Their Assets"}
              </div>
              <input
                type="text"
                value={calcSearchB}
                onChange={(e) => setCalcSearchB(e.target.value)}
                placeholder="Filter players..."
                disabled={!opponentRoster}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs mb-3 focus:outline-none focus:border-blue-500 disabled:opacity-40"
              />
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {!opponentRoster ? (
                  <p className="text-xs text-gray-600">Select an opponent above</p>
                ) : (
                  <>
                    {filterPlayers(theirAvailPlayers, calcSearchB).map((p: any) =>
                      assetRow(`${p.full_name} (${p.position} · ${p.team})`, calcVal(p.player_id),
                        () => setCalcReceive((prev) => [...prev, p.player_id]))
                    )}
                    {theirAvailPicks.map((p: any) =>
                      assetRow(pickLabel(p), pickFcValues[`${p.season}-${p.round}`] ?? 0,
                        () => setCalcReceivePicks((prev) => [...prev, pickKey(p)]))
                    )}
                    {theirAvailPlayers.length === 0 && theirAvailPicks.length === 0 && (
                      <p className="text-xs text-gray-600">No assets available</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Trade summary */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="grid grid-cols-2 gap-6">
              {/* You Give */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-red-400 mb-2">You Give</div>
                <div className="space-y-1 min-h-[48px]">
                  {calcGive.length === 0 && calcGivePicks.length === 0 && (
                    <p className="text-xs text-gray-600">Click assets above to add</p>
                  )}
                  {calcGive.map((id: string) => {
                    const p = (players as any)[id];
                    return tradeRow(
                      `${p?.full_name ?? id} (${p?.position})`,
                      calcVal(id),
                      () => setCalcGive((prev) => prev.filter((x) => x !== id))
                    );
                  })}
                  {calcGivePicks.map((k: string) => {
                    const [season, round, origId] = k.split("-");
                    const origName = (users as any)[rosterToUser[Number(origId)]] || `Team ${origId}`;
                    const label = `${season} Rd ${round}${origId !== String(myRoster?.roster_id) ? ` (via ${origName})` : ""}`;
                    return tradeRow(label, getPickValue(k),
                      () => setCalcGivePicks((prev) => prev.filter((x) => x !== k)));
                  })}
                </div>
                <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-base font-bold text-red-400">{totalGive.toLocaleString()}</span>
                </div>
              </div>

              {/* You Receive */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-green-400 mb-2">You Receive</div>
                <div className="space-y-1 min-h-[48px]">
                  {calcReceive.length === 0 && calcReceivePicks.length === 0 && (
                    <p className="text-xs text-gray-600">Click assets above to add</p>
                  )}
                  {calcReceive.map((id: string) => {
                    const p = (players as any)[id];
                    return tradeRow(
                      `${p?.full_name ?? id} (${p?.position})`,
                      calcVal(id),
                      () => setCalcReceive((prev) => prev.filter((x) => x !== id))
                    );
                  })}
                  {calcReceivePicks.map((k: string) => {
                    const [season, round, origId] = k.split("-");
                    const origName = (users as any)[rosterToUser[Number(origId)]] || `Team ${origId}`;
                    const label = `${season} Rd ${round}${origId !== String(opponentRoster?.roster_id) ? ` (via ${origName})` : ""}`;
                    return tradeRow(label, getPickValue(k),
                      () => setCalcReceivePicks((prev) => prev.filter((x) => x !== k)));
                  })}
                </div>
                <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-base font-bold text-green-400">{totalReceive.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Verdict */}
            {(calcGive.length > 0 || calcGivePicks.length > 0 || calcReceive.length > 0 || calcReceivePicks.length > 0) && (
              <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between">
                <div>
                  <span className={`text-xl font-black ${verdictColor}`}>{verdict}</span>
                  {verdict !== "EVEN" && (
                    <span className="ml-2 text-sm text-gray-400">
                      by {Math.abs(net).toLocaleString()} pts
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setCalcGive([]); setCalcReceive([]); setCalcGivePicks([]); setCalcReceivePicks([]); }}
                  className="text-xs text-gray-600 hover:text-gray-300 transition"
                >
                  Clear trade
                </button>
              </div>
            )}
          </div>

          <p className="text-[10px] text-gray-700 mt-3">
            Pick values shown as averages for that round. Waiver wire adjustment not included — FantasyCalc computes this from proprietary market data.
          </p>
        </div>
      );
    })()}

  </div>
)}

      {selectedUserId && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-gray-900 p-6 rounded w-96">

      <div className="text-lg font-bold mb-4">
        {users[selectedUserId]}'s Top Owned Players
      </div>

      {loadingShares ? (
        <div className="text-sm text-gray-400">
          Loading exposure...
        </div>
      ) : (
        externalShares?.players?.map((entry: any) => {
  const p = players[entry.playerId];
  if (!p) return null;

  const isMine = myPlayerSet.has(entry.playerId);

  return (
  <div
    key={entry.playerId}
    className={`flex items-center justify-between text-sm py-1 px-2 ${
      isMine ? "bg-green-900/30 border border-green-700 rounded" : ""
    }`}
  >
    <div className="truncate">
      {p.full_name}
      {isMine && (
        <span className="ml-2 text-green-400 text-xs">
          🔥
        </span>
      )}
    </div>

    <div className="text-gray-400 text-xs whitespace-nowrap ml-2">
      {entry.count} • {entry.percent}%
    </div>
  </div>
);
})
      )}

      <button
        onClick={() => setSelectedUserId(null)}
        className="mt-4 w-full bg-blue-600 p-2 rounded"
      >
        Close
      </button>
    </div>
  </div>
)}

{/* DRAFT SCOUT MODAL */}
{draftScoutUserId && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-gray-900 p-6 rounded-xl w-[520px] max-h-[80vh] overflow-y-auto">

      <div className="text-lg font-bold mb-1">
        {users[draftScoutUserId]}'s 2026 Rookie Drafts
      </div>
      <div className="text-xs text-gray-500 mb-4">
        All leagues — click a team name in the header to scout them
      </div>

      {loadingDraftScout ? (
        <div className="text-sm text-gray-400">Loading draft history...</div>
      ) : !draftScoutData?.length ? (
        <div className="text-sm text-gray-400">No 2026 drafts started yet.</div>
      ) : (
        draftScoutData.map((league: any, i: number) => (
          <div key={i} className="mb-5">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {league.leagueName}
            </div>

            {league.picks.length === 0 ? (
              <div className="text-xs text-gray-500 italic">No picks made yet</div>
            ) : (
              league.picks.map((pick: any, j: number) => {
                const name = pick.player?.full_name || pick.playerName || "Unknown";
                const pos = pick.player?.position || pick.position || "—";

                return (
                  <div
                    key={j}
                    className="flex items-center justify-between bg-gray-800 rounded px-3 py-1.5 mb-1 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                        pick.round === 1 ? "bg-yellow-900/50 text-yellow-300" :
                        pick.round === 2 ? "bg-green-900/50 text-green-300" :
                        pick.round === 3 ? "bg-blue-900/50 text-blue-300" :
                                          "bg-orange-900/50 text-orange-300"
                      }`}>
                        {pick.slot}
                      </span>
                      <span className="font-medium">{name}</span>
                    </div>
                    <span className="text-xs text-gray-400">{pos}</span>
                  </div>
                );
              })
            )}
          </div>
        ))
      )}

      <button
        onClick={() => { setDraftScoutUserId(null); setDraftScoutData(null); }}
        className="mt-2 w-full bg-blue-600 p-2 rounded text-sm"
      >
        Close
      </button>
    </div>
  </div>
)}

{/* TRADE HUB MODAL */}
{tradeHubUserId && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-gray-900 p-6 rounded-xl w-[560px] max-h-[85vh] overflow-y-auto">

      <div className="text-lg font-bold mb-1">
        {users[tradeHubUserId] || "Manager"}'s Recent Trades
      </div>
      <div className="text-xs text-gray-500 mb-5">
        Past 30 days · All dynasty leagues · Up to 15 trades
      </div>

      {loadingTradeHub ? (
        <div className="text-sm text-gray-400">Loading trades...</div>
      ) : !tradeHubData?.length ? (
        <div className="text-sm text-gray-400">No trades found in the past 30 days.</div>
      ) : (
        tradeHubData.map((trade: any, i: number) => {
          const myRosterId = trade.myRosterId;

          // Players received
          const received = Object.entries(trade.adds || {})
            .filter(([, rid]) => rid === myRosterId)
            .map(([pid]) => players[pid]?.full_name || "Unknown Player");

          // Players given
          const given = Object.entries(trade.adds || {})
            .filter(([, rid]) => rid !== myRosterId)
            .map(([pid]) => players[pid]?.full_name || "Unknown Player");

          // Resolve actual draft slot (e.g. "2026 1.04") from allPicks when available
          const pickLabel = (p: any) => {
            if (String(p.season) === CURRENT_YEAR) {
              const match = (allPicks as any[]).find(
                (ap) =>
                  String(ap.season) === String(p.season) &&
                  Number(ap.round) === Number(p.round) &&
                  Number(ap.roster_id) === Number(p.roster_id)
              );
              if (match?.slot?.includes(".")) return `${p.season} ${match.slot}`;
            }
            return `${p.season} Rd ${p.round}`;
          };

          // Picks received / given
          const picksReceived = (trade.draft_picks || [])
            .filter((p: any) => p.owner_id === myRosterId)
            .map(pickLabel);

          const picksGiven = (trade.draft_picks || [])
            .filter((p: any) => p.previous_owner_id === myRosterId)
            .map(pickLabel);

          const allReceived = [...received, ...picksReceived];
          const allGiven = [...given, ...picksGiven];

          return (
            <div key={i} className="bg-gray-800 rounded-xl p-4 mb-3">

              {/* Header */}
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
                  {trade.leagueName}
                </span>
                <span className="text-xs text-gray-500">
                  {formatRelativeDate(trade.created)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">

                {/* Received */}
                <div>
                  <div className="text-[10px] text-green-400 font-semibold uppercase mb-1">
                    Received
                  </div>
                  {allReceived.length ? allReceived.map((item, j) => (
                    <div key={j} className="text-sm text-white py-0.5">{item}</div>
                  )) : (
                    <div className="text-xs text-gray-500 italic">Nothing</div>
                  )}
                </div>

                {/* Given */}
                <div>
                  <div className="text-[10px] text-red-400 font-semibold uppercase mb-1">
                    Gave
                  </div>
                  {allGiven.length ? allGiven.map((item, j) => (
                    <div key={j} className="text-sm text-white py-0.5">{item}</div>
                  )) : (
                    <div className="text-xs text-gray-500 italic">Nothing</div>
                  )}
                </div>

              </div>
            </div>
          );
        })
      )}

      <button
        onClick={() => { setTradeHubUserId(null); setTradeHubData(null); }}
        className="mt-2 w-full bg-blue-600 p-2 rounded text-sm"
      >
        Close
      </button>
    </div>
  </div>
)}
    </main>
  );
}


