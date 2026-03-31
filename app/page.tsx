"use client";
import { useState, useEffect } from "react";
import Dashboard from "../components/Dashboard";

export default function Home() {
  const CURRENT_YEAR = "2026";
  const YEARS = ["2026", "2027", "2028"];
  const ROUNDS = [1, 2, 3, 4];

  // -------------------------
  // CORE STATE
  // -------------------------
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<any>(null);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<any>(null);
  console.log("FULL LEAGUE OBJECT:", selectedLeague);
console.log("SCORING SETTINGS RAW:", selectedLeague?.scoring_settings);
  const [roster, setRoster] = useState<any>(null);
  const [rosters, setRosters] = useState<any[]>([]);
  const [players, setPlayers] = useState<any>({});
  const [activeTab, setActiveTab] = useState("QB");
  const [search, setSearch] = useState("");

  const [picks, setPicks] = useState<any[]>([]);
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
const handleRankChange = (currentIndex: number, newRank: string) => {
  const rank = parseInt(newRank);

  if (!rank || rank < 1 || rank > rookies.length) return;

  const updated = [...rookies];
  const [moved] = updated.splice(currentIndex, 1);

  updated.splice(rank - 1, 0, moved);

  setRookies(updated);
};
 

  // -------------------------
  // 🔥 NEW: LINEUP SETTINGS
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
      .map((pos) => {
        const label = pos === "SUPER_FLEX" ? "SFLEX" : pos;
        return `${label} ${counts[pos]}`;
      })
      .join(" • ");
  };
  const STANDARD_SCORING: any = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  pass_first_down: 0,
  pass_cmp: 0,
  pass_inc: 0,
  pass_attempt: 0,
  pass_sack: 0,
  pass_sack_yd: 0,
  pass_pick_six: 0,
  bonus_pass_yd_40: 0,
  bonus_pass_td_40: 0,
  bonus_pass_td_50: 0,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 0,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  rush_2pt: 2,
  pass_2pt: 2,
};
const getNonStandardRules = (scoring: any) => {
  console.log("SCORING SETTINGS:", scoring);
  const changes: any[] = [];

  Object.keys(scoring || {}).forEach((key) => {
    const value = scoring[key];
    const standard = STANDARD_SCORING[key];

    if (value === 0 || value === null) return;

    if (standard === undefined || value !== standard) {
      changes.push({ key, value });
    }
  });

  return changes;
};
const formatRule = (key: string) => {
  const labels: Record<string, string> = {
    // PASSING
    pass_int: "Interceptions Thrown",
    pass_td_40p: "40+ Yard TD Pass",
    pass_td_50p: "50+ Yard TD Pass",
    pass_int_td: "Pick Six Thrown",
    pass_att: "Pass Attempts",
    pass_sack: "Times Sacked",
    pass_cmp: "Completions",
    pass_cmp_40p: "40+ Yard Completion",
    pass_fd: "Passing First Downs",
    pass_inc: "Incompletions",

    // RUSHING
    rush_td_50p: "50+ Yard TD Run",
    rush_td_40p: "40+ Yard TD Run",
    rush_fd: "Rushing First Downs",
    rush_att: "Rush Attempts",
    rush_40p: "40+ Yard Rush",

    // RECEIVING
    rec: "PPR",
    rec_fd: "Receiving First Downs",

    rec_0_4: "0–4 Yard Catch",
    rec_5_9: "5–9 Yard Catch",
    rec_10_19: "10–19 Yard Catch",
    rec_20_29: "20–29 Yard Catch",
    rec_30_39: "30–39 Yard Catch",
    rec_40p: "40+ Yard Catch",

    rec_td_40p: "40+ Yard TD Catch",
    rec_td_50p: "50+ Yard TD Catch",

    // POSITION BONUSES
    bonus_rec_rb: "RB Premium",
    bonus_rec_wr: "WR Premium",
    bonus_rec_te: "TE Premium",
  };

  return (
    labels[key] ||
    key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase())
  );
};
const groupRules = (rules: any[]) => {
  return {
    Passing: rules.filter(r =>
  r.key.startsWith("pass") ||
  r.key === "pass_int_td" ||   // ✅ PICK 6 FIX
  r.key === "pass_cmp" ||
  r.key === "pass_attempt" ||
  r.key === "pass_sack"
),

    Rushing: rules.filter(r =>
      r.key.startsWith("rush")
    ),

    Receiving: rules.filter(r =>
      r.key === "rec" ||
      r.key.startsWith("rec_") ||
      r.key.startsWith("bonus_rec")
    ),
  };
};

const getLeagueRules = (league: any) => {
  const scoring = league?.scoring_settings || {};
  const settings = league?.settings || {};

  const basePpr = scoring?.rec ?? 0;

  const tePremium =
  scoring?.rec_te !== undefined
    ? scoring.rec_te - basePpr
    : scoring?.bonus_rec_te ?? 0;

  return {
    teams: settings?.num_teams || "-",
    passTD: scoring?.pass_td ?? 4,
    ppr: basePpr,
    tePremium,
  };
};
const fetchKTCValues = async () => {
  const res = await fetch("https://docs.google.com/spreadsheets/d/e/2PACX-1vQy9G6AbspFQtUDT4FZmD3iZETUMZ5nCwrWqfa4k2M5HVG-r6WQcFqnm9UN4Oqj7OirHx7-7VnYGRDd/pub?output=csv");
  const text = await res.text();

  const rows = text.split("\n").slice(1); // skip header

  const values: any = {};

  rows.forEach((row) => {
    const cols = row.split(",");

    const sleeperId = cols[1]?.trim(); // Column B
    const value = cols[5]?.trim();     // Column F

    if (sleeperId && value) {
      values[sleeperId] = Number(value);
    }
  });

  return values;
};
// -------------------------
// LOAD PLAYERS
// -------------------------
useEffect(() => {
  const loadPlayers = async () => {
    const res = await fetch("https://api.sleeper.app/v1/players/nfl");
    const data = await res.json();

    const ktcValues = await fetchKTCValues();

    Object.keys(data).forEach((id) => {
      if (ktcValues[id]) {
        data[id].value = ktcValues[id];
      }
    });

    setPlayers(data);
  };

  loadPlayers();
}, []);
useEffect(() => {
  const saved = localStorage.getItem("sleeperUser");

  if (saved) {
    const parsed = JSON.parse(saved);
    setUser(parsed);

    fetch(
      `https://api.sleeper.app/v1/user/${parsed.user_id}/leagues/nfl/${CURRENT_YEAR}`
    )
      .then((res) => res.json())
      .then((data) => setLeagues(data));
  }
}, []);
useEffect(() => {
  if (rookies.length > 0) {
    localStorage.setItem("rookieBoard", JSON.stringify(rookies));
  }
}, [rookies]);
useEffect(() => {
  fetch("https://docs.google.com/spreadsheets/d/e/2PACX-1vROmAn0k3A92okpYE7UeelIy0vYUMY0NFAGHrI52V68Zm8ff9aruDXB1E6u0hRNr2EHgr54_D7gMBti/pub?gid=637085584&single=true&output=csv")
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

      const saved = localStorage.getItem("rookieBoard");

if (saved) {
  setRookies(JSON.parse(saved));
} else {
  setRookies(data);
}
    });
}, []);
console.log(rookies.slice(0, 5));
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
    setLeagues(leaguesData);
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

  const buildShares = () => {
    const map: any = {};

    allLeagueData.forEach((entry) => {
      const roster = entry.roster;
      if (!roster) return;

      roster.players?.forEach((playerId: string) => {
        if (!map[playerId]) {
          map[playerId] = {
            count: 0,
            leagues: [],
            starters: [],
          };
        }

        map[playerId].count++;
        map[playerId].leagues.push(entry.leagueName);

        if (roster.starters?.includes(playerId)) {
          map[playerId].starters.push(entry.leagueName);
        }
      });
    });

    return map;
  };

  // -------------------------
// LOAD LEAGUE 
// -------------------------
const loadRoster = async (league: any) => {

  // 🔥 SAVE RECENT LEAGUE
  const saveRecentLeague = (league: any) => {
    const stored = localStorage.getItem("recentLeagues");
    let recents = stored ? JSON.parse(stored) : [];

    // remove duplicate
    recents = recents.filter(
      (l: any) => l.league_id !== league.league_id
    );

    // add to front
    recents.unshift({
      league_id: league.league_id,
      name: league.name,
    });

    // keep only 5
    recents = recents.slice(0, 5);

    localStorage.setItem("recentLeagues", JSON.stringify(recents));
  };

  // ✅ CALL IT HERE
  saveRecentLeague(league);

  setSelectedLeague(league);

  const res = await fetch(
    `https://api.sleeper.app/v1/league/${league.league_id}/rosters`
  );
  const allRosters = await res.json();
  setRosters(allRosters);
  // -------------------------
// BUILD ROSTERED PLAYER SET
// -------------------------
const rosteredIds = new Set<string>();

allRosters.forEach((r: any) => {
  (r.players || []).forEach((p: string) => rosteredIds.add(p));
});
// -------------------------
// TOP FREE AGENTS (KTC VALUE)
// -------------------------
const freeAgents = Object.values(players || {})
  .filter((p: any) => p && !rosteredIds.has(String(p.player_id)))
  .sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
  .slice(0, 20);

setFreeAgents(freeAgents);
// 🔥 MAP roster_id → user_id
const rosterToUser: any = {};
allRosters.forEach((r: any) => {
  rosterToUser[r.roster_id] = r.owner_id;
});
  const myRoster = allRosters.find(
    (r: any) => r.owner_id === user.user_id
  );
  setRoster(myRoster);

  // PICKS (unchanged)
  let allPicks: any[] = [];

  YEARS.forEach((year) => {
    allRosters.forEach((r: any) => {
      ROUNDS.forEach((round) => {
        allPicks.push({
          season: year,
          round,
          roster_id: r.roster_id,
          owner_id: r.roster_id,
        });
      });
    });
  });

  const picksRes = await fetch(
    `https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`
  );
  const tradedPicks = await picksRes.json();

  tradedPicks.forEach((tp: any) => {
    const match = allPicks.find(
      (p) =>
        p.season === tp.season &&
        p.round === tp.round &&
        p.roster_id === tp.roster_id
    );

    if (match) match.owner_id = tp.owner_id;
  });

  const myPicks = allPicks.filter(
    (p) => p.owner_id === myRoster.roster_id
  );
  console.log("MY PICKS:", myPicks);
// -------------------------
// FIX SLOT USING DRAFT ORDER
// -------------------------
try {
  const draftsRes = await fetch(
    `https://api.sleeper.app/v1/league/${league.league_id}/drafts`
  );
  const drafts = await draftsRes.json();

  const currentDraft = drafts.find(
    (d: any) => d.season === CURRENT_YEAR
  );
console.log("DRAFT ORDER:", currentDraft?.draft_order);
  const order = currentDraft?.draft_order || {};

myPicks.forEach((pick: any) => {
  // ✅ ONLY use real slots for CURRENT YEAR
  if (pick.season === CURRENT_YEAR) {
    const userId = rosterToUser[pick.roster_id];
    const slot = order[String(userId)];

    if (slot) {
      pick.slot = `${pick.round}.${String(slot).padStart(2, "0")}`;
    } else {
      pick.slot = `${pick.round}.${String(pick.roster_id).padStart(2, "0")}`;
    }
  } else {
    // 🔥 FUTURE YEARS → ROUND ONLY
    pick.slot = `${pick.round}`;
  }
});

} catch (e) {
  console.log("Draft order not available");

  // fallback if API fails
  myPicks.forEach((pick: any) => {
    pick.slot = `${pick.round}.${String(pick.roster_id).padStart(2, "0")}`;
  });
}
  setPicks(
  myPicks.sort((a: any, b: any) => {
    if (a.season !== b.season) return a.season - b.season;
    if (a.round !== b.round) return a.round - b.round;

    const aSlot = parseInt(a.slot?.split(".")[1] || 0);
    const bSlot = parseInt(b.slot?.split(".")[1] || 0);

    return aSlot - bSlot;
  })
);

  // USERS
  const userPromises = allRosters.map((r: any) =>
    fetch(`https://api.sleeper.app/v1/user/${r.owner_id}`).then((res) =>
      res.json()
    )
  );

  const userResults = await Promise.all(userPromises);
  const userMap: any = {};

  allRosters.forEach((r: any, i: number) => {
    const u = userResults[i];
    if (u) {
      userMap[r.roster_id] = u.display_name;
      userMap[r.owner_id] = u.display_name;
    }
  });

  setUsers(userMap);

  // STANDINGS (with Max PF)
  const standingsData = allRosters
    .map((r: any) => ({
      roster_id: r.roster_id,
      wins: r.settings?.wins || 0,
      losses: r.settings?.losses || 0,
      ties: r.settings?.ties || 0,
      fpts: r.settings?.fpts || 0,
      max_pf: r.settings?.fpts_max || 0,
      owner_id: r.owner_id,
    }))
    .sort((a: any, b: any) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.fpts - a.fpts;
    });

  setStandings(standingsData);
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

  const grouped = groupPlayers();

  const filteredPlayers = grouped[activeTab]
  ?.filter((p: any) =>
    p.full_name?.toLowerCase().includes(search.toLowerCase())
  )
  ?.sort((a: any, b: any) => {
  const rolePriority: any = {
    starter: 0,
    bench: 1,
    taxi: 2,
  };

  const roleDiff =
    rolePriority[a.role] - rolePriority[b.role];

  // ✅ First: sort by role
  if (roleDiff !== 0) return roleDiff;

  // ✅ Then: sort by value
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
  // -------------------------
// MY CURRENT LEAGUE PLAYER SET
// -------------------------
const myPlayerSet = new Set<string>(roster?.players || []);

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
    setMainTab("LEAGUES"); // 🔥 ADD THIS
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
      </div>

      <div className="max-w-3xl mx-auto p-6">
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
      value={search}
      onChange={(e) => setSearch(e.target.value)}
    />

    {leagues
      .filter((l: any) =>
        l.name.toLowerCase().includes(search.toLowerCase())
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
  const data = getTeamSummary();
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

            {Object.entries(buildShares())
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
  .filter((p) =>
    p.name.toLowerCase().includes(rookieSearch.toLowerCase())
  )
  .map((p, index) => (
  <div
    key={index}
    draggable
    onDragStart={() => setDragIndex(index)}
    onDragOver={(e) => e.preventDefault()}
    onDrop={() => {
      if (dragIndex !== null) {
        movePlayer(dragIndex, index);
        setDragIndex(null);
      }
    }}
    className="flex items-center justify-between bg-gray-800/70 px-3 py-1.5 mb-1 rounded-lg text-sm cursor-move hover:bg-gray-700/70 transition"
  >
    <div className="flex gap-3 items-center">
      <input
  type="number"
  value={index + 1}
  onChange={(e) => handleRankChange(index, e.target.value)}
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

      </div>
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
    </main>
  );
}


