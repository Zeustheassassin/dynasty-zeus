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
const ROOKIE_BOARD_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const ROOKIE_BOARD_RESET_KEY = `rookieBoardReset_${ROOKIE_YEAR}_sleeper_v2`;
const ROOKIE_BOARD_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vROmAn0k3A92okpYE7UeelIy0vYUMY0NFAGHrI52V68Zm8ff9aruDXB1E6u0hRNr2EHgr54_D7gMBti/pub?output=csv";
const ROOKIE_BOARD_ADP_URL = `https://api.sleeper.app/projections/nfl/${ROOKIE_YEAR}?season_type=regular&position=QB&position=RB&position=WR&position=TE&order_by=adp_dynasty_2qb`;

// -------------------------
// PROJECTION SOURCES
// Tier 1 (higher weight) = broader consensus aggregates.
// Tier 2 = respected single-source projections.
// Add new sources here; weights redistribute automatically when a source fails.
// -------------------------
// Scoring: PPR + 0.5 TE premium (TEs earn an extra 0.5 pts per reception).
// FantasyPros fetched with scoring=PPR; Sleeper and numberFire both apply the
// TE premium via their rec stat so it's exact. Weights are tiered:
//   Tier 1 — consensus aggregates (most analysts behind them)
//   Tier 2 — respected independent models
// Weights redistribute automatically when a source fails to load.
const PROJ_SOURCES = [
  { id: 'fantasypros' as const, label: 'FantasyPros',       tier: 1, weight: 0.45 },
  { id: 'numberfire'  as const, label: 'numberFire',         tier: 1, weight: 0.35 },
  { id: 'sleeper'     as const, label: 'RotoWire/Sleeper',   tier: 2, weight: 0.20 },
];
type ProjSourceId = typeof PROJ_SOURCES[number]['id'];

// Strips punctuation, spaces, and common suffixes so names from different sources
// collapse to the same key and can be matched against Sleeper player IDs.
const normalizeProjName = (n: string) =>
  n.toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, '')
    .replace(/[^a-z]/g, '');

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

const getPickValueKey = (pick: any) => {
  if (pick?.season === CURRENT_YEAR && pick?.slot && String(pick.slot).includes(".")) {
    return `${pick.season}-${pick.slot}`;
  }
  return `${pick?.season}-${pick?.round}`;
};

const getStoredPickValue = (pickValues: Record<string, number>, pick: any) =>
  pickValues[getPickValueKey(pick)] ?? pickValues[`${pick?.season}-${pick?.round}`] ?? 0;

const getLeagueDirectionBucket = (dynRank: number, redRank: number) => {
  if (dynRank <= 2 && redRank <= 2) {
    return { bucket: "Elite", bucketColor: "text-yellow-300 bg-yellow-900/40 border-yellow-600" };
  }
  if (dynRank <= 4 && redRank <= 4) {
    return { bucket: "True Contender", bucketColor: "text-green-300 bg-green-900/40 border-green-600" };
  }
  if (dynRank <= 4 && redRank >= 5 && redRank <= 8) {
    return { bucket: "Almost There", bucketColor: "text-cyan-300 bg-cyan-900/40 border-cyan-600" };
  }
  if (dynRank <= 4 && redRank >= 9) {
    return { bucket: "Rebuilder", bucketColor: "text-indigo-300 bg-indigo-900/40 border-indigo-600" };
  }
  if (dynRank >= 5 && dynRank <= 12 && redRank <= 4) {
    return { bucket: "Fading Contender", bucketColor: "text-blue-300 bg-blue-900/40 border-blue-600" };
  }
  if (dynRank >= 5 && dynRank <= 12 && redRank >= 5 && redRank <= 8) {
    return { bucket: "Purgatory", bucketColor: "text-orange-300 bg-orange-900/40 border-orange-600" };
  }
  if (dynRank >= 5 && dynRank <= 8 && redRank >= 9) {
    return { bucket: "Blow Up", bucketColor: "text-rose-300 bg-rose-900/40 border-rose-600" };
  }
  if (dynRank >= 9 && redRank >= 9) {
    return { bucket: "Hopeless", bucketColor: "text-red-300 bg-red-900/40 border-red-600" };
  }
  return { bucket: "Mixed Identity", bucketColor: "text-gray-300 bg-gray-800 border-gray-600" };
};

const fetchFantasyCalcValues = async (): Promise<{ playerValues: Record<string, number>; pickValues: Record<string, number> }> => {
  const res = await fetch(
    "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1"
  );
  const data = await res.json();
  const playerValues: Record<string, number> = {};
  const slotPickValues: Record<string, number[]> = {};
  const pickBuckets: Record<string, number[]> = {};
  const pickRoundValues: Record<string, number> = {};

  data.forEach((entry: any) => {
    if (entry.player?.position === "PICK") {
      // Specific slot format: "2026 Pick 1.04"
      const slotMatch = entry.player.name?.match(/^(\d{4}) Pick (\d+)\.(\d{1,2})$/);
      if (slotMatch) {
        const roundKey = `${slotMatch[1]}-${slotMatch[2]}`;
        const slotKey = `${slotMatch[1]}-${slotMatch[2]}.${slotMatch[3].padStart(2, "0")}`;
        if (!slotPickValues[slotKey]) slotPickValues[slotKey] = [];
        slotPickValues[slotKey].push(entry.value);
        if (!pickBuckets[roundKey]) pickBuckets[roundKey] = [];
        pickBuckets[roundKey].push(entry.value);
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
  Object.entries(slotPickValues).forEach(([key, vals]) => {
    pickValues[key] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  });
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

const normalizeRookieName = (name: string) =>
  (name || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildSleeperRookieBoard = (_playerMap: any) => [];

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
const [loadingDraftRefresh, setLoadingDraftRefresh] = useState(false);
const [selectedLeagueDraftHasOccurred, setSelectedLeagueDraftHasOccurred] = useState(false);
const [tradeHubUserId, setTradeHubUserId] = useState<string | null>(null);
const [tradeHubData, setTradeHubData] = useState<any[] | null>(null);
const [loadingTradeHub, setLoadingTradeHub] = useState(false);
const [tradeHubSection, setTradeHubSection] = useState<"CALCULATOR" | "FINDER">("CALCULATOR");
const [finderSeed, setFinderSeed] = useState(() => Math.random());
const [finderDraftCapitalMode, setFinderDraftCapitalMode] = useState(false);
const [leagueHubTab, setLeagueHubTab] = useState<"OVERVIEW" | "ROSTERS" | "STANDINGS" | "STARTERS" | "NOTES">("OVERVIEW");
const [leagueOverviewData, setLeagueOverviewData] = useState<Record<string, any>>({});
const [loadingLeagueOverview, setLoadingLeagueOverview] = useState(false);
const [leagueOverviewLoaded, setLeagueOverviewLoaded] = useState(false);
const [leagueNotes, setLeagueNotes] = useState<Record<string, string>>({});
const [nflState, setNflState] = useState<any>(null);
const [dataHubTab, setDataHubTab] = useState<"OWNERSHIP" | "DYNASTY" | "REDRAFT" | "PROJECTIONS">("OWNERSHIP");
const [dynastyRankPos, setDynastyRankPos] = useState("ALL");
const [redraftValues, setRedraftValues] = useState<Record<string, number>>({});
const [loadingRedraft, setLoadingRedraft] = useState(false);
const [redraftLoaded, setRedraftLoaded] = useState(false);
const [redraftRankPos, setRedraftRankPos] = useState("ALL");
const [projectionData, setProjectionData] = useState<any[]>([]);
const [loadingProjections, setLoadingProjections] = useState(false);
const [projectionWeek, setProjectionWeek] = useState(1);
const [projectionSeasonYear, setProjectionSeasonYear] = useState<number | null>(null);
const [projectionPosFilter, setProjectionPosFilter] = useState("ALL");
const [projectionSourceStatus, setProjectionSourceStatus] = useState<Record<string, boolean>>({});
const [projectionLoaded, setProjectionLoaded] = useState(false);
const [finderPlayerSearch, setFinderPlayerSearch] = useState("");
const [finderPinnedPlayerId, setFinderPinnedPlayerId] = useState<string | null>(null);
const [draftHubSection, setDraftHubSection] = useState<"BOARD" | "BIG_BOARD">("BOARD");
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
      const parsedCache = JSON.parse(cached);
      const cacheSample = Object.values(parsedCache).find((player: any) => player && typeof player === "object") as any;
      const hasRookieFields =
        cacheSample &&
        "years_exp" in cacheSample &&
        "search_rank" in cacheSample &&
        "fantasy_positions" in cacheSample;

      if (hasRookieFields) {
        setPlayers(parsedCache);
        // Still load pick values even when players come from cache
        fetchFantasyCalcValues().then(({ pickValues }) => setPickFcValues(pickValues)).catch(() => {});
        return;
      }
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
        years_exp: p.years_exp,
        search_rank: p.search_rank,
        fantasy_positions: p.fantasy_positions,
        active: p.active,
        status: p.status,
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

// Load league-specific FC values whenever the calculator or finder tab is active and a league is selected
useEffect(() => {
  if ((tradeHubSection === "CALCULATOR" || tradeHubSection === "FINDER") && selectedLeague?.league_id) {
    loadCalcValues(selectedLeague.league_id);
  }
}, [tradeHubSection, selectedLeague?.league_id]);

useEffect(() => {
  if (mainTab === "DATA_HUB" && dataHubTab === "DYNASTY" && selectedLeague?.league_id) {
    loadCalcValues(selectedLeague.league_id);
  }
}, [mainTab, dataHubTab, selectedLeague?.league_id]);

useEffect(() => {
  if (mainTab === "DATA_HUB" && dataHubTab === "REDRAFT") {
    loadRedraftValues();
  }
}, [mainTab, dataHubTab]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "OVERVIEW" && !leagueOverviewLoaded) {
    loadLeagueOverview();
    loadNflState();
    loadRedraftValues();
  }
}, [mainTab, leagueHubTab, leagues.length]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "STARTERS") {
    loadNflState();
    if (selectedLeague?.league_id) loadCalcValues(selectedLeague.league_id);
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id]);

// Persist notes to localStorage
useEffect(() => {
  const saved = localStorage.getItem("leagueNotes");
  if (saved) setLeagueNotes(JSON.parse(saved));
}, []);
const saveLeagueNote = (leagueId: string, text: string) => {
  const updated = { ...leagueNotes, [leagueId]: text };
  setLeagueNotes(updated);
  localStorage.setItem("leagueNotes", JSON.stringify(updated));
};

useEffect(() => {
  if (mainTab === "DATA_HUB" && dataHubTab === "PROJECTIONS" && !projectionLoaded) {
    loadProjections(projectionWeek === 0 ? 'season' : projectionWeek);
  }
}, [mainTab, dataHubTab]);

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
  const loadRookieBoard = async () => {
    const [sheetText, adpResponse] = await Promise.all([
      fetch(ROOKIE_BOARD_SHEET_URL).then((res) => res.text()),
      fetch(ROOKIE_BOARD_ADP_URL).then((res) => res.json()),
    ]);

    const sheetPlayers = sheetText
      .split("\n")
      .slice(1)
      .map((row) => {
        const cols = row.split(",");

        return {
          name: cols[0]?.replace(/"/g, "").trim(),
          position: cols[1]?.replace(/"/g, "").trim(),
        };
      })
      .filter((player) => player.name && player.name !== "Player Invalid");

    const adpByName = new Map<string, any>();
    adpResponse
      .filter((entry: any) =>
        entry?.player &&
        entry?.stats &&
        entry.player.first_name !== "Player" &&
        ROOKIE_BOARD_POSITIONS.has(entry.player.position) &&
        typeof entry.stats.adp_dynasty_2qb === "number"
      )
      .forEach((entry: any) => {
        const playerName = `${entry.player.first_name} ${entry.player.last_name}`.trim();
        const normalizedName = normalizeRookieName(playerName);

        if (!normalizedName || adpByName.has(normalizedName)) return;

        adpByName.set(normalizedName, {
          player_id: String(entry.player_id),
          name: playerName,
          position: entry.player.position,
          team: entry.player.team || "",
          adp: entry.stats.adp_dynasty_2qb,
        });
      });

    const canonicalBoard = sheetPlayers
      .map((player) => {
        const adpPlayer = adpByName.get(normalizeRookieName(player.name));

        return {
          player_id: adpPlayer?.player_id || null,
          name: adpPlayer?.name || player.name,
          position: adpPlayer?.position || player.position,
          team: adpPlayer?.team || "",
          adp: typeof adpPlayer?.adp === "number" ? adpPlayer.adp : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => {
        if (a.adp !== b.adp) return a.adp - b.adp;
        return a.name.localeCompare(b.name);
      });

    const canonicalNames = new Set(canonicalBoard.map((player) => normalizeRookieName(player.name)));
    const hasReset = localStorage.getItem(ROOKIE_BOARD_RESET_KEY) === "true";

    if (!hasReset) {
      setRookies(canonicalBoard);
      localStorage.setItem(`rookieBoard_${ROOKIE_YEAR}`, JSON.stringify(canonicalBoard));
      localStorage.setItem(ROOKIE_BOARD_RESET_KEY, "true");
      return;
    }

    const saved = localStorage.getItem(`rookieBoard_${ROOKIE_YEAR}`);

    if (!saved) {
      setRookies(canonicalBoard);
      return;
    }

    const savedData = JSON.parse(saved).filter((player: any) => {
      const normalizedName = normalizeRookieName(player?.name || "");
      return normalizedName && canonicalNames.has(normalizedName);
    });

    const savedByName: any = {};
    savedData.forEach((player: any) => {
      savedByName[normalizeRookieName(player.name)] = player;
    });

    const merged = canonicalBoard.map((player) => {
      const savedPlayer = savedByName[normalizeRookieName(player.name)];
      return savedPlayer ? { ...player, ...savedPlayer, ...player } : player;
    });

    merged.sort((a: any, b: any) => {
      const savedIndexA = savedData.findIndex(
        (player: any) => normalizeRookieName(player?.name || "") === normalizeRookieName(a.name)
      );
      const savedIndexB = savedData.findIndex(
        (player: any) => normalizeRookieName(player?.name || "") === normalizeRookieName(b.name)
      );

      if (savedIndexA === -1 && savedIndexB === -1) {
        return a.adp - b.adp;
      }

      if (savedIndexA === -1) return 1;
      if (savedIndexB === -1) return -1;
      return savedIndexA - savedIndexB;
    });

    localStorage.setItem(`rookieBoard_${ROOKIE_YEAR}`, JSON.stringify(merged));
    setRookies(merged);
  };

  loadRookieBoard().catch(() => {});
  return;
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
  const savedData = JSON.parse(saved || "[]");

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
  return;
  if (Object.keys(players).length === 0) return;

  const sleeperBoard = buildSleeperRookieBoard(players);
  const hasReset = localStorage.getItem(ROOKIE_BOARD_RESET_KEY) === "true";

  if (!hasReset) {
    setRookies(sleeperBoard);
    localStorage.setItem(`rookieBoard_${ROOKIE_YEAR}`, JSON.stringify(sleeperBoard));
    localStorage.setItem(ROOKIE_BOARD_RESET_KEY, "true");
    return;
  }

  const saved = localStorage.getItem(`rookieBoard_${ROOKIE_YEAR}`);

  if (!saved) {
    setRookies(sleeperBoard);
    return;
  }

  const savedData = JSON.parse(saved || "[]");
  const savedById: any = {};
  const savedByName: any = {};

  savedData.forEach((player: any) => {
    if (player?.name === "Player Invalid") return;
    if (player?.player_id) {
      savedById[String(player.player_id)] = player;
    }
    if (player?.name) {
      savedByName[player.name] = player;
    }
  });

  const merged = sleeperBoard.map((player: any) => {
    const savedPlayer = savedById[player.player_id] || savedByName[player.name];
    return savedPlayer ? { ...player, ...savedPlayer, ...player } : player;
  });

  merged.sort((a: any, b: any) => {
    const savedIndexA = savedData.findIndex((player: any) =>
      String(player?.player_id || "") === a.player_id || player?.name === a.name
    );
    const savedIndexB = savedData.findIndex((player: any) =>
      String(player?.player_id || "") === b.player_id || player?.name === b.name
    );

    if (savedIndexA === -1 && savedIndexB === -1) {
      const rankA = typeof a.search_rank === "number" ? a.search_rank : Number.MAX_SAFE_INTEGER;
      const rankB = typeof b.search_rank === "number" ? b.search_rank : Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    }

    if (savedIndexA === -1) return 1;
    if (savedIndexB === -1) return -1;
    return savedIndexA - savedIndexB;
  });

  localStorage.setItem(`rookieBoard_${ROOKIE_YEAR}`, JSON.stringify(merged));
  setRookies(merged);
}, [players]);
const refreshDraftBoard = async () => {
  if (!selectedLeague) return;
  setLoadingDraftRefresh(true);
  try {
    const draftsRes = await fetch(
      `https://api.sleeper.app/v1/league/${selectedLeague.league_id}/drafts`
    );
    const drafts = await draftsRes.json();
    const currentDraft = drafts[0];
    if (!currentDraft) return;
    setDraftId(currentDraft.draft_id);
    setDraftOrder(currentDraft.draft_order || currentDraft.slot_to_roster_id || {});
    setDraftSettings(currentDraft.settings);
    setSelectedLeagueDraftHasOccurred(currentDraft.status !== "pre_draft");
    const picksRes = await fetch(
      `https://api.sleeper.app/v1/draft/${currentDraft.draft_id}/picks`
    );
    const picks = await picksRes.json();
    setDraftPicks(picks);
  } catch (err) {
    console.warn("Draft refresh failed");
  } finally {
    setLoadingDraftRefresh(false);
  }
};

useEffect(() => {
  if (!selectedLeague || mainTab !== "DRAFT" || draftHubSection !== "BOARD") return;
  refreshDraftBoard();
}, [selectedLeague, mainTab, draftHubSection]);
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
  setMainTab("DASHBOARD");
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
  setSelectedLeagueDraftHasOccurred(currentDraft?.status !== "pre_draft");

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

const loadNflState = async () => {
  if (nflState) return;
  try {
    const data = await fetch('https://api.sleeper.app/v1/state/nfl').then(r => r.json());
    setNflState(data);
  } catch { /* silently fail */ }
};

const loadLeagueOverview = async () => {
  if (!leagues.length || !user) return;
  setLoadingLeagueOverview(true);
  try {
    // Fetch all rosters, traded picks, and drafts for every league in parallel
    const results = await Promise.all(
      leagues.map(async (league: any) => {
        try {
          const [rostersData, tradedPicksData, draftsData] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then(r => r.json()),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).then(r => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then(r => r.json()).catch(() => []),
          ]);

          const tempPicks: any[] = [];
          const rosterToUser: Record<string, string> = {};
          rostersData.forEach((r: any) => {
            rosterToUser[String(r.roster_id)] = r.owner_id;
            YEARS.forEach((year) => {
              ROUNDS.forEach((round) => {
                tempPicks.push({
                  season: year,
                  round,
                  roster_id: r.roster_id,
                  owner_id: r.roster_id,
                });
              });
            });
          });

          tradedPicksData.forEach((tp: any) => {
            const match = tempPicks.find(
              (p) => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id
            );
            if (match) match.owner_id = tp.owner_id;
          });

          const currentDraft = draftsData.find((d: any) => d.season === CURRENT_YEAR);
          const order = currentDraft?.draft_order || {};
          tempPicks.forEach((pick: any) => {
            if (pick.season === CURRENT_YEAR) {
              const userId = rosterToUser[String(pick.roster_id)];
              const slot = order[String(userId)];
              pick.slot = slot
                ? `${pick.round}.${String(slot).padStart(2, "0")}`
                : `${pick.round}`;
            }
          });

          return { league, rosters: rostersData, picks: tempPicks };
        } catch { return null; }
      })
    );
    const byLeague: Record<string, any> = {};
    results.filter(Boolean).forEach(({ league, rosters: lr, picks }: any) => {
      byLeague[league.league_id] = { league, rosters: lr, picks };
    });
    setLeagueOverviewData(byLeague);
    setLeagueOverviewLoaded(true);
  } finally {
    setLoadingLeagueOverview(false);
  }
};

const loadRedraftValues = async () => {
  if (redraftLoaded) return;
  setLoadingRedraft(true);
  try {
    const res = await fetch(
      `https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2`
    );
    const data = await res.json();
    const vals: Record<string, number> = {};
    data.forEach((entry: any) => {
      const sleeperId = entry.player?.sleeperId;
      if (sleeperId) vals[String(sleeperId)] = entry.value;
    });
    setRedraftValues(vals);
    setRedraftLoaded(true);
  } catch {
    // silently fail
  } finally {
    setLoadingRedraft(false);
  }
};

const loadProjections = async (week: number | 'season') => {
  setLoadingProjections(true);
  const statusMap: Record<string, boolean> = {};
  const currentNflYear = new Date().getFullYear();
  let resolvedProjectionYear = currentNflYear;
  setProjectionSeasonYear(currentNflYear);

  try {
    // ── Build name→sleeperId lookup from the players object ──────────────────
    // Both full name and "F. LastName" variants are indexed so we can match
    // whatever format a source returns.
    const nameIndex = new Map<string, string>(); // normalizedName → sleeperId
    Object.values(players as Record<string, any>).forEach((p: any) => {
      if (!['QB','RB','WR','TE'].includes(p.position)) return;
      const full = normalizeProjName(p.full_name ?? '');
      if (full) nameIndex.set(full, p.player_id);
      // First-initial variant: "jsmith" for "John Smith"
      const parts = (p.full_name ?? '').split(' ');
      if (parts.length >= 2) {
        const short = normalizeProjName(parts[0][0] + parts.slice(1).join(''));
        if (short) nameIndex.set(short, p.player_id);
      }
    });

    // ── Fetch each source ─────────────────────────────────────────────────────
    // sourceRows: sleeperId → { fpts, sources }
    const sourceRows = new Map<string, { totalWeightedFpts: number; totalWeight: number; sources: string[] }>();

    const addRow = (sleeperId: string, fpts: number, sourceId: string, weight: number) => {
      const existing = sourceRows.get(sleeperId) ?? { totalWeightedFpts: 0, totalWeight: 0, sources: [] };
      existing.totalWeightedFpts += fpts * weight;
      existing.totalWeight += weight;
      if (!existing.sources.includes(sourceId)) existing.sources.push(sourceId);
      sourceRows.set(sleeperId, existing);
    };

    // ── Source 1: Sleeper/RotoWire ────────────────────────────────────────────
    // Try the current NFL season year first; fall back one year if no data
    // returned (handles pre-season when next year's projections aren't live yet).
    try {
      const weekParam = week === 'season' ? '' : `/${week}`;
      const posParams = 'position[]=QB&position[]=RB&position[]=WR&position[]=TE';
      const tryYear = async (yr: number) => {
        const url = `https://api.sleeper.app/projections/nfl/${yr}${weekParam}?season_type=regular&${posParams}`;
        const data: any[] = await fetch(url).then(r => r.json());
        // If Sleeper has no projections for this year yet, it returns an empty array
        return Array.isArray(data) && data.length > 0 ? data : null;
      };
      let data = await tryYear(currentNflYear);
      if (!data) {
        data = await tryYear(currentNflYear - 1);
        if (data) resolvedProjectionYear = currentNflYear - 1;
      }
      data ??= [];
      const src = PROJ_SOURCES.find(s => s.id === 'sleeper')!;
      data.forEach((item: any) => {
        const pos: string = item.player?.position ?? '';
        if (!['QB','RB','WR','TE'].includes(pos) || !item.player_id) return;
        // PPR points + 0.5 TE premium (extra half-point per reception for TEs)
        const pprFpts: number = item.stats?.pts_ppr ?? 0;
        const tePremium: number = pos === 'TE' ? (item.stats?.rec ?? 0) * 0.5 : 0;
        const fpts = pprFpts + tePremium;
        if (fpts <= 0) return;
        addRow(String(item.player_id), fpts, src.id, src.weight);
      });
      statusMap['sleeper'] = true;
    } catch {
      statusMap['sleeper'] = false;
    }

    // ── Source 2: FantasyPros (via our server-side proxy route) ──────────────
    try {
      const weekParam = week === 'season' ? 'draft' : String(week);
      const data: Array<{ name: string; position: string; fpts: number }> =
        await fetch(`/api/projections/fantasypros?week=${weekParam}`).then(r => r.json());
      const src = PROJ_SOURCES.find(s => s.id === 'fantasypros')!;
      data.forEach((item) => {
        if (item.fpts <= 0) return;
        const key = normalizeProjName(item.name);
        const sleeperId = nameIndex.get(key);
        if (!sleeperId) return;
        addRow(sleeperId, item.fpts, src.id, src.weight);
      });
      statusMap['fantasypros'] = true;
    } catch {
      statusMap['fantasypros'] = false;
    }

    // ── Source 3: numberFire / FanDuel Research (GraphQL, no auth) ───────────
    // PPR base + 0.5 TE premium already applied server-side in the route.
    try {
      const weekParam = week === 'season' ? '0' : String(week);
      const data: Array<{ name: string; position: string; fpts: number }> =
        await fetch(`/api/projections/numberfire?week=${weekParam}`).then(r => r.json());
      const src = PROJ_SOURCES.find(s => s.id === 'numberfire')!;
      data.forEach((item) => {
        if (item.fpts <= 0) return;
        const key = normalizeProjName(item.name);
        const sleeperId = nameIndex.get(key);
        if (!sleeperId) return;
        addRow(sleeperId, item.fpts, src.id, src.weight);
      });
      statusMap['numberfire'] = true;
    } catch {
      statusMap['numberfire'] = false;
    }

    // ── Build final consensus list ────────────────────────────────────────────
    // Weight is whatever each player's sources contributed. Players only seen by
    // one source still appear but with that source's full contribution.
    const rows: any[] = [];
    sourceRows.forEach((row, sleeperId) => {
      const p = (players as any)[sleeperId];
      if (!p) return;
      const consensusFpts = row.totalWeight > 0
        ? row.totalWeightedFpts / row.totalWeight
        : 0;
      rows.push({
        sleeperId,
        full_name: p.full_name,
        position: p.position,
        team: p.team,
        fpts: Math.round(consensusFpts * 10) / 10,
        sources: row.sources,
      });
    });

    rows.sort((a, b) => b.fpts - a.fpts);
    setProjectionData(rows);
    setProjectionSeasonYear(resolvedProjectionYear);
    setProjectionSourceStatus(statusMap);
    setProjectionLoaded(true);
  } finally {
    setLoadingProjections(false);
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
  const draftedPlayerIds = useMemo(
    () => new Set(draftPicks.map((pick: any) => String(pick.player_id)).filter(Boolean)),
    [draftPicks]
  );
  const topAvailableRookies = useMemo(
    () =>
      rookies
        .map((player, index) => ({
          ...player,
          boardRank: index + 1,
        }))
        .filter((player: any) => !draftedPlayerIds.has(String(player.player_id)))
        .slice(0, 10),
    [rookies, draftedPlayerIds]
  );
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
  League Hub
</button>

        <button
  onClick={() => user && setMainTab("DATA_HUB")}
  className={`${mainTab === "DATA_HUB" ? "text-blue-400" : ""} ${
    !user ? "opacity-50 cursor-not-allowed" : ""
  }`}
>
  Data Hub
</button>

<button
  onClick={() => user && setMainTab("DRAFT")}
  className={`${mainTab === "DRAFT" ? "text-blue-400" : ""} ${
    !user ? "opacity-50 cursor-not-allowed" : ""
  }`}
>
  Draft Hub
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

      <div className={mainTab === "DRAFT" || mainTab === "TRADE_HUB" ? "" : "max-w-3xl mx-auto p-6"}>
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
        {/* LEAGUE HUB */}
        {mainTab === "LEAGUES" && (
          <>
            {/* Sub-tab nav */}
            <div className="flex justify-center border-b border-gray-800 mb-6 overflow-x-auto">
              <div className="flex justify-center gap-6 text-center">
              {(["OVERVIEW","ROSTERS","STANDINGS","STARTERS","NOTES"] as const).map((tab) => (
                <button key={tab} onClick={() => setLeagueHubTab(tab)}
                  className={`pb-2 px-1 text-sm font-semibold whitespace-nowrap transition ${leagueHubTab === tab ? "border-b-2 border-blue-400 text-blue-400" : "text-gray-400 hover:text-white"}`}>
                  {tab === "OVERVIEW" ? "League Overview" : tab === "ROSTERS" ? "Rosters & Rules" : tab === "STANDINGS" ? "Standings" : tab === "STARTERS" ? "Suggested Starters" : "League Notes"}
                </button>
              ))}
              </div>
            </div>

            {/* ── League Overview ── */}
            {leagueHubTab === "OVERVIEW" && (() => {
              if (loadingLeagueOverview) return <p className="text-sm text-blue-400">Loading league data…</p>;
              if (!leagues.length) return <p className="text-sm text-gray-500">No leagues found.</p>;

              const bucketOrder: Record<string, number> = {
                Elite: 0,
                "True Contender": 1,
                "Fading Contender": 2,
                "Almost There": 3,
                Rebuilder: 4,
                Purgatory: 5,
                "Blow Up": 6,
                Hopeless: 7,
                "Mixed Identity": 8,
              };

              // Build per-league dynasty + redraft values for every team
              const leagueRows = leagues.map((league: any) => {
                const entry = leagueOverviewData[league.league_id];
                if (!entry) return null;
                const lr: any[] = entry.rosters;
                const ownedPicks: any[] = entry.picks || [];
                const myRosterId = lr.find((r: any) => r.owner_id === user?.user_id)?.roster_id;

                // Dynasty value per roster
                const rosterDynVal = lr.map((r: any) => ({
                  roster_id: r.roster_id,
                  val:
                    (r.players || []).reduce((s: number, id: string) => {
                      const p = (players as any)[id];
                      return s + (p?.value || 0);
                    }, 0) +
                    ownedPicks
                      .filter((p: any) => p.owner_id === r.roster_id)
                      .reduce((s: number, p: any) => s + getStoredPickValue(pickFcValues, p), 0),
                })).sort((a, b) => b.val - a.val);

                // Redraft value per roster
                const rosterRedVal = lr.map((r: any) => ({
                  roster_id: r.roster_id,
                  val: (r.players || []).reduce((s: number, id: string) => {
                    return s + (redraftValues[id] || 0);
                  }, 0),
                })).sort((a, b) => b.val - a.val);

                // Standings rank from fpts+wins
                const standingsSorted = [...lr].sort((a, b) => {
                  const aw = a.settings?.wins || 0, bw = b.settings?.wins || 0;
                  return bw !== aw ? bw - aw : (b.settings?.fpts || 0) - (a.settings?.fpts || 0);
                });
                const maxPfSorted = [...lr].sort((a, b) => (b.settings?.fpts_max || 0) - (a.settings?.fpts_max || 0));

                const dynRank = rosterDynVal.findIndex(r => r.roster_id === myRosterId) + 1;
                const redRank = rosterRedVal.findIndex(r => r.roster_id === myRosterId) + 1;
                const standRank = standingsSorted.findIndex(r => r.roster_id === myRosterId) + 1;
                const maxPfRank = maxPfSorted.findIndex(r => r.roster_id === myRosterId) + 1;
                const n = lr.length;

                // Bucket logic (ordered — first match wins)
                const { bucket, bucketColor } = getLeagueDirectionBucket(dynRank, redRank);

                return { league, dynRank, redRank, standRank, maxPfRank, n, bucket, bucketColor };
              }).filter(Boolean).sort((a: any, b: any) => {
                const bucketDiff = (bucketOrder[a.bucket] ?? 999) - (bucketOrder[b.bucket] ?? 999);
                if (bucketDiff !== 0) return bucketDiff;
                if (a.dynRank !== b.dynRank) return a.dynRank - b.dynRank;
                if (a.redRank !== b.redRank) return a.redRank - b.redRank;
                return a.league.name.localeCompare(b.league.name);
              });

              return (
                <div className="space-y-2">
                  {loadingLeagueOverview && <p className="text-xs text-blue-400 mb-2">Loading…</p>}
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_140px_60px_60px_60px_60px] gap-2 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                    <span>League</span>
                    <span>Direction</span>
                    <span className="text-center">Dyn</span>
                    <span className="text-center">Rdft</span>
                    <span className="text-center">Stnd</span>
                    <span className="text-center">MaxPF</span>
                  </div>
                  {leagueRows.map((row: any) => (
                    <div key={row.league.league_id} className="grid grid-cols-[1fr_140px_60px_60px_60px_60px] gap-2 items-center bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5">
                      <button className="text-sm text-white font-medium text-left truncate hover:text-blue-400 transition" onClick={() => { loadRoster(row.league); setLeagueHubTab("ROSTERS"); }}>
                        {row.league.name}
                      </button>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border text-center truncate ${row.bucketColor}`}>{row.bucket}</span>
                      <span className="text-xs text-center text-gray-300">{row.dynRank}<span className="text-gray-600">/{row.n}</span></span>
                      <span className="text-xs text-center text-gray-300">{row.redRank}<span className="text-gray-600">/{row.n}</span></span>
                      <span className="text-xs text-center text-gray-300">{row.standRank}<span className="text-gray-600">/{row.n}</span></span>
                      <span className="text-xs text-center text-gray-300">{row.maxPfRank}<span className="text-gray-600">/{row.n}</span></span>
                    </div>
                  ))}
                  {!leagueOverviewLoaded && !loadingLeagueOverview && (
                    <button onClick={() => { loadLeagueOverview(); loadRedraftValues(); }} className="text-xs text-blue-400 hover:text-blue-300 border border-blue-700 rounded-lg px-3 py-1.5 transition">
                      Load Overview
                    </button>
                  )}
                </div>
              );
            })()}

            {/* ── Rosters & Rules ── */}
            {leagueHubTab === "ROSTERS" && (
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
              </>
            )}
            </>
            )}

            {/* ── Standings ── */}
            {leagueHubTab === "STANDINGS" && (
              selectedLeague && roster ? (
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 shadow-md">
                  <h3 className="text-sm font-semibold text-gray-200 mb-1">{selectedLeague.name} — Standings</h3>
                  <p className="text-xs text-gray-500 mb-4">Select a league from Rosters &amp; Rules to view its standings.</p>
                  {standings.map((team: any, index: number) => {
                    const isMe = team.roster_id === roster.roster_id;
                    const playoffTeams = selectedLeague?.settings?.playoff_teams || Math.ceil(rosters.length / 2);
                    const isCutLine = index === playoffTeams - 1;
                    return (
                      <div key={team.roster_id}>
                        <div className={`flex justify-between p-2 rounded mb-1 ${isMe ? "bg-blue-800/40" : "bg-gray-800"}`}>
                          <div className="text-sm">
                            {index + 1}.{" "}
                            <span>{users[team.owner_id] || "Team"}</span>
                          </div>
                          <div className="text-xs text-gray-400">
                            {team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ""} • {Math.round(team.fpts)} pts • Max {Math.round(team.max_pf)}
                          </div>
                        </div>
                        {isCutLine && <div className="border-t border-yellow-500 my-2 text-center text-xs text-yellow-400">Playoff Cut Line</div>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to see its standings.</p>
              )
            )}

            {/* ── Suggested Starters ── */}
            {leagueHubTab === "STARTERS" && (() => {
              if (!selectedLeague || !roster) return (
                <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first.</p>
              );
              const week = nflState?.week;
              const season = nflState?.season;
              const isInSeason = season && week && week >= 1 && week <= 17;

              // Score function: uses projections if in-season, redraft values otherwise
              const playerScore = (id: string) => {
                if (isInSeason) {
                  const proj = projectionData.find((p: any) => p.sleeperId === id);
                  return proj?.fpts ?? 0;
                }
                return redraftValues[id] ?? 0;
              };

              const positions: string[] = selectedLeague.roster_positions?.filter((p: string) => !["BN","IR","TAXI"].includes(p)) ?? [];
              const myPlayerIds: string[] = roster.players ?? [];
              const taxiIds = new Set<string>((roster.taxi ?? []).map((id: any) => String(id)));
              const used = new Set<string>();
              const lineup: Array<{ slot: string; player: any; score: number }> = [];

              // Fill each slot greedily with highest-scoring eligible player
              for (const slot of positions) {
                const eligible = (slot === "FLEX"
                  ? ["RB","WR","TE"]
                  : slot === "SUPER_FLEX"
                  ? ["QB","RB","WR","TE"]
                  : [slot]
                );
                const best = myPlayerIds
                  .filter(id => !used.has(id))
                  .map(id => ({ id, p: (players as any)[id] }))
                  .filter(({ p }) => p && eligible.includes(p.position))
                  .sort((a, b) => playerScore(b.id) - playerScore(a.id))[0];
                if (best) {
                  used.add(best.id);
                  lineup.push({ slot, player: best.p, score: playerScore(best.id) });
                } else {
                  lineup.push({ slot, player: null, score: 0 });
                }
              }

              const benchPlayers = myPlayerIds
                .filter((id) => !used.has(id) && !taxiIds.has(String(id)))
                .map((id) => (players as any)[id])
                .filter((p: any) => p)
                .sort((a: any, b: any) => playerScore(b.player_id) - playerScore(a.player_id));

              const taxiPlayers = myPlayerIds
                .filter((id) => taxiIds.has(String(id)))
                .map((id) => (players as any)[id])
                .filter((p: any) => p)
                .sort((a: any, b: any) => playerScore(b.player_id) - playerScore(a.player_id));

              const posColor: Record<string,string> = { QB:"bg-red-900/50 border-red-700", RB:"bg-green-900/50 border-green-700", WR:"bg-blue-900/50 border-blue-700", TE:"bg-yellow-900/50 border-yellow-700", FLEX:"bg-purple-900/50 border-purple-700", SUPER_FLEX:"bg-pink-900/50 border-pink-700" };

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-gray-500">
                      {isInSeason
                        ? <>Week {week} starters based on <strong className="text-gray-300">consensus projections</strong></>
                        : <>Offseason starters based on <strong className="text-gray-300">redraft rankings</strong></>
                      }
                      {" — "}<span className="text-blue-400">{selectedLeague.name}</span>
                    </p>
                  </div>
                  {lineup.map(({ slot, player, score }, i) => (
                    <div key={i} className={`flex items-center gap-3 border rounded-xl px-3 py-2 ${posColor[slot] ?? "bg-gray-800 border-gray-700"}`}>
                      <span className="text-[10px] font-bold uppercase w-16 shrink-0 text-gray-300">{slot.replace("_"," ")}</span>
                      {player ? (
                        <>
                          <span className="text-sm text-white flex-1 font-medium">{player.full_name}</span>
                          <span className="text-[10px] text-gray-400 shrink-0">{player.team}</span>
                          <span className="text-xs font-mono text-gray-300 shrink-0">{score > 0 ? score.toFixed(1) : "—"}</span>
                        </>
                      ) : (
                        <span className="text-sm text-gray-600 italic">Empty</span>
                      )}
                    </div>
                  ))}
                  <div className="grid gap-3 pt-2 md:grid-cols-2">
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Bench</span>
                        <span className="text-[10px] text-gray-600">{benchPlayers.length}</span>
                      </div>
                      <div className="space-y-1.5">
                        {benchPlayers.length === 0 ? (
                          <p className="text-xs text-gray-600 italic">No bench players</p>
                        ) : (
                          benchPlayers.map((player: any) => {
                            const score = playerScore(player.player_id);
                            return (
                              <div key={player.player_id} className="flex items-center gap-2 rounded-lg bg-gray-800/80 px-3 py-1.5">
                                <span className="text-[10px] font-bold w-7 shrink-0 text-gray-400">{player.position}</span>
                                <span className="text-sm text-white flex-1 truncate">{player.full_name}</span>
                                <span className="text-[10px] text-gray-500 shrink-0">{player.team}</span>
                                <span className="text-xs font-mono text-gray-300 shrink-0">{score > 0 ? score.toFixed(1) : "—"}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Taxi</span>
                        <span className="text-[10px] text-gray-600">{taxiPlayers.length}</span>
                      </div>
                      <div className="space-y-1.5">
                        {taxiPlayers.length === 0 ? (
                          <p className="text-xs text-gray-600 italic">No taxi players</p>
                        ) : (
                          taxiPlayers.map((player: any) => {
                            const score = playerScore(player.player_id);
                            return (
                              <div key={player.player_id} className="flex items-center gap-2 rounded-lg bg-gray-800/80 px-3 py-1.5">
                                <span className="text-[10px] font-bold w-7 shrink-0 text-gray-400">{player.position}</span>
                                <span className="text-sm text-white flex-1 truncate">{player.full_name}</span>
                                <span className="text-[10px] text-gray-500 shrink-0">{player.team}</span>
                                <span className="text-xs font-mono text-gray-300 shrink-0">{score > 0 ? score.toFixed(1) : "—"}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── League Notes ── */}
            {leagueHubTab === "NOTES" && (() => {
              const noteLeague = selectedLeague ?? leagues[0];
              if (!noteLeague) return <p className="text-sm text-gray-500">No leagues found.</p>;
              return (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-semibold text-gray-300">Notes for:</span>
                    <select
                      className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
                      value={noteLeague.league_id}
                      onChange={(e) => {
                        const l = leagues.find((lg: any) => lg.league_id === e.target.value);
                        if (l) setSelectedLeague(l);
                      }}
                    >
                      {leagues.map((lg: any) => <option key={lg.league_id} value={lg.league_id}>{lg.name}</option>)}
                    </select>
                  </div>
                  <textarea
                    className="w-full h-96 bg-gray-900 border border-gray-700 rounded-xl p-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                    placeholder={`Jot down thoughts, trade ideas, waiver targets for ${noteLeague.name}…`}
                    value={leagueNotes[noteLeague.league_id] ?? ""}
                    onChange={(e) => saveLeagueNote(noteLeague.league_id, e.target.value)}
                  />
                  <p className="text-[10px] text-gray-600">Notes auto-save to your browser.</p>
                </div>
              );
            })()}

          </>
        )}

        {/* DATA HUB TAB */}
        {mainTab === "DATA_HUB" && (
          <>
            {/* Sub-tab nav */}
            <div className="flex justify-center border-b border-gray-800 mb-6 overflow-x-auto">
              <div className="flex justify-center gap-6 text-center">
              {(["OWNERSHIP", "DYNASTY", "REDRAFT", "PROJECTIONS"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDataHubTab(tab)}
                  className={`pb-2 px-1 text-sm font-semibold transition ${
                    dataHubTab === tab
                      ? "border-b-2 border-blue-400 text-blue-400"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {tab === "OWNERSHIP" ? "Player Ownership" : tab === "DYNASTY" ? "Dynasty Rankings" : tab === "REDRAFT" ? "Redraft Rankings" : "Player Projections"}
                </button>
              ))}
              </div>
            </div>

            {/* ── Player Ownership ── */}
            {dataHubTab === "OWNERSHIP" && (
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
                      className={`px-3 py-1 rounded ${sharePosition === pos ? "bg-blue-600" : "bg-gray-800"}`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
                {Object.entries(shares)
                  .filter(([playerId]) => {
                    const p = players[playerId];
                    if (!p) return false;
                    const matchesSearch = p.full_name?.toLowerCase().includes(shareSearch.toLowerCase());
                    const matchesPosition = sharePosition === "ALL" || p.position === sharePosition;
                    return matchesSearch && matchesPosition;
                  })
                  .sort((a: any, b: any) => b[1].count - a[1].count)
                  .map(([playerId, data]: any) => {
                    const p = players[playerId];
                    if (!p) return null;
                    return (
                      <div key={playerId} className="bg-gray-800 p-3 rounded mb-3">
                        <div className="font-medium">
                          {p.full_name} ({data.count} shares •{" "}
                          {Math.round((data.count / totalLeagues) * 100)}%)
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          Owned or
                          <span className="ml-2 text-green-400">(Starting)</span>
                          {[...data.leagues]
                            .sort((a: string, b: string) => {
                              const aStarter = data.starters.includes(a);
                              const bStarter = data.starters.includes(b);
                              if (aStarter && !bStarter) return -1;
                              if (!aStarter && bStarter) return 1;
                              return 0;
                            })
                            .map((l: string, i: number) => {
                              const isStarter = data.starters.includes(l);
                              return (
                                <div key={i} className={isStarter ? "text-green-400 font-medium" : ""}>
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

            {/* ── Dynasty Rankings ── */}
            {dataHubTab === "DYNASTY" && (() => {
              const fcVal = (id: string) => calcFcValues[id] ?? (players as any)[id]?.value ?? 0;
              const ranked = Object.values(players as Record<string, any>)
                .filter((p: any) => ["QB", "RB", "WR", "TE"].includes(p.position) && fcVal(p.player_id) > 0)
                .filter((p: any) => dynastyRankPos === "ALL" || p.position === dynastyRankPos)
                .sort((a: any, b: any) => fcVal(b.player_id) - fcVal(a.player_id));

              const posColor: Record<string, string> = {
                QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400",
              };

              return (
                <>
                  {loadingCalcValues && (
                    <p className="text-sm text-blue-400 mb-4">Loading values…</p>
                  )}
                  <div className="flex gap-2 mb-4">
                    {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
                      <button
                        key={pos}
                        onClick={() => setDynastyRankPos(pos)}
                        className={`px-3 py-1 rounded text-sm font-medium transition ${dynastyRankPos === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {ranked.map((p: any, idx: number) => (
                      <div key={p.player_id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                        <span className="text-xs text-gray-500 w-6 text-right shrink-0">{idx + 1}</span>
                        <span className={`text-[10px] font-bold w-7 shrink-0 ${posColor[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                        <span className="text-sm text-white flex-1 truncate">{p.full_name}</span>
                        <span className="text-xs text-gray-400 font-mono shrink-0">{fcVal(p.player_id).toLocaleString()}</span>
                      </div>
                    ))}
                    {ranked.length === 0 && !loadingCalcValues && (
                      <p className="text-gray-400 text-sm">No data yet. Select a league to load values.</p>
                    )}
                  </div>
                </>
              );
            })()}

            {/* ── Redraft Rankings ── */}
            {dataHubTab === "REDRAFT" && (() => {
              const ranked = Object.values(players as Record<string, any>)
                .filter((p: any) => ["QB", "RB", "WR", "TE"].includes(p.position) && (redraftValues[p.player_id] ?? 0) > 0)
                .filter((p: any) => redraftRankPos === "ALL" || p.position === redraftRankPos)
                .sort((a: any, b: any) => (redraftValues[b.player_id] ?? 0) - (redraftValues[a.player_id] ?? 0));

              const posColor: Record<string, string> = {
                QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400",
              };

              return (
                <>
                  {loadingRedraft && <p className="text-sm text-blue-400 mb-4">Loading values…</p>}
                  <div className="flex gap-2 mb-4">
                    {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
                      <button
                        key={pos}
                        onClick={() => setRedraftRankPos(pos)}
                        className={`px-3 py-1 rounded text-sm font-medium transition ${redraftRankPos === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {ranked.map((p: any, idx: number) => (
                      <div key={p.player_id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                        <span className="text-xs text-gray-500 w-6 text-right shrink-0">{idx + 1}</span>
                        <span className={`text-[10px] font-bold w-7 shrink-0 ${posColor[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                        <span className="text-sm text-white flex-1 truncate">{p.full_name}</span>
                        <span className="text-xs text-gray-400 font-mono shrink-0">{(redraftValues[p.player_id] ?? 0).toLocaleString()}</span>
                      </div>
                    ))}
                    {ranked.length === 0 && !loadingRedraft && (
                      <p className="text-gray-400 text-sm">No redraft data available.</p>
                    )}
                  </div>
                </>
              );
            })()}

            {/* ── Player Projections ── */}
            {dataHubTab === "PROJECTIONS" && (() => {
              const posColor: Record<string, string> = {
                QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400",
              };
              const visible = projectionData.filter(
                (p) => projectionPosFilter === "ALL" || p.position === projectionPosFilter
              );

              return (
                <>
                  {/* Controls row */}
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    {/* Week selector */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 shrink-0">View:</span>
                      <select
                        value={projectionWeek}
                        onChange={(e) => {
                          const w = Number(e.target.value);
                          setProjectionWeek(w);
                          setProjectionLoaded(false);
                          setProjectionData([]);
                          loadProjections(w === 0 ? 'season' : w);
                        }}
                        className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
                      >
                        <option value={0}>Full Season</option>
                        {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                          <option key={w} value={w}>Week {w}</option>
                        ))}
                      </select>
                    </div>

                    {projectionSeasonYear && (
                      <span className="rounded-full border border-gray-700 bg-gray-900/70 px-3 py-1 text-[11px] font-medium text-gray-300">
                        {projectionWeek === 0 ? `${projectionSeasonYear} season projections` : `${projectionSeasonYear} projections`}
                      </span>
                    )}

                    {/* Position filter */}
                    <div className="flex gap-2">
                      {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
                        <button
                          key={pos}
                          onClick={() => setProjectionPosFilter(pos)}
                          className={`px-3 py-1 rounded text-sm font-medium transition ${projectionPosFilter === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
                        >
                          {pos}
                        </button>
                      ))}
                    </div>

                    {/* Refresh */}
                    <button
                      onClick={() => { setProjectionLoaded(false); setProjectionData([]); loadProjections(projectionWeek === 0 ? 'season' : projectionWeek); }}
                      className="ml-auto text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-lg px-3 py-1.5 transition"
                    >
                      Refresh
                    </button>
                  </div>

                  {/* Source status pills */}
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {PROJ_SOURCES.map((src) => {
                      const ok = projectionSourceStatus[src.id];
                      const pct = Math.round(src.weight * 100);
                      return (
                        <span
                          key={src.id}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ok === undefined ? "bg-gray-800 text-gray-500" : ok ? "bg-green-900 text-green-300" : "bg-red-900 text-red-400"}`}
                        >
                          {src.label} {ok !== undefined && `(${pct}%)`}{ok === false && " ✕"}
                        </span>
                      );
                    })}
                    {loadingProjections && <span className="text-[10px] text-blue-400">Loading…</span>}
                  </div>

                  {/* List */}
                  {loadingProjections && projectionData.length === 0 ? (
                    <p className="text-sm text-blue-400">Fetching consensus projections…</p>
                  ) : visible.length === 0 ? (
                    <p className="text-sm text-gray-500">No projection data. Hit Refresh or check your connection.</p>
                  ) : (
                    <>
                      {/* Header */}
                      <div className="flex items-center gap-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                        <span className="w-6 text-right shrink-0">#</span>
                        <span className="w-7 shrink-0">Pos</span>
                        <span className="flex-1">Player</span>
                        <span className="w-10 text-right shrink-0">FPTS</span>
                        <span className="w-10 text-right shrink-0 pr-1">Srcs</span>
                      </div>
                      <div className="space-y-1">
                        {visible.map((p, idx) => (
                          <div key={p.sleeperId} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                            <span className="text-xs text-gray-500 w-6 text-right shrink-0">{idx + 1}</span>
                            <span className={`text-[10px] font-bold w-7 shrink-0 ${posColor[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                            <span className="text-sm text-white flex-1 truncate">{p.full_name}</span>
                            {p.team && <span className="text-[10px] text-gray-500 shrink-0">{p.team}</span>}
                            <span className="text-xs text-gray-300 font-mono w-10 text-right shrink-0">{p.fpts.toFixed(1)}</span>
                            <span className="text-[10px] text-gray-600 w-10 text-right shrink-0 pr-1">
                              {p.sources.length}/{PROJ_SOURCES.length}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}
{mainTab === "DRAFT" && (
  <div className="p-4">
    <div className="flex justify-center border-b border-gray-700 mb-6 overflow-x-auto">
      <div className="flex justify-center gap-6 text-center">
      <button
        onClick={() => setDraftHubSection("BOARD")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          draftHubSection === "BOARD"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Live Draft Board
      </button>
      <button
        onClick={() => setDraftHubSection("BIG_BOARD")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          draftHubSection === "BIG_BOARD"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Rookie Big Board
      </button>
      </div>
    </div>

    {draftHubSection === "BOARD" && (
      <div className="flex justify-end mb-3">
        <button
          onClick={refreshDraftBoard}
          disabled={loadingDraftRefresh}
          className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition"
        >
          {loadingDraftRefresh ? "Refreshing…" : "↻ Refresh Board"}
        </button>
      </div>
    )}

    {draftHubSection === "BOARD" && !draftSettings && (
      <div className="text-gray-400">
        No draft data available
      </div>
    )}

    {draftHubSection === "BOARD" && draftSettings && (
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

    {draftHubSection === "BOARD" && (
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Top 10 Available From Your Big Board</h2>
            <p className="text-sm text-gray-400">
              Automatically removes players after they are drafted in this Sleeper draft.
            </p>
          </div>
          <div className="text-xs text-gray-500">
            {topAvailableRookies.length} shown
          </div>
        </div>

        {!rookies.length ? (
          <div className="text-gray-400 text-sm">
            Your rookie board is still loading from Sleeper.
          </div>
        ) : topAvailableRookies.length === 0 ? (
          <div className="text-gray-400 text-sm">
            No ranked rookies are currently available.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {topAvailableRookies.map((player: any) => (
              <div
                key={player.player_id}
                className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-blue-400 font-semibold">
                      #{player.boardRank}
                    </div>
                    <div className="font-medium text-white">
                      {player.name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">
                      {player.team || "FA"}
                    </div>
                    <div className="text-xs text-gray-300">
                      {player.position}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )}

    {draftHubSection === "BIG_BOARD" && (
      <div className="max-w-3xl">
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
              p.name &&
              p.name !== "Player Invalid" &&
              p.name.toLowerCase().includes(rookieSearch.toLowerCase())
            )
            .map(({ p, originalIndex }) => (
              <div
                key={p.player_id || originalIndex}
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
  </div>
)}

      </div>

{/* ── TRADE HUB TAB ────────────────────────────────────────────────── */}
{mainTab === "TRADE_HUB" && (
  <div className="max-w-4xl mx-auto p-6">

    {/* Sub-tab nav */}
    <div className="flex justify-center border-b border-gray-700 mb-6 overflow-x-auto">
      <div className="flex justify-center gap-6 text-center">
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
      <button
        onClick={() => setTradeHubSection("FINDER")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "FINDER"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Trade Finder
      </button>
      </div>
    </div>

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
        const pick = (allPicks as any[]).find((p: any) => pickKey(p) === key);
        if (!pick) return 0;
        return getStoredPickValue(pickFcValues, pick);
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

      // Waiver adjustment — when one side has more assets, the side with fewer gets
      // a waiver credit equal to each extra asset's value × 0.42 (FantasyCalc approximation)
      const giveAssets = [
        ...calcGive.map((id: string) => calcVal(id)),
        ...calcGivePicks.map((k: string) => getPickValue(k)),
      ].sort((a, b) => b - a);
      const receiveAssets = [
        ...calcReceive.map((id: string) => calcVal(id)),
        ...calcReceivePicks.map((k: string) => getPickValue(k)),
      ].sort((a, b) => b - a);
      const assetDiff = giveAssets.length - receiveAssets.length;
      let waiverAdj = 0;
      let waiverAdjSide: "give" | "receive" | null = null;
      // No waiver adjustment if either side is completely empty
      const calcWaiverAdj = (extras: number[]) =>
        extras.reduce((sum, val, i) => {
          const cap = i === 0 ? 550 : 750;
          return sum + Math.min(Math.round(val * 0.42), cap);
        }, 0);
      if (assetDiff > 0 && receiveAssets.length > 0) {
        waiverAdj = calcWaiverAdj(giveAssets.slice(receiveAssets.length));
        waiverAdjSide = "receive";
      } else if (assetDiff < 0 && giveAssets.length > 0) {
        waiverAdj = calcWaiverAdj(receiveAssets.slice(giveAssets.length));
        waiverAdjSide = "give";
      }

      const totalGiveAdj = totalGive + (waiverAdjSide === "give" ? waiverAdj : 0);
      const totalReceiveAdj = totalReceive + (waiverAdjSide === "receive" ? waiverAdj : 0);

      const net = totalReceiveAdj - totalGiveAdj;
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
            <div className="flex flex-col md:flex-row gap-3">
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

          {opponentRoster && (
            <>
              <button
                onClick={() => loadUserExposure(opponentRoster.owner_id)}
                className="bg-gray-800 border border-gray-700 hover:border-blue-500 text-white rounded-xl px-3 py-2 text-sm font-medium transition whitespace-nowrap"
              >
                Most Owned Players
              </button>

              <button
                onClick={() => loadUserTrades(opponentRoster.owner_id)}
                className="bg-gray-800 border border-gray-700 hover:border-blue-500 text-white rounded-xl px-3 py-2 text-sm font-medium transition whitespace-nowrap"
              >
                Recent Trades
              </button>
            </>
          )}
            </div>
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
                {(() => {
                  const items = [
                    ...filterPlayers(myAvailPlayers, calcSearchA).map((p: any) => ({
                      label: `${p.full_name} (${p.position} · ${p.team})`,
                      value: calcVal(p.player_id),
                      onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...myAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: getStoredPickValue(pickFcValues, p),
                      onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })),
                  ].sort((a, b) => b.value - a.value);
                  if (items.length === 0) return <p className="text-xs text-gray-600">No assets available</p>;
                  return items.map((item) => assetRow(item.label, item.value, item.onAdd));
                })()}
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
                placeholder={opponentRoster ? "Filter players..." : "Search any player to find their team..."}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs mb-3 focus:outline-none focus:border-blue-500"
              />
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {!opponentRoster ? (() => {
                  const q = calcSearchB.trim().toLowerCase();
                  if (q.length < 1) return (
                    <p className="text-xs text-gray-600">Search a player name above or select an opponent from the dropdown</p>
                  );
                  const allRosterPlayers = rosters
                    .filter((r: any) => r.owner_id !== user?.user_id)
                    .flatMap((r: any) =>
                      (r.players || []).map((id: string) => {
                        const p = (players as any)[id];
                        return p ? { ...p, _rosterId: r.roster_id } : null;
                      })
                    )
                    .filter((p: any) =>
                      p &&
                      ["QB","RB","WR","TE"].includes(p.position) &&
                      p.full_name?.toLowerCase().includes(q) &&
                      !calcReceive.includes(p.player_id)
                    )
                    .sort((a: any, b: any) => calcVal(b.player_id) - calcVal(a.player_id));
                  if (allRosterPlayers.length === 0) return (
                    <p className="text-xs text-gray-600">No player found — try a different name</p>
                  );
                  return allRosterPlayers.map((p: any) =>
                    assetRow(`${p.full_name} (${p.position} · ${p.team})`, calcVal(p.player_id), () => {
                      setCalcOpponentRosterId(p._rosterId);
                      setCalcReceive((prev) => [...prev, p.player_id]);
                    })
                  );
                })() : (() => {
                    const items = [
                      ...filterPlayers(theirAvailPlayers, calcSearchB).map((p: any) => ({
                        label: `${p.full_name} (${p.position} · ${p.team})`,
                        value: calcVal(p.player_id),
                        onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                      })),
                      ...theirAvailPicks.map((p: any) => ({
                        label: pickLabel(p),
                        value: getStoredPickValue(pickFcValues, p),
                        onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                      })),
                    ].sort((a, b) => b.value - a.value);
                    if (items.length === 0) return <p className="text-xs text-gray-600">No assets available</p>;
                    return items.map((item) => assetRow(item.label, item.value, item.onAdd));
                  })()
                }
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
                    const pick = (allPicks as any[]).find((p: any) => pickKey(p) === k);
                    const label = pick ? pickLabel(pick) : k;
                    return tradeRow(label, getPickValue(k),
                      () => setCalcGivePicks((prev) => prev.filter((x) => x !== k)));
                  })}
                </div>
                {waiverAdjSide === "give" && waiverAdj > 0 && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                    <span className="text-xs text-gray-400 italic">Waiver Adjustment</span>
                    <span className="text-xs text-blue-300 font-mono">+{waiverAdj.toLocaleString()}</span>
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-base font-bold text-red-400">{totalGiveAdj.toLocaleString()}</span>
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
                    const pick = (allPicks as any[]).find((p: any) => pickKey(p) === k);
                    const label = pick ? pickLabel(pick) : k;
                    return tradeRow(label, getPickValue(k),
                      () => setCalcReceivePicks((prev) => prev.filter((x) => x !== k)));
                  })}
                </div>
                {waiverAdjSide === "receive" && waiverAdj > 0 && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                    <span className="text-xs text-gray-400 italic">Waiver Adjustment</span>
                    <span className="text-xs text-blue-300 font-mono">+{waiverAdj.toLocaleString()}</span>
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-base font-bold text-green-400">{totalReceiveAdj.toLocaleString()}</span>
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

          {/* Trade Equalizer */}
          {verdict !== "EVEN" &&
            (calcGive.length + calcGivePicks.length) > 0 &&
            (calcReceive.length + calcReceivePicks.length) > 0 &&
            (() => {
              const gap = Math.abs(net);
              const youWin = net > 0;

              type EqCandidate = {
                label: string; value: number; age?: number;
                position?: string; isPick: boolean; onAdd: () => void;
              };

              const candidates: EqCandidate[] = youWin
                ? [
                    ...myAvailPlayers.map((p: any) => ({
                      label: p.full_name, value: calcVal(p.player_id),
                      age: p.age, position: p.position, isPick: false,
                      onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...myAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: getStoredPickValue(pickFcValues, p),
                      isPick: true,
                      onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })),
                  ]
                : [
                    ...theirAvailPlayers.map((p: any) => ({
                      label: p.full_name, value: calcVal(p.player_id),
                      age: p.age, position: p.position, isPick: false,
                      onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...theirAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: getStoredPickValue(pickFcValues, p),
                      isPick: true,
                      onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })),
                  ];

              const suggestions = candidates
                .filter((c) => c.value > 0)
                .sort((a, b) => Math.abs(a.value - gap) - Math.abs(b.value - gap))
                .slice(0, 5);

              if (suggestions.length === 0) return null;

              return (
                <div className="mt-4 flex justify-center">
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 w-full max-w-md">
                    <h3 className="text-sm font-semibold text-gray-200 mb-3">Players To Equalize Trade</h3>
                    <div className="flex justify-end gap-6 text-[11px] text-gray-500 mb-1 pr-9">
                      <span>Age</span>
                      <span>Value</span>
                    </div>
                    <div className="space-y-1">
                      {suggestions.map((s) => (
                        <div key={s.label} className="flex items-center justify-between px-3 py-2 bg-gray-800 rounded-lg">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-blue-400 truncate">{s.label}</span>
                            <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                              {s.isPick ? "PICK" : s.position}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 ml-3">
                            <span className="text-xs text-gray-400 w-8 text-right">{s.age ?? ""}</span>
                            <span className="text-xs font-mono text-gray-300 w-12 text-right">{s.value.toLocaleString()}</span>
                            <button
                              onClick={s.onAdd}
                              className="w-6 h-6 bg-blue-500 hover:bg-blue-400 rounded-full flex items-center justify-center text-white text-sm font-bold transition shrink-0"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

          <p className="text-[10px] text-gray-700 mt-3">
            Pick values shown as averages for that round. Waiver adjustment approximated at 42% of extra assets' value when sides have unequal player counts.
          </p>
        </div>
      );
    })()}

    {/* ── Trade Finder ── */}
    {tradeHubSection === "FINDER" && (() => {
      if (!selectedLeague) return (
        <p className="text-gray-400 text-sm">Select a league from the dropdown above to use the Trade Finder.</p>
      );

      const calcVal = (id: string) => calcFcValues[id] ?? (players as any)[id]?.value ?? 0;
      const finderPickKey = (p: any) => `${p.season}-${p.round}-${p.roster_id}`;
      const finderPickLabel = (p: any) => {
        const via = p.roster_id !== p.owner_id ? ` (via ${users[p.roster_id] || `Team ${p.roster_id}`})` : "";
        const slotLabel = p.slot && String(p.slot).includes(".")
          ? `${p.season} ${p.slot}`
          : `${p.season} Rd ${p.round}`;
        return `${slotLabel}${via}`;
      };

      // Build roster player list with values
      const rosterPlayers = (roster: any) =>
        (roster?.players || [])
          .map((id: string) => { const p = (players as any)[id]; return p ? { ...p, value: calcVal(id) } : null; })
          .filter((p: any) => p && ["QB","RB","WR","TE"].includes(p.position) && p.value > 0)
          .sort((a: any, b: any) => b.value - a.value);

      // Position totals for a player list
      const posTotals = (plist: any[]) => {
        const t: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
        plist.forEach((p: any) => { t[p.position] = (t[p.position] || 0) + p.value; });
        return t;
      };

      // Waiver adj using same caps as calculator
      const tradeWaiverAdj = (giveVals: number[], receiveVals: number[]) => {
        const diff = giveVals.length - receiveVals.length;
        if (diff === 0) return 0;
        const capAdj = (extras: number[]) =>
          extras.reduce((s, v, i) => s + Math.min(Math.round(v * 0.42), i === 0 ? 550 : 750), 0);
        if (diff > 0) {
          const sg = [...giveVals].sort((a, b) => b - a);
          return capAdj(sg.slice(receiveVals.length));
        } else {
          const sr = [...receiveVals].sort((a, b) => b - a);
          return capAdj(sr.slice(giveVals.length));
        }
      };

      // Check if a trade is value-balanced (within ±400 after waiver adj)
      const isBalanced = (giveVals: number[], receiveVals: number[]) => {
        const gTotal = giveVals.reduce((s, v) => s + v, 0);
        const rTotal = receiveVals.reduce((s, v) => s + v, 0);
        const diff = giveVals.length - receiveVals.length;
        const adjG = gTotal + (diff < 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
        const adjR = rTotal + (diff > 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
        return Math.abs(adjR - adjG) <= 400;
      };

      const myRoster = rosters.find((r: any) => r.owner_id === user?.user_id);
      const myPlayers = rosterPlayers(myRoster);
      const myT = posTotals(myPlayers);
      const rosterDynVal = rosters
        .map((r: any) => ({
          roster_id: r.roster_id,
          val:
            rosterPlayers(r).reduce((s: number, p: any) => s + p.value, 0) +
            (allPicks as any[])
              .filter((p: any) => p.owner_id === r.roster_id)
              .reduce((s: number, p: any) => s + getStoredPickValue(pickFcValues, p), 0),
        }))
        .sort((a, b) => b.val - a.val);
      const rosterRedVal = rosters
        .map((r: any) => ({
          roster_id: r.roster_id,
          val: (r.players || []).reduce((s: number, id: string) => s + (redraftValues[id] || 0), 0),
        }))
        .sort((a, b) => b.val - a.val);
      const dynRank = myRoster ? rosterDynVal.findIndex((r) => r.roster_id === myRoster.roster_id) + 1 : 0;
      const redRank = myRoster ? rosterRedVal.findIndex((r) => r.roster_id === myRoster.roster_id) + 1 : 0;
      const finderDirection = getLeagueDirectionBucket(dynRank, redRank).bucket;
      const draftCapitalMode = finderDraftCapitalMode;
      const priorityDraftYear = String(
        Number(CURRENT_YEAR) + (selectedLeagueDraftHasOccurred ? 1 : 0)
      );
      const orderedDraftYears = [
        ...YEARS.filter((year) => Number(year) >= Number(priorityDraftYear)),
        ...YEARS.filter((year) => Number(year) < Number(priorityDraftYear)),
      ];
      const draftYearPriority = Object.fromEntries(
        orderedDraftYears.map((year, idx) => [year, idx])
      ) as Record<string, number>;
      // When a player is pinned, ensure they're always in the give pool even if outside top 10
      const myTop = finderPinnedPlayerId && !myPlayers.slice(0, 10).some((p: any) => p.player_id === finderPinnedPlayerId)
        ? [...myPlayers.slice(0, 9), myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId)].filter(Boolean)
        : myPlayers.slice(0, 10);

      // League-wide positional totals for every team (used for ranking)
      const allTeamPosTotals = rosters.map((r: any) => posTotals(rosterPlayers(r)));
      const numTeams = rosters.length;

      // Rank user (1 = best) at a given position given their total at that position
      const leagueRank = (pos: string, total: number) => {
        const sorted = allTeamPosTotals.map((t) => t[pos] || 0).sort((a, b) => b - a);
        let rank = 1;
        for (const t of sorted) { if (total >= t) break; rank++; }
        return Math.min(rank, numTeams);
      };

      // Positional fit score using post-trade league rankings.
      // Rewards improving weak positions, penalizes destroying strong ones.
      const posScore = (givePL: any[], receivePL: any[]) => {
        const postT: Record<string, number> = { ...myT };
        givePL.forEach((p: any) => { postT[p.position] = (postT[p.position] || 0) - p.value; });
        receivePL.forEach((p: any) => { postT[p.position] = (postT[p.position] || 0) + p.value; });

        let score = 0;
        for (const pos of ["QB", "RB", "WR", "TE"]) {
          const beforeRank = leagueRank(pos, myT[pos] || 0);
          const afterRank  = leagueRank(pos, postT[pos] || 0);
          const rankDelta  = beforeRank - afterRank; // positive = moved up (improved)

          // Hard cutoff — never let any position group fall below 8th in the league
          if (afterRank > 8) return -Infinity;

          // Scale reward/penalty by rank change; improving a weak spot is worth more
          const wasWeak = beforeRank > Math.floor(numTeams / 2);
          score += rankDelta * (wasWeak && rankDelta > 0 ? 3 : 2);
        }
        return score;
      };

      if (loadingCalcValues) return <p className="text-sm text-blue-400">Loading player values…</p>;

      // ── Player search / pin UI ──
      const searchMatches = finderPlayerSearch.trim().length >= 2
        ? myPlayers.filter((p: any) =>
            p.full_name.toLowerCase().includes(finderPlayerSearch.toLowerCase())
          ).slice(0, 6)
        : [];
      const pinnedPlayer = finderPinnedPlayerId
        ? myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId) ?? null
        : null;

      // QB safety gate — find the top-32 QB value floor across all known players
      const allQBsSorted = Object.values(players as Record<string, any>)
        .filter((p: any) => p.position === "QB")
        .map((p: any) => calcVal(p.player_id))
        .filter((v) => v > 0)
        .sort((a, b) => b - a);
      const top32QBFloor = allQBsSorted[31] ?? 0; // value of the 32nd-best QB

      // How many of my QBs are within top-32 threshold
      const myTop32QBs = myPlayers.filter(
        (p: any) => p.position === "QB" && p.value >= top32QBFloor
      );

      // Returns true if giving these players still leaves ≥3 top-32 QBs on my roster
      const qbSafe = (givePlayers: any[]) => {
        const qbsGiven = givePlayers.filter((p: any) => p.position === "QB" && p.value >= top32QBFloor).length;
        return myTop32QBs.length - qbsGiven >= 3;
      };

      // Returns true if the opponent still has ≥3 top-32 QBs after giving these players away
      const oppQbSafe = (oppPlayersList: any[], givePlayers: any[]) => {
        const oppTop32QBs = oppPlayersList.filter(
          (p: any) => p.position === "QB" && p.value >= top32QBFloor
        );
        const qbsGiven = givePlayers.filter((p: any) => p.position === "QB" && p.value >= top32QBFloor).length;
        return oppTop32QBs.length - qbsGiven >= 3;
      };

      // Any QB/WR/TE the opponent receives must rank within the positional threshold
      // on their roster post-trade. Prevents dumping low-end players on teams that
      // already have better depth at that spot.
      //   QB  → must be top 3  (they need a real starter)
      //   WR  → must be top 5  (starter/flex quality)
      //   TE  → must be top 2  (positional scarcity)
      const POS_RANK_LIMITS: Record<string, number> = { QB: 3, WR: 5, TE: 2 };
      const oppReceiveOk = (oppPlayersList: any[], givePlayers: any[], receivePlayers: any[]) => {
        const outgoingIds = new Set(receivePlayers.map((p: any) => p.player_id));
        for (const pos of ["QB", "WR", "TE"] as const) {
          const limit = POS_RANK_LIMITS[pos];
          const incoming = givePlayers.filter((p: any) => p.position === pos);
          if (incoming.length === 0) continue;
          const oppPosAfter = oppPlayersList
            .filter((p: any) => p.position === pos && !outgoingIds.has(p.player_id))
            .concat(incoming)
            .sort((a: any, b: any) => b.value - a.value);
          const passes = incoming.every((pl: any) => {
            const rank = oppPosAfter.findIndex((p: any) => p.player_id === pl.player_id);
            return rank < limit; // 0-indexed: rank 0…limit-1 = top N
          });
          if (!passes) return false;
        }
        return true;
      };

      // No package (give or receive) may contain 2+ QBs or 2+ TEs
      const packageOk = (pkg: any[]) => {
        const qbs = pkg.filter((p: any) => p.position === "QB").length;
        const tes = pkg.filter((p: any) => p.position === "TE").length;
        return qbs <= 1 && tes <= 1;
      };

      type TradeResult = {
        give: any[]; receive: any[];
        givePicks: any[]; receivePicks: any[];
        oppName: string; oppRosterId: number;
        score: number; net: number; format: string;
        draftCapital?: boolean;
      };

      const results: TradeResult[] = [];

      for (const oppRoster of rosters.filter((r: any) => r.owner_id !== user?.user_id)) {
        const oppPlayers = rosterPlayers(oppRoster);
        const oppPicks = (allPicks as any[])
          .filter((p: any) => p.owner_id === oppRoster.roster_id)
          .map((p: any) => ({ ...p, value: getStoredPickValue(pickFcValues, p) }))
          .filter((p: any) => p.value > 0)
          .sort((a: any, b: any) => {
            const yearDiff = (draftYearPriority[a.season] ?? 999) - (draftYearPriority[b.season] ?? 999);
            if (yearDiff !== 0) return yearDiff;
            if (a.round !== b.round) return a.round - b.round;
            return b.value - a.value;
          })
          .slice(0, 8);

        const oppTop = oppPlayers.slice(0, 10);
        const oppName = (users as any)[oppRoster.owner_id] || `Team ${oppRoster.roster_id}`;

        if (draftCapitalMode) {
          for (const mp of myTop) {
            for (const pick of oppPicks) {
              if (!isBalanced([mp.value], [pick.value])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [])) continue;
              results.push({
                give: [mp], receive: [], givePicks: [], receivePicks: [pick], oppName, oppRosterId: oppRoster.roster_id,
                score: -Math.abs(pick.value - mp.value), net: pick.value - mp.value, format: "1 for 1", draftCapital: true,
              });
            }
          }

          for (const mp of myTop) {
            for (let i = 0; i < oppPicks.length; i++) {
              for (let j = i + 1; j < oppPicks.length; j++) {
                const p1 = oppPicks[i], p2 = oppPicks[j];
                if (!isBalanced([mp.value], [p1.value, p2.value])) continue;
                if (!qbSafe([mp])) continue;
                if (!oppReceiveOk(oppPlayers, [mp], [])) continue;
                const adj = tradeWaiverAdj([mp.value], [p1.value, p2.value]);
                results.push({
                  give: [mp], receive: [], givePicks: [], receivePicks: [p1, p2], oppName, oppRosterId: oppRoster.roster_id,
                  score: -Math.abs((p1.value + p2.value - adj) - mp.value), net: p1.value + p2.value - mp.value - adj, format: "1 for 2", draftCapital: true,
                });
              }
            }
          }

          for (let i = 0; i < Math.min(myTop.length, 8); i++) {
            for (let j = i + 1; j < Math.min(myTop.length, 8); j++) {
              const mp1 = myTop[i], mp2 = myTop[j];
              if (!packageOk([mp1, mp2])) continue;
              if (!qbSafe([mp1, mp2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp1, mp2], [])) continue;
              for (const pick of oppPicks) {
                if (!isBalanced([mp1.value, mp2.value], [pick.value])) continue;
                const adj = tradeWaiverAdj([mp1.value, mp2.value], [pick.value]);
                results.push({
                  give: [mp1, mp2], receive: [], givePicks: [], receivePicks: [pick], oppName, oppRosterId: oppRoster.roster_id,
                  score: -Math.abs((pick.value + adj) - (mp1.value + mp2.value)), net: pick.value + adj - mp1.value - mp2.value, format: "2 for 1", draftCapital: true,
                });
              }
            }
          }

          continue;
        }

        // 1v1
        for (const mp of myTop) {
          for (const op of oppTop) {
            if (!isBalanced([mp.value], [op.value])) continue;
            if (!qbSafe([mp])) continue;
            if (!oppQbSafe(oppPlayers, [op])) continue;
            if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
            results.push({
              give: [mp], receive: [op], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
              score: posScore([mp], [op]),
              net: op.value - mp.value, format: "1 for 1",
            });
          }
        }

        // 1v2
        for (const mp of myTop) {
          for (let i = 0; i < Math.min(oppTop.length, 9); i++) {
            for (let j = i + 1; j < Math.min(oppTop.length, 9); j++) {
              const op1 = oppTop[i], op2 = oppTop[j];
              if (!isBalanced([mp.value], [op1.value, op2.value])) continue;
              if (!packageOk([op1, op2])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op1, op2])) continue;
              const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value]);
              results.push({
                give: [mp], receive: [op1, op2], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op1, op2]),
                // receive>give: opp gets waiver credit → adj raises their side (costs us)
                net: op1.value + op2.value - mp.value - adj, format: "1 for 2",
              });
            }
          }
        }

        // 2v1
        for (let i = 0; i < Math.min(myTop.length, 9); i++) {
          for (let j = i + 1; j < Math.min(myTop.length, 9); j++) {
            for (const op of oppTop) {
              const mp1 = myTop[i], mp2 = myTop[j];
              if (!isBalanced([mp1.value, mp2.value], [op.value])) continue;
              if (!packageOk([mp1, mp2])) continue;
              if (!qbSafe([mp1, mp2])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op])) continue;
              const adj = tradeWaiverAdj([mp1.value, mp2.value], [op.value]);
              results.push({
                give: [mp1, mp2], receive: [op], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp1, mp2], [op]),
                net: op.value + adj - mp1.value - mp2.value, format: "2 for 1",
              });
            }
          }
        }

        // 2v2
        for (let i = 0; i < Math.min(myTop.length, 8); i++) {
          for (let j = i + 1; j < Math.min(myTop.length, 8); j++) {
            for (let k = 0; k < Math.min(oppTop.length, 8); k++) {
              for (let l = k + 1; l < Math.min(oppTop.length, 8); l++) {
                const mp1 = myTop[i], mp2 = myTop[j];
                const op1 = oppTop[k], op2 = oppTop[l];
                if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value])) continue;
                if (!packageOk([mp1, mp2])) continue;
                if (!packageOk([op1, op2])) continue;
                if (!qbSafe([mp1, mp2])) continue;
                if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
                if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2])) continue;
                results.push({
                  give: [mp1, mp2], receive: [op1, op2], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp1, mp2], [op1, op2]),
                  net: op1.value + op2.value - mp1.value - mp2.value, format: "2 for 2",
                });
              }
            }
          }
        }

        // 2v3
        for (let i = 0; i < Math.min(myTop.length, 7); i++) {
          for (let j = i + 1; j < Math.min(myTop.length, 7); j++) {
            for (let k = 0; k < Math.min(oppTop.length, 7); k++) {
              for (let l = k + 1; l < Math.min(oppTop.length, 7); l++) {
                for (let m = l + 1; m < Math.min(oppTop.length, 7); m++) {
                  const mp1 = myTop[i], mp2 = myTop[j];
                  const op1 = oppTop[k], op2 = oppTop[l], op3 = oppTop[m];
                  if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value, op3.value])) continue;
                  if (!packageOk([mp1, mp2])) continue;
                  if (!packageOk([op1, op2, op3])) continue;
                  if (!qbSafe([mp1, mp2])) continue;
                  if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                  if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2, op3])) continue;
                  const adj = tradeWaiverAdj([mp1.value, mp2.value], [op1.value, op2.value, op3.value]);
                  results.push({
                    give: [mp1, mp2], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                    score: posScore([mp1, mp2], [op1, op2, op3]),
                    // receive>give: opp gets waiver credit → adj raises their side (costs us)
                    net: op1.value + op2.value + op3.value - mp1.value - mp2.value - adj, format: "2 for 3",
                  });
                }
              }
            }
          }
        }
      }

      // Deduplicate by player set, shuffle randomly, enforce per-player and per-opponent appearance caps, take 15
      const seen = new Set<string>();
      const playerCount: Record<string, number> = {};
      const oppCount: Record<string, number> = {};
      // Seeded shuffle so Refresh button produces a new random set
      const shuffled = results
        .filter((r) => isFinite(r.score))
        .filter((r) => !pinnedPlayer || r.give.some((p: any) => p.player_id === pinnedPlayer.player_id))
        .map((r) => {
          const bucketPriority = draftCapitalMode && r.receivePicks.length > 0
            ? Math.min(...r.receivePicks.map((p: any) => draftYearPriority[p.season] ?? 999))
            : 999;
          return {
            r,
            bucketPriority,
            sort: Math.abs(Math.sin(finderSeed * (results.indexOf(r) + 1)) * 10000) % 1,
          };
        })
        .sort((a, b) => {
          if (a.bucketPriority !== b.bucketPriority) return a.bucketPriority - b.bucketPriority;
          return a.sort - b.sort;
        })
        .map(({ r }) => r);
      const top15 = shuffled.filter((r) => {
          const allIds = [
            ...r.give.map((p: any) => `player-${p.player_id}`),
            ...r.receive.map((p: any) => `player-${p.player_id}`),
            ...r.givePicks.map((p: any) => `pick-${finderPickKey(p)}`),
            ...r.receivePicks.map((p: any) => `pick-${finderPickKey(p)}`),
          ];
          const key = [...allIds].sort().join(",");
          if (seen.has(key)) return false;
          // Each player may appear in at most 4 shown trades (pinned player is exempt)
          if (allIds.some((pid) => pid !== `player-${finderPinnedPlayerId}` && (playerCount[pid] || 0) >= 4)) return false;
          // Each opponent may appear in at most 4 shown trades
          const oppKey = String(r.oppRosterId);
          if ((oppCount[oppKey] || 0) >= 4) return false;
          seen.add(key);
          allIds.forEach((pid) => { playerCount[pid] = (playerCount[pid] || 0) + 1; });
          oppCount[oppKey] = (oppCount[oppKey] || 0) + 1;
          return true;
        })
        .slice(0, 15);

      return (
        <div className="space-y-4">
          {/* ── Player pin search ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Find trades involving a specific player</p>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/70 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-white">Draft Capital Mode</div>
                <div className="text-[11px] text-gray-400">
                  Current direction: <span className="text-gray-300">{finderDirection}</span>. When on, Finder can turn roster talent into picks while still respecting opponent fit rules.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFinderDraftCapitalMode((prev) => !prev)}
                aria-pressed={finderDraftCapitalMode}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
                  finderDraftCapitalMode ? "border-blue-500 bg-blue-600/80" : "border-gray-700 bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white transition ${
                    finderDraftCapitalMode ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {pinnedPlayer ? (
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium">{pinnedPlayer.full_name}</span>
                  <span className="text-[10px] text-gray-500 uppercase">{pinnedPlayer.position}</span>
                  <span className="text-xs text-gray-500 font-mono">{pinnedPlayer.value.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => { setFinderPinnedPlayerId(null); setFinderPlayerSearch(""); }}
                  className="text-xs text-gray-500 hover:text-red-400 transition ml-3"
                >
                  ✕ Clear
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={finderPlayerSearch}
                  onChange={(e) => { setFinderPlayerSearch(e.target.value); setFinderPinnedPlayerId(null); }}
                  placeholder="Search your roster…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                {searchMatches.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                    {searchMatches.map((p: any) => (
                      <button
                        key={p.player_id}
                        onClick={() => { setFinderPinnedPlayerId(p.player_id); setFinderPlayerSearch(""); setFinderSeed(Math.random()); }}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-700 transition text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{p.full_name}</span>
                          <span className="text-[10px] text-gray-500 uppercase">{p.position}</span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{p.value.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {pinnedPlayer
                ? <>Trades involving <strong className="text-gray-300">{pinnedPlayer.full_name}</strong> for <strong className="text-gray-300">{selectedLeague.name}</strong>.</>
                : <>Random trade suggestions for <strong className="text-gray-300">{selectedLeague.name}</strong>.</>
              }
              {loadingCalcValues && <span className="ml-2 text-blue-400">Loading values…</span>}
            </p>
            <button
              onClick={() => setFinderSeed(Math.random())}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-lg px-3 py-1.5 transition shrink-0 ml-3"
            >
              Refresh
            </button>
          </div>
          {top15.length === 0 && (
            <p className="text-gray-400 text-sm">
              {pinnedPlayer
                ? `No balanced trades found involving ${pinnedPlayer.full_name}. Try a different player or hit Refresh.`
                : draftCapitalMode
                ? "No balanced draft-capital trades found. Try Refresh, pin a player you want to move, or turn Draft Capital Mode off."
                : "No balanced trades found. You can still turn Draft Capital Mode on above to look for pick-return deals."
              }
            </p>
          )}
          {top15.map((trade: TradeResult, idx: number) => {
            const giveVals = [...trade.give.map((p: any) => p.value), ...trade.givePicks.map((p: any) => p.value)];
            const receiveVals = [...trade.receive.map((p: any) => p.value), ...trade.receivePicks.map((p: any) => p.value)];
            const giveTotal = giveVals.reduce((s: number, v: number) => s + v, 0);
            const receiveTotal = receiveVals.reduce((s: number, v: number) => s + v, 0);
            const giveCount = giveVals.length;
            const recCount = receiveVals.length;
            const cardAdj = giveCount !== recCount
              ? tradeWaiverAdj(giveVals, receiveVals)
              : 0;
            // give>receive → waiver credit added to receive; receive>give → waiver credit added to give
            const adjOnGive = recCount > giveCount ? cardAdj : 0;
            const adjOnReceive = giveCount > recCount ? cardAdj : 0;
            const giveTotalAdj = giveTotal + adjOnGive;
            const receiveTotalAdj = receiveTotal + adjOnReceive;
            const netDisplay = Math.abs(trade.net);
            const isEven = netDisplay <= 100;
            return (
              <div key={idx} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{trade.format}</span>
                    <span className="text-xs text-gray-500">with</span>
                    <span className="text-sm font-semibold text-blue-300">{trade.oppName}</span>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isEven ? "bg-yellow-900 text-yellow-300" : trade.net > 0 ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                    {isEven ? "EVEN" : trade.net > 0 ? `+${netDisplay.toLocaleString()}` : `-${netDisplay.toLocaleString()}`}
                  </span>
                </div>
                {/* Trade columns */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Give</div>
                    <div className="space-y-1">
                      {trade.give.map((p: any) => (
                        <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{p.full_name}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">{p.position}</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {trade.givePicks.map((p: any) => (
                        <div key={finderPickKey(p)} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{finderPickLabel(p)}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {adjOnGive > 0 && (
                        <div className="flex items-center justify-between px-2 py-1">
                          <span className="text-[10px] text-gray-500 italic">Waiver Adjustment</span>
                          <span className="text-[10px] text-blue-400 font-mono">+{adjOnGive.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="text-[10px] text-gray-600 text-right pr-1">Total: {giveTotalAdj.toLocaleString()}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-green-400 mb-1.5">You Receive</div>
                    <div className="space-y-1">
                      {trade.receive.map((p: any) => (
                        <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{p.full_name}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">{p.position}</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {trade.receivePicks.map((p: any) => (
                        <div key={finderPickKey(p)} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{finderPickLabel(p)}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {adjOnReceive > 0 && (
                        <div className="flex items-center justify-between px-2 py-1">
                          <span className="text-[10px] text-gray-500 italic">Waiver Adjustment</span>
                          <span className="text-[10px] text-blue-400 font-mono">+{adjOnReceive.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="text-[10px] text-gray-600 text-right pr-1">Total: {receiveTotalAdj.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
                {/* Send to Calculator */}
                <button
                  onClick={() => {
                    setCalcOpponentRosterId(trade.oppRosterId);
                    setCalcGive(trade.give.map((p: any) => p.player_id));
                    setCalcReceive(trade.receive.map((p: any) => p.player_id));
                    setCalcGivePicks(trade.givePicks.map((p: any) => finderPickKey(p)));
                    setCalcReceivePicks(trade.receivePicks.map((p: any) => finderPickKey(p)));
                    setCalcSearchA("");
                    setCalcSearchB("");
                    setTradeHubSection("CALCULATOR");
                  }}
                  className="mt-3 w-full text-xs text-gray-500 hover:text-blue-400 border border-gray-700 hover:border-blue-500 rounded-lg py-1.5 transition"
                >
                  Open in Trade Calculator →
                </button>
              </div>
            );
          })}
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
