"use client";
import { useState, useEffect } from "react";

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
  const [roster, setRoster] = useState<any>(null);
  const [rosters, setRosters] = useState<any[]>([]);
  const [players, setPlayers] = useState<any>({});
  const [activeTab, setActiveTab] = useState("QB");
  const [search, setSearch] = useState("");

  const [picks, setPicks] = useState<any[]>([]);
  const [users, setUsers] = useState<any>({});
  const [standings, setStandings] = useState<any[]>([]);

  const [mainTab, setMainTab] = useState("LEAGUES");

  const [allLeagueData, setAllLeagueData] = useState<any[]>([]);
  const [shareSearch, setShareSearch] = useState("");
  const [sharePosition, setSharePosition] = useState("ALL");
  const [freeAgents, setFreeAgents] = useState<any[]>([]);
  const [rookies, setRookies] = useState<any[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [rookieSearch, setRookieSearch] = useState("");
  
  

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

  const filteredPlayers = grouped[activeTab]?.filter((p: any) =>
    p.full_name?.toLowerCase().includes(search.toLowerCase())
  );
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
  return (
    <main className="min-h-screen bg-gray-950 text-white">

      {/* HEADER */}
      <div className="bg-gray-900 border-b border-gray-700 p-4 flex items-center justify-between">
  
  {/* LEFT SIDE */}
  <div className="flex items-center gap-4">
    <h1 className="text-xl font-bold">Dynasty Zeus</h1>

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
  </div>

  {/* RIGHT SIDE */}
  <div className="flex items-center gap-3">
    
    {leagues.length > 0 && (
      <select
        value={selectedLeague?.league_id || ""}
        onChange={(e) => {
          const league = leagues.find(
            (l: any) => l.league_id === e.target.value
          );
          if (league) loadRoster(league);
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

    <button
      className="px-3 py-1 text-sm bg-gray-700 rounded hover:bg-gray-600"
      onClick={() => document.body.classList.toggle("light")}
    >
      Light
    </button>

  </div>
</div>
      {/* NAV */}
      <div className="flex gap-4 p-4 border-b border-gray-700">
        <button
          onClick={() => setMainTab("LEAGUES")}
          className={mainTab === "LEAGUES" ? "text-blue-400" : ""}
        >
          Leagues & Depth Charts
        </button>

        <button
          onClick={() => setMainTab("SHARES")}
          className={mainTab === "SHARES" ? "text-blue-400" : ""}
        >
          Player Ownership & Tools
        </button>

        <button
  onClick={() => setMainTab("BIGBOARD")}
  className={mainTab === "BIGBOARD" ? "text-blue-400" : ""}
>
  Rookie Big Board
</button>
      </div>

      <div className="max-w-3xl mx-auto p-6">

        {/* LEAGUES */}
        {mainTab === "LEAGUES" && (
          <>
            {!user && (
              <div className="flex gap-2 mb-6">
                <input
                  className="p-2 rounded bg-gray-800 w-full"
                  placeholder="Sleeper username"
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

            {leagues.length > 0 && !selectedLeague && (
              <div>
                {leagues.map((l) => (
                  <div
                    key={l.league_id}
                    onClick={() => loadRoster(l)}
                    className="bg-gray-800 p-4 rounded mb-3 cursor-pointer"
                  >
                    {l.name}
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
                <div className="text-xs text-yellow-400 mt-2">
  {(() => {
    const r = getLeagueRules(selectedLeague);
    return (
      <>
        {r.teams} Team • Pass TD: {r.passTD} • PPR: {r.ppr}

        {r.tePremium !== 0 && (
          <>
            <br />
            TE Premium: +{r.tePremium}
          </>
        )}
      </>
    );
  })()}
</div>
{/* 🔥 TEAM SUMMARY */}
{(() => {
  const data = getTeamSummary();
  if (!data) return null;

  const { summary, pickSummary } = data;

  return (
    <div className="mt-4 flex flex-wrap gap-2 text-xs">

      {/* POSITION COUNTS */}
      {["QB", "RB", "WR", "TE"].map((pos) => (
  <div
    key={pos}
    className="px-3 py-1 bg-gray-800 rounded-full border border-gray-700"
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
                {/* STANDINGS */}
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">
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
                            {users[team.owner_id] || "Team"}
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

                {/* PLAYER TABS */}
                <div className="flex gap-2 mb-4">
  {["ROSTER", "QB", "RB", "WR", "TE", "PICKS", "FREE AGENTS"].map((pos) => (
  <button
    key={pos}
    onClick={() => setActiveTab(pos)}
    className={`px-3 py-1 rounded ${
      activeTab === pos
        ? "bg-blue-600"
        : "bg-gray-800"
    }`}
  >
    {pos}
  </button>
))}
</div>

                <input
                  className="w-full p-2 mb-4 rounded bg-gray-800"
                  placeholder="Search players..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />

                {activeTab !== "PICKS" &&
  filteredPlayers?.map((p: any) => {
    const colors: any = {
      starter: "bg-green-800/60",
      bench: "bg-blue-800/40",
      taxi: "bg-purple-800/60",
    };

    return (
      <div
        key={p.player_id}
        className={`p-3 rounded mb-2 ${colors[p.role]}`}
      >
        <div className="font-medium">{p.full_name}</div>
        <div className="text-xs text-gray-400">
          {p.team} • {p.role.toUpperCase()}
        </div>
        <div className="text-xs text-gray-500">
          Age {p.age || "—"}
        </div>
      </div>
    );
  })}
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
  <div className="mt-4">
    <div className="text-sm font-semibold mb-2">
      Top Free Agents (by Value)
    </div>

    {freeAgents.map((p: any, i: number) => (
      <div
        key={p.player_id}
        className="flex justify-between items-center bg-gray-800 p-2 rounded mb-2"
      >
        <div className="flex items-center gap-2">
          <div className="text-xs px-2 py-1 rounded bg-gray-700">
            {p.position}
          </div>
          <div>{p.full_name}</div>
        </div>

        <div className="text-xs text-gray-400">
          VAL {p.value || 0}
        </div>
      </div>
    ))}
  </div>
)}
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
                      Owned in:
                      {data.leagues.map((l: string, i: number) => (
                        <div key={i}>• {l}</div>
                      ))}
                    </div>

                    {data.starters.length > 0 && (
                      <div className="text-xs text-green-400 mt-2">
                        Starting in:
                        {data.starters.map(
                          (l: string, i: number) => (
                            <div key={i}>• {l}</div>
                          )
                        )}
                      </div>
                    )}
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
    className="flex items-center bg-gray-800 px-3 py-2 rounded cursor-move hover:bg-gray-700"
  >
    <div className="flex gap-3 items-center">
      <div className="text-gray-400 w-6">
        {index + 1}
      </div>

      <div className="flex items-center gap-2">
        <span className="font-medium">{p.name}</span>
        <span className="text-xs text-gray-400">{p.position}</span>
        <input
  type="number"
  min={1}
  placeholder="#"
  className="w-14 ml-auto bg-gray-700 text-xs px-2 py-1 rounded"
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      const value = Number((e.target as HTMLInputElement).value);
      if (!isNaN(value)) {
        moveToRank(index, value);
        (e.target as HTMLInputElement).value = "";
      }
    }
  }}
/>
      </div>
    </div>
  </div>
))}
    </div>

  </div>
)}

      </div>
    </main>
  );
}


