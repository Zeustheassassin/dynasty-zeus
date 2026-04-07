"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import Dashboard from "../components/Dashboard";
import AlertsPage from "../components/AlertsPage";
import { supabase } from "../lib/supabaseclient";

// -------------------------
// MODULE-LEVEL CONSTANTS
// -------------------------
const BASE_YEAR = new Date().getFullYear();
const CURRENT_YEAR = String(BASE_YEAR);
const YEARS = Array.from({ length: 3 }, (_, index) => String(BASE_YEAR + index));
const ROUNDS = [1, 2, 3, 4];
const ROOKIE_YEAR = CURRENT_YEAR;
const ROOKIE_BOARD_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
// Version suffix forces full reset of localStorage + Supabase saves when bumped.
const ROOKIE_BOARD_VERSION = `${ROOKIE_YEAR}_sf_v5`;
const ROOKIE_BOARD_RESET_KEY = `rookieBoardReset_${ROOKIE_BOARD_VERSION}`;
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
type LeagueHubTab = "OVERVIEW" | "SIMULATOR" | "ROSTERS" | "LEAGUE_MATES" | "OPP_ROSTERS" | "STANDINGS" | "STARTERS" | "NOTES" | "POWER_RANKINGS" | "ACTIVITY" | "DRAFT_BOARD";

const LEAGUE_HUB_GROUPS: Array<{
  id: string;
  label: string;
  tabs: Array<{ id: LeagueHubTab; label: string }>;
}> = [
  {
    id: "SUMMARY",
    label: "Summary",
    tabs: [
      { id: "OVERVIEW", label: "League Overview" },
      { id: "SIMULATOR", label: "Season Simulator" },
      { id: "LEAGUE_MATES", label: "League Mates" },
      { id: "POWER_RANKINGS", label: "Power Rankings" },
      { id: "STANDINGS", label: "Standings" },
    ],
  },
  {
    id: "ROSTERS",
    label: "Rosters",
    tabs: [
      { id: "ROSTERS", label: "Rosters & Rules" },
      { id: "OPP_ROSTERS", label: "Opponent Rosters" },
      { id: "STARTERS", label: "Suggested Starters" },
    ],
  },
  {
    id: "NOTES",
    label: "Notes",
    tabs: [
      { id: "NOTES", label: "League Notes" },
      { id: "ACTIVITY", label: "Activity Feed" },
    ],
  },
  {
    id: "DRAFT_TOOLS",
    label: "Draft",
    tabs: [
      { id: "DRAFT_BOARD", label: "Draft Board" },
    ],
  },
];

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

const isSnakeDraft = (draft: any) => {
  const typeCandidates = [
    draft?.type,
    draft?.settings?.type,
    draft?.settings?.draft_type,
    draft?.metadata?.type,
    draft?.metadata?.draft_type,
  ]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);

  return typeCandidates.some((value) => value.includes("snake"));
};

const getDraftRoundSlot = (draft: any, round: number, baseSlot: number, totalTeams: number) => {
  if (!baseSlot || baseSlot < 1 || totalTeams < 2) return baseSlot;
  if (!isSnakeDraft(draft)) return baseSlot;
  return round % 2 === 0 ? (totalTeams - baseSlot + 1) : baseSlot;
};

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

// Detached color lookup so adjusted buckets get the right color without needing fake ranks
const getBucketColor = (bucket: string): string => {
  const map: Record<string, string> = {
    "Elite":             "text-yellow-300 bg-yellow-900/40 border-yellow-600",
    "True Contender":    "text-green-300 bg-green-900/40 border-green-600",
    "Almost There":      "text-cyan-300 bg-cyan-900/40 border-cyan-600",
    "Rebuilder":         "text-indigo-300 bg-indigo-900/40 border-indigo-600",
    "Fading Contender":  "text-blue-300 bg-blue-900/40 border-blue-600",
    "Purgatory":         "text-orange-300 bg-orange-900/40 border-orange-600",
    "Blow Up":           "text-rose-300 bg-rose-900/40 border-rose-600",
    "Hopeless":          "text-red-300 bg-red-900/40 border-red-600",
  };
  return map[bucket] ?? "text-gray-300 bg-gray-800 border-gray-600";
};

// Window score: how open is this roster's competitive window?
// Combines core age, young building blocks, and aging veterans.
// Positive = window is open and widening. Negative = window is closing.
const computeWindowScore = (profile: any): number => {
  const coreAge = Number(profile?.coreAge || 0);
  const youngCoreCount = Number(profile?.youngCoreCount || 0);
  const oldCoreCount  = Number(profile?.oldCoreCount  || 0);
  let score = 0;
  // Age relative to dynasty prime (~26). Every year over 26 costs, every year under earns a little.
  if (coreAge > 0) {
    score -= Math.max(0, coreAge - 26) * 0.55;
    score += Math.max(0, 26 - coreAge) * 0.25;
  }
  score += youngCoreCount * 0.85; // each under-24 core piece extends the window
  score -= oldCoreCount  * 1.05; // each over-threshold core piece compresses it
  return score; // typically -5 to +5
};

// Three-factor bucket adjustment: dynasty rank × redraft rank → raw bucket,
// then shifted by window score (age) and playoff simulation pressure.
// This is the single source of truth for strategic classification.
const getAdjustedDirectionBucket = (
  rawBucket: string,
  profile: any,
  playoffOdds: number,
  hasSimData = false
): string => {
  if (!rawBucket) return "Mixed Identity";
  const windowScore = computeWindowScore(profile);
  // Playoff pressure: centered at 50%, range -4 to +4.
  // Only applied when simulation data is available.
  const playoffPressure = hasSimData ? (playoffOdds - 50) / 12.5 : 0;
  const composite = windowScore + playoffPressure; // typically -8 to +8, meaningful range -4 to +4
  const youngCoreCount = Number(profile?.youngCoreCount || 0);

  let result: string;
  switch (rawBucket) {
    case "Elite":
      if (composite < -4) result = "Fading Contender"; // dominant assets, window collapsing fast
      else if (composite < -2) result = "True Contender"; // great assets, slight closing window
      else result = "Elite";
      break;

    case "True Contender":
      if (composite > 2.5) result = "Elite";           // young + great odds = elite tier
      else if (composite < -3.5) result = "Blow Up";   // aging + crushed odds = sell everything
      else if (composite < -1.5) result = "Fading Contender"; // aging core or poor odds
      else result = "True Contender";
      break;

    case "Almost There":
      if (composite > 2.5) result = "True Contender";  // young + good odds = they're ready
      else if (composite < -3.5) result = "Blow Up";
      else if (composite < -1.5) result = "Rebuilder";  // good dynasty assets but window not open yet = clear rebuild path
      else result = "Almost There";
      break;

    case "Fading Contender":
      if (composite > 2.5 && youngCoreCount >= 2) result = "True Contender"; // surprising young upside
      else if (composite > 1.5) result = "Almost There"; // window cracked back open
      else if (composite < -2.5) result = "Blow Up";   // no window left
      else result = "Fading Contender";
      break;

    case "Purgatory":
      if (composite > 3) result = "Almost There";      // young + decent odds = path exists
      else if (composite < -2.5) result = "Blow Up";   // no direction and no time
      else result = "Purgatory";
      break;

    case "Rebuilder":
      if (composite > 3.5 && youngCoreCount >= 2) result = "Almost There"; // strong youth + good trajectory = approaching competition
      else if (composite < -3.5) result = "Hopeless";  // dynasty pieces are aging out before they can compete
      else result = "Rebuilder";
      break;

    case "Blow Up":
      if (composite > 3.5 && youngCoreCount >= 3) result = "Rebuilder"; // real young pieces = proper rebuild
      else if (composite < -3) result = "Hopeless";
      else result = "Blow Up";
      break;

    case "Hopeless":
      if (composite > 4 && youngCoreCount >= 4) result = "Blow Up"; // at least some hope
      else result = "Hopeless";
      break;

    default:
      result = rawBucket;
  }

  // Hard playoff-odds floors — sim data overrides gradient when it says you're not a contender.
  // Note: "Fading Contender" is NOT used as a floor — it implies a closing window (declining team).
  // Teams building toward contention belong in "Almost There" or "Rebuilder", not "Fading Contender".
  if (hasSimData) {
    const above = (...buckets: string[]) => buckets.includes(result);
    if (playoffOdds === 0) {
      // No mathematical chance — contender-labeled teams drop to Rebuilder (have assets, just not competing)
      if (above("Elite", "True Contender", "Almost There")) result = "Rebuilder";
      // Fading Contender at 0% — gradient usually pushed to Blow Up already; otherwise Purgatory
      if (result === "Fading Contender") result = "Purgatory";
    } else if (playoffOdds < 15) {
      // Very low odds — contender-labeled teams drop to Rebuilder (great assets, clear rebuild path)
      // "Purgatory" implies no direction; top dynasty teams have direction even at low odds
      if (above("Elite", "True Contender", "Almost There")) result = "Rebuilder";
      // Declining window + almost zero odds = genuinely stuck
      if (result === "Fading Contender") result = "Purgatory";
    } else if (playoffOdds < 50) {
      // Below even money — can't be a true contender; "Almost There" is the ceiling
      if (above("Elite", "True Contender")) result = "Almost There";
    }
  }

  return result;
};

const ordinal = (rank: number) => {
  if (!rank) return "-";
  if (rank % 100 >= 11 && rank % 100 <= 13) return `${rank}th`;
  if (rank % 10 === 1) return `${rank}st`;
  if (rank % 10 === 2) return `${rank}nd`;
  if (rank % 10 === 3) return `${rank}rd`;
  return `${rank}th`;
};

const average = (values: number[]) =>
  values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const logisticWinProb = (myScore: number, oppScore: number, scale = 180) =>
  clamp(1 / (1 + Math.exp((oppScore - myScore) / scale)), 0.05, 0.95);
const createSeededRandom = (seed: number) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
const randomNormal = (rng: () => number) => {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
const buildRoundRobinSchedule = (rosterIds: number[], totalWeeks: number) => {
  const rotation = [...rosterIds];
  if (rotation.length % 2 === 1) rotation.push(-1);
  if (rotation.length < 2) return Array.from({ length: totalWeeks }, () => [] as Array<[number, number]>);

  const rounds: Array<Array<[number, number]>> = [];
  let current = [...rotation];
  for (let round = 0; round < current.length - 1; round++) {
    const pairs: Array<[number, number]> = [];
    for (let idx = 0; idx < current.length / 2; idx++) {
      const left = current[idx];
      const right = current[current.length - 1 - idx];
      if (left !== -1 && right !== -1) pairs.push([left, right]);
    }
    rounds.push(pairs);
    current = [current[0], current[current.length - 1], ...current.slice(1, -1)];
  }
  return Array.from({ length: totalWeeks }, (_, weekIdx) => rounds[weekIdx % rounds.length] || []);
};
const percentileFromCounts = (counts: number[], percentile: number) => {
  const total = sum(counts);
  if (!total) return 0;
  const threshold = total * percentile;
  let running = 0;
  for (let idx = 0; idx < counts.length; idx++) {
    running += counts[idx];
    if (running >= threshold) return idx;
  }
  return counts.length - 1;
};

const rankAgainstLeague = (totals: number[], value: number) => {
  const sorted = [...totals].sort((a, b) => b - a);
  let rank = 1;
  for (const total of sorted) {
    if (value >= total) break;
    rank++;
  }
  return Math.min(rank, sorted.length || 1);
};

const FLEX_ELIGIBLE_POSITIONS = ["RB", "WR", "TE"];
const SUPER_FLEX_ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE"];

const getProjectionKickoffAt = (projection: any) => {
  const rawCandidates = [
    projection?.kickoffAt,
    projection?.kickoff_at,
    projection?.gameTime,
    projection?.game_time,
    projection?.startTime,
    projection?.start_time,
  ];
  const parsed = rawCandidates
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  return parsed || null;
};

const getKickoffState = (kickoffAt: number | null, now = Date.now()) => {
  if (!kickoffAt) return "Upcoming";
  if (now < kickoffAt) return "Upcoming";
  if (now - kickoffAt < 6 * 60 * 60 * 1000) return "Live";
  return "Final";
};

const getKickoffStateClasses = (state: string) => {
  if (state === "Live") return "border-green-500/40 bg-green-500/10 text-green-300";
  if (state === "Final") return "border-gray-600 bg-gray-800 text-gray-300";
  return "border-blue-500/40 bg-blue-500/10 text-blue-300";
};

const formatKickoffTime = (kickoffAt: number | null) => {
  if (!kickoffAt) return "--";
  try {
    return new Date(kickoffAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "--";
  }
};

const getLineupSlotEligiblePositions = (slot: string) => {
  if (slot === "FLEX") return FLEX_ELIGIBLE_POSITIONS;
  if (slot === "SUPER_FLEX") return SUPER_FLEX_ELIGIBLE_POSITIONS;
  return [slot];
};

const rebalanceLineupForKickoffWindows = (
  lineup: Array<{ slot: string; player: any; score: number; kickoffAt: number | null }>,
  hasKickoffData: boolean
) => {
  if (!hasKickoffData) return lineup;

  const nextLineup = [...lineup];
  const getKickoffSortValue = (row: { kickoffAt: number | null }) => row.kickoffAt ?? Number.MAX_SAFE_INTEGER;

  const tryMoveEarlierPlayerIntoLockedSlot = (lockedSlot: string, flexSlot: "FLEX" | "SUPER_FLEX") => {
    const lockedIndexes = nextLineup
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.slot === lockedSlot && row.player?.player_id);
    const flexIndexes = nextLineup
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.slot === flexSlot && row.player?.player_id);

    lockedIndexes.forEach(({ row: lockedRow, index: lockedIndex }) => {
      const swapCandidate = flexIndexes
        .filter(({ row }) => row.player?.position === lockedSlot)
        .sort((a, b) => getKickoffSortValue(a.row) - getKickoffSortValue(b.row))[0];
      if (!swapCandidate) return;

      const lockedKickoff = getKickoffSortValue(lockedRow);
      const flexKickoff = getKickoffSortValue(swapCandidate.row);
      if (flexKickoff >= lockedKickoff) return;

      nextLineup[lockedIndex] = { ...swapCandidate.row, slot: lockedSlot };
      nextLineup[swapCandidate.index] = { ...lockedRow, slot: flexSlot };
    });
  };

  ["RB", "WR", "TE"].forEach((slot) => tryMoveEarlierPlayerIntoLockedSlot(slot, "FLEX"));
  ["QB", "RB", "WR", "TE"].forEach((slot) => tryMoveEarlierPlayerIntoLockedSlot(slot, "SUPER_FLEX"));

  return nextLineup;
};

const getRosterDirectionProfile = ({
  rosterId,
  rosters,
  ownedPicks,
  players,
  pickValues,
  redraftValues,
  dynastyValueForPlayer,
}: any) => {
  if (!rosterId || !rosters?.length) return null;

  const targetRoster = rosters.find((r: any) => Number(r.roster_id) === Number(rosterId));
  if (!targetRoster) return null;

  const positions = ["QB", "RB", "WR", "TE"];
  const n = rosters.length;
  const pickList = (ownedPicks || []).filter((pick: any) => Number(pick.owner_id) === Number(rosterId));
  const firstRounders = pickList.filter((pick: any) => Number(pick.round) === 1);
  const currentYearFirsts = firstRounders.filter((pick: any) => String(pick.season) === CURRENT_YEAR);
  const premiumCurrentFirsts = currentYearFirsts.filter((pick: any) => {
    const slot = String(pick.slot || "");
    if (!slot.includes(".")) return false;
    const [, rawPick] = slot.split(".");
    return Number(rawPick) > 0 && Number(rawPick) <= 6;
  });
  const futureFirsts = firstRounders.filter((pick: any) => String(pick.season) !== CURRENT_YEAR);
  const pickTotal = pickList.reduce((sum: number, pick: any) => sum + getStoredPickValue(pickValues, pick), 0);

  const rosterPlayers = (targetRoster.players || [])
    .map((id: string) => {
      const player = players?.[id];
      return player
        ? {
            ...player,
            dynValue: dynastyValueForPlayer(id),
            redValue: redraftValues?.[id] || 0,
          }
        : null;
    })
    .filter(Boolean);

  const skillPlayers = rosterPlayers.filter((player: any) => positions.includes(player.position));
  const topDynastyCore = [...skillPlayers]
    .sort((a: any, b: any) => b.dynValue - a.dynValue)
    .slice(0, 8);

  const coreAge = average(topDynastyCore.map((player: any) => Number(player.age)).filter(Boolean));
  const oldCoreCount = topDynastyCore.filter((player: any) => {
    if (!player.age) return false;
    if (player.position === "QB") return player.age >= 30;
    if (player.position === "RB") return player.age >= 26;
    return player.age >= 29;
  }).length;
  const youngCoreCount = topDynastyCore.filter((player: any) => Number(player.age) > 0 && Number(player.age) <= 24).length;

  const rosterDynVal = rosters
    .map((roster: any) => ({
      roster_id: roster.roster_id,
      val:
        (roster.players || []).reduce((sum: number, id: string) => sum + dynastyValueForPlayer(id), 0) +
        (ownedPicks || [])
          .filter((pick: any) => Number(pick.owner_id) === Number(roster.roster_id))
          .reduce((sum: number, pick: any) => sum + getStoredPickValue(pickValues, pick), 0),
    }))
    .sort((a: any, b: any) => b.val - a.val);

  const rosterRedVal = rosters
    .map((roster: any) => ({
      roster_id: roster.roster_id,
      val: (roster.players || []).reduce((sum: number, id: string) => sum + (redraftValues?.[id] || 0), 0),
    }))
    .sort((a: any, b: any) => b.val - a.val);

  const standingsSorted = [...rosters].sort((a: any, b: any) => {
    const aw = a.settings?.wins || 0;
    const bw = b.settings?.wins || 0;
    return bw !== aw ? bw - aw : (b.settings?.fpts || 0) - (a.settings?.fpts || 0);
  });
  const maxPfSorted = [...rosters].sort((a: any, b: any) => (b.settings?.fpts_max || 0) - (a.settings?.fpts_max || 0));

  const dynRank = rosterDynVal.findIndex((row: any) => Number(row.roster_id) === Number(rosterId)) + 1;
  const redRank = rosterRedVal.findIndex((row: any) => Number(row.roster_id) === Number(rosterId)) + 1;
  const standRank = standingsSorted.findIndex((row: any) => Number(row.roster_id) === Number(rosterId)) + 1;
  const maxPfRank = maxPfSorted.findIndex((row: any) => Number(row.roster_id) === Number(rosterId)) + 1;
  const { bucket, bucketColor } = getLeagueDirectionBucket(dynRank, redRank);

  const positionTotals = positions.reduce((acc: Record<string, number>, pos) => {
    acc[pos] = skillPlayers
      .filter((player: any) => player.position === pos)
      .reduce((sum: number, player: any) => sum + player.dynValue, 0);
    return acc;
  }, {});

  const positionRanks = positions.map((pos) => {
    const leagueTotals = rosters.map((roster: any) =>
      (roster.players || []).reduce((sum: number, id: string) => {
        const player = players?.[id];
        if (!player || player.position !== pos) return sum;
        return sum + dynastyValueForPlayer(id);
      }, 0)
    );
    return {
      pos,
      total: positionTotals[pos],
      rank: rankAgainstLeague(leagueTotals, positionTotals[pos]),
    };
  });

  const strongThreshold = Math.max(2, Math.ceil(n / 3));
  const weakThreshold = Math.max(strongThreshold + 1, n - 2);
  const strengths = positionRanks
    .filter((entry) => entry.rank <= strongThreshold)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => `${entry.pos} strength (${ordinal(entry.rank)} of ${n})`);
  const concerns = positionRanks
    .filter((entry) => entry.rank >= weakThreshold)
    .sort((a, b) => b.rank - a.rank)
    .map((entry) => `${entry.pos} needs help (${ordinal(entry.rank)} of ${n})`);

  if (pickTotal >= 3500 || futureFirsts.length >= 2) {
    strengths.push(`Strong draft capital (${firstRounders.length} firsts)`);
  } else if (firstRounders.length <= 1 && pickTotal < 1500) {
    concerns.push("Thin future draft capital");
  }

  if (youngCoreCount >= 4) strengths.push(`Young core (avg age ${coreAge || "-"})`);
  if (oldCoreCount >= 4) concerns.push("Core is aging");

  const weakestPos = [...positionRanks].sort((a, b) => b.rank - a.rank)[0]?.pos || "RB";
  const strongestPos = [...positionRanks].sort((a, b) => a.rank - b.rank)[0]?.pos || "WR";
  const agingSellPos = oldCoreCount > 0
    ? (
        ["RB", "WR", "TE", "QB"].find((pos) =>
          topDynastyCore.some((player: any) => player.position === pos && (
            (pos === "RB" && Number(player.age) >= 26) ||
            (pos === "QB" && Number(player.age) >= 30) ||
            ((pos === "WR" || pos === "TE") && Number(player.age) >= 29)
          ))
        ) || strongestPos
      )
    : strongestPos;

  let summary = "";
  let actions: string[] = [];

  switch (bucket) {
    case "Elite":
      summary = "You have both insulation and points. This roster should be hunting difference-makers, not depth.";
      actions = [
        `Package picks for an impact ${weakestPos}`,
        "Consolidate 2-for-1 without touching core pieces",
        "Protect playoff depth instead of adding more bench value",
      ];
      break;
    case "True Contender":
      summary = "Your build is ready to compete now. Lean into weekly points while keeping your best long-term assets.";
      actions = [
        `Buy points at ${weakestPos}`,
        "Turn spare picks into startable production",
        "Prefer consolidation trades over future-only bets",
      ];
      break;
    case "Almost There":
      summary = "You are close enough to buy help, but not close enough to burn the whole future without discipline.";
      actions = [
        `Add one reliable ${weakestPos}`,
        "Keep at least one future first on the roster",
        "Target stable veterans instead of volatile splash bets",
      ];
      break;
    case "Rebuilder":
      summary = "The dynasty value is here, but the weekly points are not. Stay patient and only push if the price is right.";
      actions = [
        "Hold cornerstone youth unless you get a clear overpay",
        `Shop aging ${agingSellPos} pieces for picks or young starters`,
        "Look for undervalued producers once your weekly floor improves",
      ];
      break;
    case "Fading Contender":
      summary = "You can still compete, but the long-term insulation is slipping. Avoid doubling down on short-window assets.";
      actions = [
        `Sell one aging ${agingSellPos} before the cliff hits`,
        `Patch ${weakestPos} only with short-term discounts`,
        "Take value insulation over thin all-in moves",
      ];
      break;
    case "Purgatory":
      summary = "This roster is stuck in the middle. Sideways trades will not fix it, so pick a direction and press it.";
      actions = [
        "Decide now between points and picks",
        `If buying, focus only on ${weakestPos}; if selling, move aging ${agingSellPos}`,
        "Prioritize 2-for-1 or tier-up deals that change roster shape",
      ];
      break;
    case "Blow Up":
      summary = "You are better off converting present points into insulation than chasing a low-probability run.";
      actions = [
        `Move aging ${agingSellPos} pieces for firsts or young WR/QB value`,
        "Take multi-asset packages over single declining veterans",
        "Keep young anchors and widen the value base",
      ];
      break;
    case "Hopeless":
      summary = "The path here is a true rebuild. Your best move is to maximize insulation and future flexibility.";
      actions = [
        "Prioritize first-rounders and young WR/QB assets",
        `Sell productive ${agingSellPos} pieces before the market cools`,
        "Avoid buying RB points until the rest of the roster is ready",
      ];
      break;
    default:
      summary = "The roster has mixed signals. Stay flexible and make moves that raise insulation or weekly certainty.";
      actions = [
        `Use strength at ${strongestPos} to address ${weakestPos} if value is there`,
        "Prefer tier-ups over horizontal swaps",
        "Do not force an all-in or full rebuild move yet",
      ];
      break;
  }

  return {
    bucket,
    bucketColor,
    dynRank,
    redRank,
    standRank,
    maxPfRank,
    n,
    summary,
    actions,
    shortAction: actions[0],
    strengths: strengths.slice(0, 3),
    concerns: concerns.slice(0, 3),
    positionRanks,
    coreAge,
    youngCoreCount,
    oldCoreCount,
    pickTotal,
    firstRounders: firstRounders.length,
    premiumCurrentFirsts: premiumCurrentFirsts.length,
    futureFirsts: futureFirsts.length,
  };
};

const getProfilePosBuckets = (profile: any) => {
  const positions = profile?.positionRanks || [];
  const n = profile?.n || 12;
  const strongThreshold = Math.max(2, Math.ceil(n / 3));
  const weakThreshold = Math.max(strongThreshold + 1, n - 2);
  return {
    strong: positions.filter((entry: any) => entry.rank <= strongThreshold).map((entry: any) => entry.pos),
    weak: positions.filter((entry: any) => entry.rank >= weakThreshold).map((entry: any) => entry.pos),
  };
};

const getLeagueMateMotivation = (profile: any, tradeCount30d: number) => {
  if (!profile) return "No clear read yet.";
  const activeTrader = tradeCount30d >= 2 ? " Active trader lately." : "";
  switch (profile.bucket) {
    case "Elite":
    case "True Contender":
      return `Likely buying weekly points and lineup upgrades.${activeTrader}`;
    case "Almost There":
      return `Probably open to a focused win-now patch without burning the whole future.${activeTrader}`;
    case "Rebuilder":
    case "Blow Up":
    case "Hopeless":
      return `Most likely to listen on aging producers for picks or younger insulation.${activeTrader}`;
    case "Fading Contender":
      return `Could go either way, but should be receptive to rebalancing aging production into flexibility.${activeTrader}`;
    case "Purgatory":
      return `Needs a direction-changing deal more than a small lateral swap.${activeTrader}`;
    default:
      return `Mixed signals. Best offers should clearly solve a roster problem.${activeTrader}`;
  }
};

const getTradePartnerFitLabel = (fitScore: number) => {
  if (fitScore >= 34) return "Best Trade Partner";
  if (fitScore >= 24) return "Strong Fit";
  if (fitScore >= 14) return "Solid Fit";
  if (fitScore < 4) return "Tough Fit";
  return "Neutral Fit";
};

const getTradePartnerFit = ({ myProfile, oppProfile, tradeCount30d }: any) => {
  if (!myProfile || !oppProfile) {
    return { fitScore: 0, fitLabel: "Neutral Fit", fitReasons: [] as string[] };
  }

  const myBuckets = getProfilePosBuckets(myProfile);
  const oppBuckets = getProfilePosBuckets(oppProfile);
  const overlapToBuy = myBuckets.weak.filter((pos: string) => oppBuckets.strong.includes(pos));
  const overlapToSell = myBuckets.strong.filter((pos: string) => oppBuckets.weak.includes(pos));
  const sharedWeakness = myBuckets.weak.filter((pos: string) => oppBuckets.weak.includes(pos));
  const fitReasons: string[] = [];
  let fitScore = 0;

  if (overlapToBuy.length > 0) {
    fitScore += overlapToBuy.length * 12;
    fitReasons.push(`They are strong where you need help: ${overlapToBuy.join("/")}`);
  }
  if (overlapToSell.length > 0) {
    fitScore += overlapToSell.length * 10;
    fitReasons.push(`You can pressure their weak spots at ${overlapToSell.join("/")}`);
  }
  if (sharedWeakness.length > 0) {
    fitScore -= sharedWeakness.length * 6;
  }

  const myBucket = myProfile.bucket;
  const oppBucket = oppProfile.bucket;
  const iAmBuying = ["Elite", "True Contender", "Almost There"].includes(myBucket);
  const iAmSelling = ["Rebuilder", "Blow Up", "Hopeless"].includes(myBucket);
  const oppBuying = ["Elite", "True Contender", "Almost There"].includes(oppBucket);
  const oppSelling = ["Rebuilder", "Blow Up", "Hopeless"].includes(oppBucket);

  if (iAmBuying && oppSelling) {
    fitScore += 14;
    fitReasons.push("Your timelines line up: buyer vs seller");
  } else if (iAmSelling && oppBuying) {
    fitScore += 14;
    fitReasons.push("Your timelines line up: seller vs buyer");
  } else if ((iAmBuying && oppBuying) || (iAmSelling && oppSelling)) {
    fitScore -= 5;
  }

  if ((oppProfile?.futureFirsts || 0) >= 2 || (oppProfile?.pickTotal || 0) >= 3200) {
    fitScore += 5;
    fitReasons.push("They have enough draft insulation to deal");
  }

  fitScore += Math.min(tradeCount30d || 0, 3) * 3;
  if ((tradeCount30d || 0) >= 2) {
    fitReasons.push("They have been active in the market recently");
  }

  return {
    fitScore,
    fitLabel: getTradePartnerFitLabel(fitScore),
    fitReasons: fitReasons.slice(0, 3),
  };
};

const getCrossLeaguePreferenceFit = ({ myProfile, crossLeagueIntel }: any) => {
  if (!myProfile || !crossLeagueIntel || (crossLeagueIntel.totalDynastyLeagues || 0) < 2) {
    return { fitScore: 0, fitReasons: [] as string[] };
  }

  const myBuckets = getProfilePosBuckets(myProfile);
  const preferredPositions = crossLeagueIntel.preferredPositions || [];
  const overlappingStrengths = myBuckets.strong.filter((pos: string) => preferredPositions.includes(pos));
  const fitReasons: string[] = [];
  let fitScore = 0;

  if (overlappingStrengths.length > 0) {
    fitScore += overlappingStrengths.length * 7;
    fitReasons.push(`Across leagues they keep collecting ${overlappingStrengths.join("/")} assets`);
  }

  if ((crossLeagueIntel.youngQbWrRate || 0) >= 0.22 && myBuckets.strong.some((pos: string) => ["QB", "WR"].includes(pos))) {
    fitScore += 5;
    fitReasons.push("They show a clear bias toward young QB/WR insulation");
  }

  if ((crossLeagueIntel.veteranRbRate || 0) >= 0.12 && myBuckets.strong.includes("RB")) {
    fitScore += 4;
    fitReasons.push("They repeatedly roster veteran RB production");
  }

  if ((crossLeagueIntel.totalDynastyLeagues || 0) >= 6) {
    fitScore += 2;
  }

  return {
    fitScore,
    fitReasons: fitReasons.slice(0, 2),
  };
};

const getCrossLeagueTradeBehaviorFit = ({ myProfile, crossLeagueIntel }: any) => {
  if (!myProfile || !crossLeagueIntel || (crossLeagueIntel.crossLeagueTradeCount30d || 0) <= 0) {
    return { fitScore: 0, fitReasons: [] as string[] };
  }

  const myBuckets = getProfilePosBuckets(myProfile);
  const tradePreferredPositions = crossLeagueIntel.tradePreferredPositions || [];
  const fitReasons: string[] = [];
  let fitScore = 0;

  const overlappingStrengths = myBuckets.strong.filter((pos: string) => tradePreferredPositions.includes(pos));
  if (overlappingStrengths.length > 0) {
    fitScore += overlappingStrengths.length * 8;
    fitReasons.push(`They actively trade for ${overlappingStrengths.join("/")} across leagues`);
  }

  if ((crossLeagueIntel.youngQbWrBuyRate || 0) >= 0.2 && myBuckets.strong.some((pos: string) => ["QB", "WR"].includes(pos))) {
    fitScore += 5;
    fitReasons.push("Their recent deals skew toward young QB/WR insulation");
  }

  if ((crossLeagueIntel.veteranRbBuyRate || 0) >= 0.15 && myBuckets.strong.includes("RB")) {
    fitScore += 4;
    fitReasons.push("They have been paying for veteran RB production");
  }

  if ((crossLeagueIntel.crossLeagueTradeCount30d || 0) >= 4) {
    fitScore += 3;
  }

  return {
    fitScore,
    fitReasons: fitReasons.slice(0, 2),
  };
};

const fetchFantasyCalcValues = async (numQbs = 1): Promise<{ playerValues: Record<string, number>; pickValues: Record<string, number> }> => {
  const res = await fetch(
    `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${numQbs}&numTeams=12&ppr=1`
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
  // FC only provides future-year 1st round values; derive 2nd/3rd/4th using current-year ratios
  const base1st = pickValues[`${CURRENT_YEAR}-1`];
  if (base1st) {
    Object.entries(pickRoundValues).forEach(([key]) => {
      const [year, roundStr] = key.split("-");
      if (roundStr !== "1") return;
      const yr1stVal = pickValues[key];
      [2, 3, 4].forEach((r) => {
        const rKey = `${year}-${r}`;
        if (!pickValues[rKey]) {
          const baseCurrentYear = pickValues[`${CURRENT_YEAR}-${r}`];
          if (baseCurrentYear) pickValues[rKey] = Math.round(yr1stVal * (baseCurrentYear / base1st));
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
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/[^a-z]/g, "")
    .trim();

const buildSleeperRookieBoard = (_playerMap: any) => [];

type AlertsCenterCategory = "market" | "status" | "league" | "watchlist" | "news";
type AlertsCenterSource = "internal" | "watchlist" | "external";
type AlertsCenterSeverity = "high" | "medium" | "low";

type AlertsCenterItem = {
  id: string;
  category: AlertsCenterCategory;
  source: AlertsCenterSource;
  severity: AlertsCenterSeverity;
  title: string;
  detail: string;
  actionable: boolean;
  timestamp: number;
  playerId?: string | null;
  leagueId?: string | null;
  teamLabel?: string | null;
  link?: string | null;
  payload?: any;
  dismissed?: boolean;
};

type WatchlistEntry = {
  player_id: string;
  label: string;
  threshold_up: number;
  threshold_down: number;
  league_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export default function Home() {

  // -------------------------
  // CORE STATE
  // -------------------------
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<any>(null);
  const [supabaseUser, setSupabaseUser] = useState<any>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [notes, setNotes] = useState<any[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [supabaseError, setSupabaseError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
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
const [tradeHubSection, setTradeHubSection] = useState<"CALCULATOR" | "FINDER" | "RECOMMENDATIONS">("CALCULATOR");
const [finderSeed, setFinderSeed] = useState(() => Math.random());
const [finderDraftCapitalMode, setFinderDraftCapitalMode] = useState(false);
const [leagueHubTab, setLeagueHubTab] = useState<LeagueHubTab>("OVERVIEW");
const [leagueOverviewData, setLeagueOverviewData] = useState<Record<string, any>>({});
const [loadingLeagueOverview, setLoadingLeagueOverview] = useState(false);
const [leagueOverviewLoaded, setLeagueOverviewLoaded] = useState(false);
const [leagueSimCache, setLeagueSimCache] = useState<Record<string, Record<number, any>>>({});
const [readyLeagueId, setReadyLeagueId] = useState<string | null>(null);
const [simQueue, setSimQueue] = useState<string[]>([]);
const [simProgress, setSimProgress] = useState<{ done: number; total: number } | null>(null);
// Random salt included in the sim seed so each Run All Sims call produces slightly different results.
const [simSalt, setSimSalt] = useState<number>(() => Math.floor(Math.random() * 1_000_000));
// Frozen sim rows committed at button-click time — keyed league_id → rosterId → sim row.
// Persisted in localStorage so values survive page reloads without re-running sims.
const [committedSimsByLeague, setCommittedSimsByLeague] = useState<Record<string, Record<number, any>>>(() => {
  try { return JSON.parse(localStorage.getItem("committedSimRows_v2") || "{}"); } catch { return {}; }
});
const [myDraftSlotPicks, setMyDraftSlotPicks] = useState<Record<string, string>>({}); // slot → player_id override
const [draftSlotEditing, setDraftSlotEditing] = useState<string | null>(null); // slot currently open for edit
const [draftSlotSearchQuery, setDraftSlotSearchQuery] = useState("");
// userId → { QB: 0.15, RB: 0.30, WR: 0.45, TE: 0.10 } — historical pick tendencies per owner
const [ownerDraftTendencies, setOwnerDraftTendencies] = useState<Record<string, Record<string, number>>>({});
const [leagueMateTradeIntel, setLeagueMateTradeIntel] = useState<Record<string, any>>({});
const [loadingLeagueMateIntel, setLoadingLeagueMateIntel] = useState(false);
const [crossLeagueMateIntel, setCrossLeagueMateIntel] = useState<Record<string, any>>({});
const [loadingCrossLeagueMateIntel, setLoadingCrossLeagueMateIntel] = useState(false);
const [leagueMateProfileCache, setLeagueMateProfileCache] = useState<Record<string, any[]>>({});
const [leagueNotes, setLeagueNotes] = useState<Record<string, string>>({});
const [nflState, setNflState] = useState<any>(null);
const [gamedayMatchups, setGamedayMatchups] = useState<any[]>([]);
const [loadingGamedayMatchups, setLoadingGamedayMatchups] = useState(false);
const [selectedGamedayMatchupId, setSelectedGamedayMatchupId] = useState<number | null>(null);
const [playerProfileId, setPlayerProfileId] = useState<string | null>(null);
const [playerNotes, setPlayerNotes] = useState<Record<string, string>>(() => {
  try { return JSON.parse(localStorage.getItem("playerNotes_v1") || "{}"); } catch { return {}; }
});
const [playerDispositions, setPlayerDispositions] = useState<Record<string, { sell: string; buy: string }>>(() => {
  try { return JSON.parse(localStorage.getItem("playerDispositions_v1") || "{}"); } catch { return {}; }
});
const [activityTransactions, setActivityTransactions] = useState<any[]>([]);
const [loadingActivity, setLoadingActivity] = useState(false);
const [leagueWeeklyMatchups, setLeagueWeeklyMatchups] = useState<Record<string, any[]>>({});
const [loadingLeagueWeeklyMatchups, setLoadingLeagueWeeklyMatchups] = useState(false);
const [dataHubTab, setDataHubTab] = useState<"OWNERSHIP" | "DYNASTY" | "REDRAFT" | "PROJECTIONS" | "PICK_VALUES" | "LEAGUEMATES">("OWNERSHIP");
const [leagueMateStats, setLeagueMateStats] = useState<any[]>([]);
const [leagueMateStatsLoaded, setLeagueMateStatsLoaded] = useState(false);
const [loadingLeagueMateStats, setLoadingLeagueMateStats] = useState(false);
const [leagueMateSort, setLeagueMateSort] = useState<"name" | "total" | "bestball" | "shared">("total");
const [leagueMateSearch, setLeagueMateSearch] = useState("");
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
const [finderTargetOppRosterId, setFinderTargetOppRosterId] = useState<number | null>(null);
const [finderTargetPlayerSearch, setFinderTargetPlayerSearch] = useState("");
const [finderTargetPlayerId, setFinderTargetPlayerId] = useState<string | null>(null);

const [draftHubSection, setDraftHubSection] = useState<"BOARD" | "BIG_BOARD">("BOARD");
const [prSortKey, setPrSortKey] = useState<"dynTotal"|"redTotal"|"qbTotal"|"rbTotal"|"wrTotal"|"teTotal">("dynTotal");
const [prSortAsc, setPrSortAsc] = useState(false);
const [prPopup, setPrPopup] = useState<{ rosterId: number; col: "dyn"|"red"|"QB"|"RB"|"WR"|"TE" } | null>(null);
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
const [dashboardAlerts, setDashboardAlerts] = useState<AlertsCenterItem[]>([]);
const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
const [watchlistEntries, setWatchlistEntries] = useState<WatchlistEntry[]>([]);
const [watchlistSearch, setWatchlistSearch] = useState("");
const [watchThresholdUp, setWatchThresholdUp] = useState("250");
const [watchThresholdDown, setWatchThresholdDown] = useState("250");
const [loadingExternalAlerts, setLoadingExternalAlerts] = useState(false);

// ── MANAGEMENT HUB ────────────────────────────────────────────
const [mgmtHubTab, setMgmtHubTab] = useState<"LEAGUE_MGMT" | "COMMISSIONER_TOOLS">("LEAGUE_MGMT");
// leagueMgmtData: { [leagueId]: { paid_2026, paid_2027, paid_2028, paid_2029, commissioner, year_in_advance, picks_traded } }
const [oppRosterTab, setOppRosterTab] = useState("QB");
const [oppRosterOwnerId, setOppRosterOwnerId] = useState<string>("");
const [oppRosterSearch, setOppRosterSearch] = useState("");
const [leagueMgmtData, setLeagueMgmtData] = useState<Record<string, Record<string, boolean>>>({});
// commPaymentsData: { [leagueId]: { [ownerId]: { paid_2026, paid_2027, paid_2028, paid_2029 } } }
const [commPaymentsData, setCommPaymentsData] = useState<Record<string, Record<string, Record<string, boolean>>>>({});
const [commToolsLeagueId, setCommToolsLeagueId] = useState<string>("");
const [commToolsRosters, setCommToolsRosters] = useState<any[]>([]);
const [commToolsUsers, setCommToolsUsers] = useState<Record<string, any>>({});
const [loadingCommToolsRosters, setLoadingCommToolsRosters] = useState(false);

// 🔥 BUILD FULL DRAFT BOARD (MATCHES PILLS)

const handleRankChange = (currentIndex: number, newRank: string) => {
  const rank = parseInt(newRank);
  
  if (!rank || rank < 1 || rank > rookies.length) return;

  const updated = [...rookies];
  const [moved] = updated.splice(currentIndex, 1);

  updated.splice(rank - 1, 0, moved);

  setRookies(updated);
};
 

// Ref so the rookie-board save effect can read the current user
// without adding supabaseUser as a dependency (which would cause it
// to fire on login and overwrite Supabase with stale localStorage data).
const supabaseUserRef = useRef<any>(null);
useEffect(() => { supabaseUserRef.current = supabaseUser; }, [supabaseUser]);
// Flag: once Supabase has provided the authoritative board, prevent
// the sheet/ADP load effect from overwriting it with localStorage data.
const rookieBoardSupabaseLoaded = useRef(false);
const alertStoreScope = supabaseUser?.id || "guest";
const watchlistStorageKey = `watchlists_v1_${alertStoreScope}`;
const alertStorageKey = `alerts_v1_${alertStoreScope}`;
const alertSnapshotStorageKey = `alertSnapshots_v1_${alertStoreScope}`;
const dismissedAlertStorageKey = `dismissedAlerts_v1_${alertStoreScope}`;
const alertBootstrapRef = useRef(false);
// Stable daily baseline for value-change alerts — loaded from Supabase, NOT localStorage.
// Separating this from the per-session localStorage snapshot prevents false "gaining/falling"
// alerts caused by FC API inconsistencies or stale cross-session snapshots.
const historicalSnapshotRef = useRef<{ players: Record<string, any>; recorded_at: string } | null>(null);
const latestAlertsRef = useRef<AlertsCenterItem[]>([]);
const latestDismissedAlertsRef = useRef<string[]>([]);

useEffect(() => { latestAlertsRef.current = dashboardAlerts; }, [dashboardAlerts]);
useEffect(() => { latestDismissedAlertsRef.current = dismissedAlertIds; }, [dismissedAlertIds]);

const refreshSupabaseUser = async () => {
  const { data } = await supabase.auth.getUser();
  console.log("refreshSupabaseUser", data.user ? data.user.email : "null");
  setSupabaseUser(data.user);
  if (!data.user) {
    setNotes([]);
  }
};

useEffect(() => {
  refreshSupabaseUser();
  const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
    // Use session directly — avoids a second async getUser() call that races with signOut state
    setSupabaseUser(session?.user ?? null);
    if (!session?.user) setNotes([]);
  });
  return () => subscription?.subscription?.unsubscribe?.();
}, []);

const loadNotes = async () => {
  if (!supabaseUser) { setNotes([]); return; }
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("user_id", supabaseUser.id)
    .order("updated_at", { ascending: false });
  if (error) setSupabaseError(error.message);
  else setNotes(data ?? []);
};

const hydrateAlertStateFromLocal = () => {
  try {
    const storedWatchlists = localStorage.getItem(watchlistStorageKey);
    if (storedWatchlists) setWatchlistEntries(JSON.parse(storedWatchlists));
  } catch {}

  try {
    const storedAlerts = localStorage.getItem(alertStorageKey);
    if (storedAlerts) setDashboardAlerts(JSON.parse(storedAlerts));
  } catch {}

  try {
    const storedDismissed = localStorage.getItem(dismissedAlertStorageKey);
    if (storedDismissed) setDismissedAlertIds(JSON.parse(storedDismissed));
  } catch {}
};

const mergeDashboardAlerts = (incoming: AlertsCenterItem[]) => {
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
};

const removeWatchlistEntry = async (playerId: string) => {
  const nextEntries = watchlistEntries.filter((entry) => entry.player_id !== playerId);
  setWatchlistEntries(nextEntries);
  localStorage.setItem(watchlistStorageKey, JSON.stringify(nextEntries));
  if (supabaseUser) {
    await supabase
      .from("watchlists")
      .delete()
      .eq("user_id", supabaseUser.id)
      .eq("player_id", playerId);
  }
};

const addWatchlistEntry = async (playerId: string) => {
  const player = (players as any)?.[playerId];
  if (!player?.full_name) return;

  const thresholdUp = Math.max(25, Number(watchThresholdUp) || 250);
  const thresholdDown = Math.max(25, Number(watchThresholdDown) || 250);
  const nextEntry: WatchlistEntry = {
    player_id: String(playerId),
    label: player.full_name,
    threshold_up: thresholdUp,
    threshold_down: thresholdDown,
    league_id: selectedLeague?.league_id || null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  const nextEntries = [
    nextEntry,
    ...watchlistEntries.filter((entry) => entry.player_id !== nextEntry.player_id),
  ].slice(0, 40);
  setWatchlistEntries(nextEntries);
  localStorage.setItem(watchlistStorageKey, JSON.stringify(nextEntries));
  setWatchlistSearch("");
  if (supabaseUser) {
    await supabase.from("watchlists").upsert(
      {
        user_id: supabaseUser.id,
        player_id: nextEntry.player_id,
        label: nextEntry.label,
        threshold_up: nextEntry.threshold_up,
        threshold_down: nextEntry.threshold_down,
        league_id: nextEntry.league_id,
        updated_at: nextEntry.updated_at,
      },
      { onConflict: "user_id,player_id" }
    );
  }
};

const dismissDashboardAlert = async (alertId: string) => {
  const nextDismissed = Array.from(new Set([...dismissedAlertIds, alertId]));
  setDismissedAlertIds(nextDismissed);
  localStorage.setItem(dismissedAlertStorageKey, JSON.stringify(nextDismissed));
  setDashboardAlerts((prev) =>
    prev.map((alert) => alert.id === alertId ? { ...alert, dismissed: true } : alert)
  );
  if (supabaseUser) {
    await supabase
      .from("alerts")
      .upsert(
        {
          user_id: supabaseUser.id,
          alert_id: alertId,
          dismissed: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,alert_id" }
      );
  }
};

useEffect(() => {
  hydrateAlertStateFromLocal();
}, [watchlistStorageKey, alertStorageKey, dismissedAlertStorageKey]);

// Load all Supabase-persisted user data whenever the logged-in user changes
useEffect(() => {
  if (!supabaseUser) return;
  // 1. Title/body note cards
  loadNotes();
  // 2. League notes (per-league textarea)
  supabase
    .from("league_notes")
    .select("league_id, content")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, string> = {};
        data.forEach((row: any) => { map[row.league_id] = row.content; });
        setLeagueNotes(map);
        localStorage.setItem("leagueNotes", JSON.stringify(map));
      }
    });
  // Rookie board is handled by the loadRookieBoard effect (depends on supabaseUser)
  // 3. League management checkboxes
  supabase
    .from("league_management")
    .select("*")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, Record<string, boolean>> = {};
        data.forEach((row: any) => {
          map[row.league_id] = {
            paid_2026: row.paid_2026,
            paid_2027: row.paid_2027,
            paid_2028: row.paid_2028,
            paid_2029: row.paid_2029,
            commissioner: row.commissioner,
            year_in_advance: row.year_in_advance,
            picks_traded: row.picks_traded,
          };
        });
        setLeagueMgmtData(map);
      }
    });
  // 4. Commissioner payments
  supabase
    .from("commissioner_payments")
    .select("*")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, Record<string, Record<string, boolean>>> = {};
        data.forEach((row: any) => {
          if (!map[row.league_id]) map[row.league_id] = {};
          map[row.league_id][row.owner_id] = {
            paid_2026: row.paid_2026,
            paid_2027: row.paid_2027,
            paid_2028: row.paid_2028,
            paid_2029: row.paid_2029,
          };
        });
        setCommPaymentsData(map);
      }
    });
  // 5. Watchlists
  supabase
    .from("watchlists")
    .select("*")
    .eq("user_id", supabaseUser.id)
    .order("updated_at", { ascending: false })
    .then(({ data, error }) => {
      if (error || !data) return;
      const rows = data.map((row: any) => ({
        player_id: String(row.player_id),
        label: row.label,
        threshold_up: Number(row.threshold_up || 250),
        threshold_down: Number(row.threshold_down || 250),
        league_id: row.league_id || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
      setWatchlistEntries(rows);
      localStorage.setItem(watchlistStorageKey, JSON.stringify(rows));
    });
  // 6. Alerts cache / dismissed state
  supabase
    .from("alerts")
    .select("*")
    .eq("user_id", supabaseUser.id)
    .order("updated_at", { ascending: false })
    .limit(80)
    .then(({ data, error }) => {
      if (error || !data) return;
      const rows = data.map((row: any) => ({
        id: row.alert_id,
        category: row.category || "watchlist",
        source: row.source || "internal",
        severity: row.severity || "low",
        title: row.title || "Saved alert",
        detail: row.detail || "",
        actionable: row.actionable !== false,
        timestamp: Number(new Date(row.updated_at || row.created_at || Date.now())),
        playerId: row.player_id || null,
        leagueId: row.league_id || null,
        link: row.payload?.link || null,
        payload: row.payload || {},
        dismissed: !!row.dismissed,
      })) as AlertsCenterItem[];
      setDashboardAlerts(rows);
      setDismissedAlertIds(rows.filter((row) => row.dismissed).map((row) => row.id));
      localStorage.setItem(alertStorageKey, JSON.stringify(rows));
      localStorage.setItem(
        dismissedAlertStorageKey,
        JSON.stringify(rows.filter((row) => row.dismissed).map((row) => row.id))
      );
    });
  // 7. Daily player value snapshot — stable baseline for climbing/falling alerts
  supabase
    .from("player_value_snapshots")
    .select("snapshot, recorded_at")
    .eq("user_id", supabaseUser.id)
    .single()
    .then(({ data }) => {
      if (data?.snapshot) {
        historicalSnapshotRef.current = { players: data.snapshot, recorded_at: data.recorded_at };
      }
    });
  // 8. Player notes (Supabase overrides localStorage)
  supabase
    .from("player_notes")
    .select("player_id, note")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, string> = {};
        data.forEach((row: any) => { map[String(row.player_id)] = row.note; });
        setPlayerNotes((prev) => {
          const merged = { ...prev, ...map };
          try { localStorage.setItem("playerNotes_v1", JSON.stringify(merged)); } catch {}
          return merged;
        });
      }
    });
  // 8. Player dispositions
  supabase
    .from("player_dispositions")
    .select("player_id, sell, buy")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, { sell: string; buy: string }> = {};
        data.forEach((row: any) => { map[String(row.player_id)] = { sell: row.sell, buy: row.buy }; });
        setPlayerDispositions((prev) => {
          const merged = { ...prev, ...map };
          try { localStorage.setItem("playerDispositions_v1", JSON.stringify(merged)); } catch {}
          return merged;
        });
      }
    });
}, [supabaseUser]);

const signUp = async () => {
  setSupabaseError("");
  const { error } = await supabase.auth.signUp({ email: loginEmail, password: loginPassword });
  if (error) setSupabaseError(error.message);
};

const signIn = async () => {
  setSupabaseError("");
  setLoginLoading(true);
  try {
    const signInPromise = supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out — check your internet or Supabase project status.")), 10000)
    );
    const { data, error } = await Promise.race([signInPromise, timeoutPromise]);
    if (error) {
      setSupabaseError(error.message || error.name || "Sign-in failed. Check your credentials.");
      return;
    }
    if (data?.user) {
      // Don't manually set supabaseUser here — onAuthStateChange fires and sets it,
      // and the useEffect([supabaseUser]) will load all persisted data once state updates.
      setLoginEmail("");
      setLoginPassword("");
    } else {
      setSupabaseError("Sign-in failed — no user returned. Check your credentials or confirm your email.");
    }
  } catch (err: any) {
    setSupabaseError(err?.message || "Unexpected error — check your internet connection.");
  } finally {
    setLoginLoading(false);
  }
};

const signOut = async () => {
  await supabase.auth.signOut();
  // onAuthStateChange will fire and set supabaseUser to null, but also set it
  // explicitly here so the UI updates immediately without waiting for the event
  setSupabaseUser(null);
  setNotes([]);
  setLeagueNotes({});
  setLeagueMgmtData({});
  setCommPaymentsData({});
  setWatchlistEntries([]);
  setDashboardAlerts([]);
  setDismissedAlertIds([]);
  setCommToolsLeagueId("");
  setCommToolsRosters([]);
  setCommToolsUsers({});
  setLoginEmail("");
  setLoginPassword("");
  setLoginLoading(false);
  setSupabaseError("");
  rookieBoardSupabaseLoaded.current = false;
  // Clear localStorage user-specific data so next user starts fresh
  localStorage.removeItem("leagueNotes");
  localStorage.removeItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`);
  localStorage.removeItem(ROOKIE_BOARD_RESET_KEY);
  localStorage.removeItem(watchlistStorageKey);
  localStorage.removeItem(alertStorageKey);
  localStorage.removeItem(alertSnapshotStorageKey);
  localStorage.removeItem(dismissedAlertStorageKey);
  // Disconnect Sleeper so the app returns fully to the logged-out state
  disconnectSleeper();
};

const createNote = async () => {
  if (!supabaseUser || !noteTitle.trim()) return;
  const { error } = await supabase.from("notes").insert([{
    user_id: supabaseUser.id,
    title: noteTitle,
    body: noteBody,
  }]);
  if (error) setSupabaseError(error.message);
  else { setNoteTitle(""); setNoteBody(""); loadNotes(); }
};

const deleteNote = async (id: string) => {
  const { error } = await supabase
    .from("notes")
    .delete()
    .eq("id", id)
    .eq("user_id", supabaseUser.id);
  if (error) setSupabaseError(error.message);
  else loadNotes();
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
        fetchFantasyCalcValues(2).then(({ pickValues }) => setPickFcValues(pickValues)).catch(() => {});
        return;
      }
    }

    const res = await fetch("https://api.sleeper.app/v1/players/nfl");
    const data = await res.json();

    const { playerValues: fcValues, pickValues } = await fetchFantasyCalcValues(2);
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
  if ((tradeHubSection === "CALCULATOR" || tradeHubSection === "FINDER" || tradeHubSection === "RECOMMENDATIONS") && selectedLeague?.league_id) {
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

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "POWER_RANKINGS" && selectedLeague?.league_id) {
    loadCalcValues(selectedLeague.league_id);
    loadRedraftValues();
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "ACTIVITY" && selectedLeague?.league_id) {
    setActivityTransactions([]);
    loadActivity(selectedLeague.league_id);
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "DRAFT_BOARD" && selectedLeague?.league_id) {
    refreshDraftBoard();
    // Load owner tendencies in the background — non-blocking
    if (rosters.length) loadOwnerTendencies();
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id, rosters.length]);

// Load leaguemate trade alerts once rosters + user display names are ready.
// Uses Object.keys(users).length as the readiness signal since users is set
// right after rosters during league selection.
useEffect(() => {
  if (!rosters.length || !Object.keys(users).length || !user?.user_id) return;
  loadLeaguemateTradeAlerts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [rosters.length, Object.keys(users).length]);

// Auto-load data needed by the player profile panel whenever it opens
useEffect(() => {
  if (!playerProfileId) return;
  if (Object.keys(redraftValues).length === 0) loadRedraftValues();
  if (!leagueOverviewLoaded && leagues.length > 0 && user) loadLeagueOverview();
}, [playerProfileId, leagues.length, user?.user_id]);

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "SIMULATOR") {
    loadNflState();
    loadRedraftValues();
    const isRegularSeason = nflState?.season_type === "regular" && (nflState?.week ?? 0) > 0;
    const simulatorProjectionWeek = isRegularSeason ? Number(nflState?.week) : 0;
    if (projectionWeek !== simulatorProjectionWeek) {
      setProjectionWeek(simulatorProjectionWeek);
      setProjectionLoaded(false);
      loadProjections(simulatorProjectionWeek === 0 ? "season" : simulatorProjectionWeek);
    } else if (!projectionLoaded) {
      loadProjections(simulatorProjectionWeek === 0 ? "season" : simulatorProjectionWeek);
    }
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id, nflState?.week, nflState?.season_type]);

useEffect(() => {
  if (mainTab !== "GAMEDAY_HUB") return;
  loadNflState();
}, [mainTab]);

useEffect(() => {
  const isRegularSeason = nflState?.season_type === "regular" && Number(nflState?.week || 0) > 0;
  const currentWeek = isRegularSeason ? Number(nflState?.week) : 0;

  if (mainTab !== "GAMEDAY_HUB" || !selectedLeague?.league_id || !currentWeek) {
    if (mainTab === "GAMEDAY_HUB" && !currentWeek) {
      setGamedayMatchups([]);
      setSelectedGamedayMatchupId(null);
    }
    return;
  }

  if (projectionWeek !== currentWeek) {
    setProjectionWeek(currentWeek);
    setProjectionLoaded(false);
    loadProjections(currentWeek);
  } else if (!projectionLoaded) {
    loadProjections(currentWeek);
  }

  loadGamedayMatchups(selectedLeague.league_id, currentWeek);
}, [mainTab, selectedLeague?.league_id, nflState?.week, nflState?.season_type]);

useEffect(() => {
  const leagueId = selectedLeague?.league_id;
  if (mainTab !== "LEAGUES" || leagueHubTab !== "SIMULATOR" || !leagueId) return;
  const isRegularSeason = nflState?.season_type === "regular" && (nflState?.week ?? 0) > 0;
  if (!isRegularSeason) return;
  if (leagueWeeklyMatchups[leagueId]) return;

  let cancelled = false;

  const loadLeagueWeeklyHistory = async () => {
    const regularSeasonWeeks = Math.max(1, Number(selectedLeague?.settings?.playoff_week_start || 15) - 1);
    if (regularSeasonWeeks <= 0) return;

    setLoadingLeagueWeeklyMatchups(true);
    try {
      const weeks = Array.from({ length: regularSeasonWeeks }, (_, idx) => idx + 1);
      const results = await Promise.all(
        weeks.map(async (week) => {
          const data = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`)
            .then((r) => r.json())
            .catch(() => []);
          return {
            week,
            matchups: Array.isArray(data) ? data : [],
          };
        })
      );
      if (!cancelled) {
        setLeagueWeeklyMatchups((prev) => ({
          ...prev,
          [leagueId]: results,
        }));
      }
    } finally {
      if (!cancelled) setLoadingLeagueWeeklyMatchups(false);
    }
  };

  loadLeagueWeeklyHistory();
  return () => { cancelled = true; };
}, [mainTab, leagueHubTab, selectedLeague?.league_id, selectedLeague?.settings?.playoff_week_start, nflState?.week, nflState?.season_type, leagueWeeklyMatchups]);

useEffect(() => {
  if (!selectedLeague?.league_id || !rosters.length || !Object.keys(players || {}).length) {
    setLeagueMateTradeIntel({});
    return;
  }

  let cancelled = false;

  const loadLeagueMateIntel = async () => {
    setLoadingLeagueMateIntel(true);
    try {
      const [t1, t2] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${selectedLeague.league_id}/transactions/1`).then((r) => r.json()).catch(() => []),
        fetch(`https://api.sleeper.app/v1/league/${selectedLeague.league_id}/transactions/2`).then((r) => r.json()).catch(() => []),
      ]);

      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const rosterStats: Record<string, any> = {};
      const ensureRoster = (rosterId: number | string) => {
        const key = String(rosterId);
        if (!rosterStats[key]) {
          rosterStats[key] = {
            tradeCount30d: 0,
            bought: { QB: 0, RB: 0, WR: 0, TE: 0 },
            picksIn: 0,
            picksOut: 0,
            lastTradeAt: null,
          };
        }
        return rosterStats[key];
      };

      [...(Array.isArray(t1) ? t1 : []), ...(Array.isArray(t2) ? t2 : [])]
        .filter((trade: any) => trade?.type === "trade" && trade?.status === "complete" && Number(trade?.created || 0) >= thirtyDaysAgo)
        .forEach((trade: any) => {
          (trade.roster_ids || []).forEach((rosterId: number) => {
            const entry = ensureRoster(rosterId);
            entry.tradeCount30d += 1;
            entry.lastTradeAt = Math.max(entry.lastTradeAt || 0, Number(trade.created || 0));
          });

          Object.entries(trade.adds || {}).forEach(([playerId, rosterId]: any) => {
            const pos = (players as any)?.[playerId]?.position;
            if (!["QB", "RB", "WR", "TE"].includes(pos)) return;
            const entry = ensureRoster(rosterId);
            entry.bought[pos] = (entry.bought[pos] || 0) + 1;
          });

          (trade.draft_picks || []).forEach((pick: any) => {
            if (pick?.owner_id != null) ensureRoster(pick.owner_id).picksIn += 1;
            if (pick?.previous_owner_id != null) ensureRoster(pick.previous_owner_id).picksOut += 1;
          });
        });

      if (!cancelled) setLeagueMateTradeIntel(rosterStats);
    } finally {
      if (!cancelled) setLoadingLeagueMateIntel(false);
    }
  };

  loadLeagueMateIntel();
  return () => { cancelled = true; };
}, [selectedLeague?.league_id, rosters, players]);

useEffect(() => {
  if (!supabaseUser || !selectedLeague?.league_id) return;
  supabase
    .from("leaguemate_profiles")
    .select("profiles")
    .eq("user_id", supabaseUser.id)
    .eq("league_id", selectedLeague.league_id)
    .single()
    .then(({ data, error }) => {
      if (error || !data?.profiles || !Array.isArray(data.profiles)) return;
      setLeagueMateProfileCache((prev) => ({
        ...prev,
        [selectedLeague.league_id]: data.profiles,
      }));
    });
}, [supabaseUser?.id, selectedLeague?.league_id]);

// Load cached simulation results from Supabase for the League Overview playoff% column.
useEffect(() => {
  if (!supabaseUser) return;
  supabase
    .from("league_simulations")
    .select("league_id,roster_id,playoff_odds,title_odds,expected_wins,avg_finish,finish_range,computed_at")
    .eq("user_id", supabaseUser.id)
    .then(({ data }) => {
      if (!data?.length) return;
      const byLeague: Record<string, Record<number, any>> = {};
      data.forEach((row: any) => {
        if (!byLeague[row.league_id]) byLeague[row.league_id] = {};
        byLeague[row.league_id][Number(row.roster_id)] = row;
      });
      setLeagueSimCache(byLeague);
    });
}, [supabaseUser?.id]);

// Load saved draft slot picks — localStorage first (instant), Supabase as source-of-truth if available
useEffect(() => {
  if (!selectedLeague?.league_id) return;
  // Always clear picks when switching leagues — each league has its own set
  setMyDraftSlotPicks({});
  const lsKey = `draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`;
  // Restore this league's picks from localStorage immediately
  const saved = localStorage.getItem(lsKey);
  if (saved) {
    try { setMyDraftSlotPicks(JSON.parse(saved)); } catch {}
  }
  // Then try Supabase as authoritative source (overwrites localStorage if data exists)
  if (!supabaseUser) return;
  supabase
    .from("draft_board_picks")
    .select("pick_slot,player_id")
    .eq("user_id", supabaseUser.id)
    .eq("league_id", selectedLeague.league_id)
    .eq("season", ROOKIE_YEAR)
    .then(({ data }) => {
      if (!data?.length) return;
      const picks: Record<string, string> = {};
      data.forEach((row: any) => { picks[row.pick_slot] = row.player_id; });
      setMyDraftSlotPicks(picks);
      localStorage.setItem(lsKey, JSON.stringify(picks));
    });
}, [supabaseUser?.id, selectedLeague?.league_id]);

// Save draft slot picks — localStorage immediately, Supabase async (best-effort)
useEffect(() => {
  if (!selectedLeague?.league_id || !Object.keys(myDraftSlotPicks).length) return;
  const lsKey = `draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`;
  localStorage.setItem(lsKey, JSON.stringify(myDraftSlotPicks));
  if (!supabaseUser) return;
  const rows = Object.entries(myDraftSlotPicks).map(([pick_slot, player_id]) => ({
    user_id: supabaseUser.id,
    league_id: selectedLeague.league_id,
    season: ROOKIE_YEAR,
    pick_slot,
    player_id,
    updated_at: new Date().toISOString(),
  }));
  supabase
    .from("draft_board_picks")
    .upsert(rows, { onConflict: "user_id,league_id,season,pick_slot" })
    .then(() => {}); // table may not exist yet — localStorage handles persistence
}, [supabaseUser?.id, selectedLeague?.league_id, myDraftSlotPicks]);

useEffect(() => {
  const shouldLoadCrossLeagueIntel =
    !!selectedLeague?.league_id &&
    !!rosters.length &&
    !!user?.user_id &&
    !!Object.keys(players || {}).length &&
    (
      (mainTab === "LEAGUES" && leagueHubTab === "LEAGUE_MATES") ||
      (mainTab === "TRADE_HUB" && (tradeHubSection === "FINDER" || tradeHubSection === "RECOMMENDATIONS"))
    );

  if (!shouldLoadCrossLeagueIntel) return;

  const ownerIds = rosters
    .filter((r: any) => r.owner_id && r.owner_id !== user?.user_id)
    .map((r: any) => String(r.owner_id));
  const missingOwnerIds = ownerIds.filter((ownerId) => !crossLeagueMateIntel[ownerId]);
  if (missingOwnerIds.length === 0) return;

  let cancelled = false;

  const loadCrossLeagueMateIntel = async () => {
    setLoadingCrossLeagueMateIntel(true);
    try {
      const entries = await Promise.all(
        missingOwnerIds.map(async (ownerId) => {
          const ownerLeagues = await fetch(`https://api.sleeper.app/v1/user/${ownerId}/leagues/nfl/${CURRENT_YEAR}`)
            .then((r) => r.json())
            .then((data) => Array.isArray(data) ? data : [])
            .catch(() => []);

          const dynastyLeagues = ownerLeagues.filter((league: any) =>
            ((league.settings?.taxi_slots ?? 0) > 0 || (league.roster_positions?.length ?? 0) > 20) &&
            (league.settings?.best_ball ?? 0) === 0
          );

          const rosterResults = await Promise.all(
            dynastyLeagues.map(async (league: any) => {
              const leagueRosters = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`)
                .then((r) => r.json())
                .catch(() => []);
              return (Array.isArray(leagueRosters) ? leagueRosters : []).find((roster: any) => String(roster.owner_id) === ownerId) || null;
            })
          );

          const tradeLeagueResults = await Promise.all(
            dynastyLeagues.map(async (league: any) => {
              const [leagueRosters, t1, t2, draftsData] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then((r) => r.json()).catch(() => []),
                fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/1`).then((r) => r.json()).catch(() => []),
                fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/2`).then((r) => r.json()).catch(() => []),
                fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then((r) => r.json()).catch(() => []),
              ]);
              const ownerRoster = (Array.isArray(leagueRosters) ? leagueRosters : []).find((roster: any) => String(roster.owner_id) === ownerId) || null;
              return {
                ownerRoster,
                trades: [...(Array.isArray(t1) ? t1 : []), ...(Array.isArray(t2) ? t2 : [])],
                draftsData: Array.isArray(draftsData) ? draftsData : [],
              };
            })
          );

          const ownedPlayerCounts: Record<string, number> = {};
          const ownedPositionCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
          const allSkillPlayers: any[] = [];
          const acquiredPositionCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
          const acquiredPlayerCounts: Record<string, number> = {};
          let crossLeagueTradeCount30d = 0;
          let crossLeaguePickBuys30d = 0;
          let crossLeaguePickSells30d = 0;
          let youngQbWrBuys = 0;
          let veteranRbBuys = 0;
          let totalSkillBuys = 0;

          rosterResults.filter(Boolean).forEach((ownerRoster: any) => {
            (ownerRoster.players || []).forEach((playerId: string) => {
              const player = (players as any)?.[playerId];
              if (!player || !["QB", "RB", "WR", "TE"].includes(player.position)) return;
              ownedPlayerCounts[playerId] = (ownedPlayerCounts[playerId] || 0) + 1;
              ownedPositionCounts[player.position] = (ownedPositionCounts[player.position] || 0) + 1;
              allSkillPlayers.push(player);
            });
          });

          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
          tradeLeagueResults.forEach(({ ownerRoster, trades, draftsData }: any) => {
            if (!ownerRoster) return;
            const startupDraft = draftsData
              .filter((d: any) => (d.settings?.rounds ?? 0) > 6)
              .sort((a: any, b: any) => (b.settings?.rounds ?? 0) - (a.settings?.rounds ?? 0))[0];
            const startupStart = startupDraft?.start_time ?? 0;
            const startupEnd = startupDraft?.last_picked
              ?? (startupStart ? startupStart + 60 * 24 * 60 * 60 * 1000 : 0);

            trades
              .filter((trade: any) =>
                trade?.type === "trade" &&
                trade?.status === "complete" &&
                Number(trade?.created || 0) >= thirtyDaysAgo &&
                (trade.roster_ids || []).includes(ownerRoster.roster_id) &&
                !(startupStart > 0 && trade.created >= startupStart && trade.created <= startupEnd)
              )
              .forEach((trade: any) => {
                crossLeagueTradeCount30d += 1;

                Object.entries(trade.adds || {}).forEach(([playerId, rosterId]: any) => {
                  if (Number(rosterId) !== Number(ownerRoster.roster_id)) return;
                  const player = (players as any)?.[playerId];
                  if (!player || !["QB", "RB", "WR", "TE"].includes(player.position)) return;
                  acquiredPositionCounts[player.position] = (acquiredPositionCounts[player.position] || 0) + 1;
                  acquiredPlayerCounts[String(playerId)] = (acquiredPlayerCounts[String(playerId)] || 0) + 1;
                  totalSkillBuys += 1;
                  if (["QB", "WR"].includes(player.position) && Number(player.age || 99) <= 24) youngQbWrBuys += 1;
                  if (player.position === "RB" && Number(player.age || 0) >= 26) veteranRbBuys += 1;
                });

                (trade.draft_picks || []).forEach((pick: any) => {
                  if (Number(pick?.owner_id) === Number(ownerRoster.roster_id)) crossLeaguePickBuys30d += 1;
                  if (Number(pick?.previous_owner_id) === Number(ownerRoster.roster_id)) crossLeaguePickSells30d += 1;
                });
              });
          });

          const totalSkillPlayers = allSkillPlayers.length || 1;
          const sortedPositions = Object.entries(ownedPositionCounts)
            .sort((a: any, b: any) => b[1] - a[1])
            .map(([pos]) => pos);
          const tradePreferredPositions = Object.entries(acquiredPositionCounts)
            .filter(([, count]: any) => count > 0)
            .sort((a: any, b: any) => b[1] - a[1])
            .map(([pos]) => pos);
          const repeatedPlayers = Object.entries(ownedPlayerCounts)
            .map(([playerId, count]) => {
              const player = (players as any)?.[playerId];
              return player ? { playerId, count, name: player.full_name, position: player.position } : null;
            })
            .filter(Boolean)
            .sort((a: any, b: any) => b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, 3);
          const acquiredPlayers = Object.entries(acquiredPlayerCounts)
            .map(([playerId, count]) => {
              const player = (players as any)?.[playerId];
              return player ? { playerId, count, name: player.full_name, position: player.position } : null;
            })
            .filter(Boolean)
            .sort((a: any, b: any) => b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, 3);
          const averageAgeAllLeagues = average(
            allSkillPlayers.map((player: any) => Number(player.age)).filter(Boolean)
          );
          const youngQbWrRate = allSkillPlayers.filter((player: any) =>
            ["QB", "WR"].includes(player.position) && Number(player.age || 99) <= 24
          ).length / totalSkillPlayers;
          const veteranRbRate = allSkillPlayers.filter((player: any) =>
            player.position === "RB" && Number(player.age || 0) >= 26
          ).length / totalSkillPlayers;
          const youngQbWrBuyRate = totalSkillBuys > 0 ? youngQbWrBuys / totalSkillBuys : 0;
          const veteranRbBuyRate = totalSkillBuys > 0 ? veteranRbBuys / totalSkillBuys : 0;
          const topPos = sortedPositions[0] || "WR";
          const secondPos = sortedPositions[1] || "QB";
          const preferenceLabel =
            youngQbWrRate >= 0.22 ? "Youth-skewed investor" :
            veteranRbRate >= 0.12 ? "Veteran production buyer" :
            `${topPos}-leaning portfolio`;
          const tradePreferenceLabel =
            crossLeagueTradeCount30d === 0 ? "No meaningful 30d trade history" :
            youngQbWrBuyRate >= 0.2 ? "Actively buying young QB/WR insulation" :
            veteranRbBuyRate >= 0.15 ? "Actively buying veteran RB points" :
            tradePreferredPositions[0] ? `Recent ${tradePreferredPositions[0]} buyer` :
            "Recent cross-league trade activity";
          const repeatedNames = repeatedPlayers.filter((player: any) => player.count >= 2).map((player: any) => player.name);
          const crossLeagueSummary = repeatedNames.length > 0
            ? `Across ${dynastyLeagues.length} dynasty leagues, leans ${topPos}/${secondPos} and repeatedly holds ${repeatedNames.join(", ")}.`
            : `Across ${dynastyLeagues.length} dynasty leagues, leans ${topPos}/${secondPos} with an average skill-player age of ${averageAgeAllLeagues || "-"}.`;
          const acquiredNames = acquiredPlayers.filter((player: any) => player.count >= 2).map((player: any) => player.name);
          const crossLeagueTradeSummary =
            crossLeagueTradeCount30d === 0
              ? "No strong cross-league trade tendency in the last 30 days."
              : acquiredNames.length > 0
              ? `Over the last 30 days, they made ${crossLeagueTradeCount30d} cross-league trades and kept buying ${acquiredNames.join(", ")}.`
              : `Over the last 30 days, they made ${crossLeagueTradeCount30d} cross-league trades, leaning ${tradePreferredPositions.slice(0, 2).join("/") || "best-player"} while moving picks ${crossLeaguePickBuys30d}-${crossLeaguePickSells30d}.`;

          return [
            ownerId,
            {
              totalDynastyLeagues: dynastyLeagues.length,
              ownedPositionCounts,
              preferredPositions: sortedPositions.slice(0, 2),
              repeatedPlayers,
              averageAgeAllLeagues,
              youngQbWrRate,
              veteranRbRate,
              tradePreferredPositions: tradePreferredPositions.slice(0, 2),
              acquiredPlayers,
              crossLeagueTradeCount30d,
              crossLeaguePickBuys30d,
              crossLeaguePickSells30d,
              youngQbWrBuyRate,
              veteranRbBuyRate,
              preferenceLabel,
              tradePreferenceLabel,
              crossLeagueSummary,
              crossLeagueTradeSummary,
            },
          ] as const;
        })
      );

      if (!cancelled) {
        setCrossLeagueMateIntel((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      }
    } finally {
      if (!cancelled) setLoadingCrossLeagueMateIntel(false);
    }
  };

  loadCrossLeagueMateIntel();
  return () => { cancelled = true; };
}, [selectedLeague?.league_id, rosters, user?.user_id, players, mainTab, leagueHubTab, tradeHubSection, crossLeagueMateIntel]);

// League notes — load from localStorage on mount (fast), then override with Supabase on login
useEffect(() => {
  const saved = localStorage.getItem("leagueNotes");
  if (saved) setLeagueNotes(JSON.parse(saved));
}, []);

const saveLeagueNote = async (leagueId: string, text: string) => {
  const updated = { ...leagueNotes, [leagueId]: text };
  setLeagueNotes(updated);
  localStorage.setItem("leagueNotes", JSON.stringify(updated));
  if (supabaseUser) {
    await supabase.from("league_notes").upsert(
      { user_id: supabaseUser.id, league_id: leagueId, content: text, updated_at: new Date().toISOString() },
      { onConflict: "user_id,league_id" }
    );
  }
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
    localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(rookies));
    const user = supabaseUserRef.current;
    if (user) {
      // Save just the ordered names — small payload, easy to apply to any canonical board
      const orderedNames = rookies.map((r: any) => r.name);
      supabase.from("rookie_board").upsert(
        { user_id: user.id, year: ROOKIE_BOARD_VERSION, players: orderedNames, updated_at: new Date().toISOString() },
        { onConflict: "user_id,year" }
      ).then(({ error }: { error: any }) => {
        if (error) console.error("rookie_board save failed:", error.message, error.code);
      });
    }
  }
}, [rookies]); // intentionally omits supabaseUser — use ref to avoid overwriting Supabase on login
// Single effect handles all rookie board loading.
// Runs on mount AND whenever supabaseUser changes (login/logout).
// Order of preference: Supabase (if logged in) > localStorage > ADP default.
useEffect(() => {
const loadRookieBoard = async () => {
    // 1. Fetch sheet, Sleeper ADP (for metadata), and FC Superflex (2QB) raw data in parallel
    const [sheetText, adpResponse, fcRaw] = await Promise.all([
      fetch(ROOKIE_BOARD_SHEET_URL).then((res) => res.text()),
      fetch(ROOKIE_BOARD_ADP_URL).then((res) => res.json()).catch(() => []),
      fetch(`https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1`)
        .then((res) => res.json()).catch(() => []),
    ]);

    // Build name → FC value map (name-based to avoid pre-draft Sleeper ID mismatches)
    const fcByName = new Map<string, number>();
    if (Array.isArray(fcRaw)) {
      fcRaw.forEach((entry: any) => {
        if (entry.player?.position === "PICK") return;
        const fullName = entry.player?.name || `${entry.player?.firstName || ""} ${entry.player?.lastName || ""}`.trim();
        if (fullName && typeof entry.value === "number") {
          fcByName.set(normalizeRookieName(fullName), entry.value);
        }
      });
    }

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

    // Sleeper ADP only used for player_id, position, team metadata — NOT for sort order
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
        const norm = normalizeRookieName(player.name);
        const adpPlayer = adpByName.get(norm);
        return {
          player_id: adpPlayer?.player_id || null,
          name: adpPlayer?.name || player.name,
          position: adpPlayer?.position || player.position,
          team: adpPlayer?.team || "",
          adp: typeof adpPlayer?.adp === "number" ? adpPlayer.adp : Number.MAX_SAFE_INTEGER,
          // Match FC value by name — avoids pre-draft Sleeper ID mismatch
          fcValue: fcByName.get(norm) ?? fcByName.get(normalizeRookieName(adpPlayer?.name || "")) ?? 0,
        };
      })
      // Sort by FantasyCalc Superflex dynasty value (descending). Falls back to Sleeper ADP then name.
      .sort((a, b) => {
        if (b.fcValue !== a.fcValue) return b.fcValue - a.fcValue;
        if (a.adp !== b.adp) return a.adp - b.adp;
        return a.name.localeCompare(b.name);
      });

    // 2. Try Supabase for saved order (if logged in) — isolated try/catch so a network
    //    error here doesn't abort the whole function and leave rookies state stale.
    if (supabaseUser) {
      try {
        const { data, error } = await supabase
          .from("rookie_board")
          .select("players")
          .eq("user_id", supabaseUser.id)
          .eq("year", ROOKIE_BOARD_VERSION)
          .single();
        if (!error && data?.players && Array.isArray(data.players) && data.players.length > 0) {
          const orderMap = new Map<string, number>(
            (data.players as string[]).map((name, i) => [normalizeRookieName(name), i])
          );
          const ordered = [...canonicalBoard].sort((a, b) => {
            const ia = orderMap.get(normalizeRookieName(a.name)) ?? 9999;
            const ib = orderMap.get(normalizeRookieName(b.name)) ?? 9999;
            if (ia !== ib) return ia - ib;
            if (b.fcValue !== a.fcValue) return b.fcValue - a.fcValue;
            return a.adp - b.adp;
          });
          localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(ordered));
          setRookies(ordered);
          return;
        }
      } catch {
        // Supabase unreachable — fall through to localStorage / FC default
      }
    }

    // 3. Fall back to localStorage order
    const saved = localStorage.getItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`);
    const hasReset = localStorage.getItem(ROOKIE_BOARD_RESET_KEY) === "true";

    if (!hasReset || !saved) {
      setRookies(canonicalBoard);
      localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(canonicalBoard));
      localStorage.setItem(ROOKIE_BOARD_RESET_KEY, "true");
      return;
    }

    const savedNames: string[] = JSON.parse(saved).map((p: any) =>
      typeof p === "string" ? p : p.name
    );
    const canonicalNames = new Set(canonicalBoard.map((p) => normalizeRookieName(p.name)));
    const validSaved = savedNames.filter((n) => canonicalNames.has(normalizeRookieName(n)));
    const orderMap = new Map(validSaved.map((name, i) => [normalizeRookieName(name), i]));
    const merged = [...canonicalBoard].sort((a, b) => {
      const ia = orderMap.get(normalizeRookieName(a.name)) ?? 9999;
      const ib = orderMap.get(normalizeRookieName(b.name)) ?? 9999;
      if (ia !== ib) return ia - ib;
      // New players not in saved order: sort by FC value then ADP
      if (b.fcValue !== a.fcValue) return b.fcValue - a.fcValue;
      return a.adp - b.adp;
    });

    localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(merged));
    setRookies(merged);
  };

  loadRookieBoard().catch(() => {});
}, [supabaseUser?.id]); // use ID not object — prevents re-runs when auth refreshes recreate the user object
useEffect(() => {
  return;
  if (Object.keys(players).length === 0) return;

  const sleeperBoard = buildSleeperRookieBoard(players);
  const hasReset = localStorage.getItem(ROOKIE_BOARD_RESET_KEY) === "true";

  if (!hasReset) {
    setRookies(sleeperBoard);
    localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(sleeperBoard));
    localStorage.setItem(ROOKIE_BOARD_RESET_KEY, "true");
    return;
  }

  const saved = localStorage.getItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`);

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

  localStorage.setItem(`rookieBoard_${ROOKIE_BOARD_VERSION}`, JSON.stringify(merged));
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

// Load historical rookie draft tendencies for every owner in the current league.
// Uses the PREVIOUS year's completed rookie drafts (≤5 rounds) so data is available
// Prefers current ROOKIE_YEAR completed drafts; falls back to prior year if none exist yet.
// Automatically uses the right year once current-year drafts start completing.
const loadOwnerTendencies = async () => {
  if (!rosters.length) return;
  const PREV_YEAR = String(Number(ROOKIE_YEAR) - 1);
  const ownerUserIds: string[] = (rosters as any[])
    .map((r: any) => r.owner_id)
    .filter((uid: string) => uid && uid !== user?.user_id);
  if (!ownerUserIds.length) return;

  const tendencies: Record<string, Record<string, number>> = {};

  // ── 1. Pull everything we already have from Supabase cache ──────────────
  const { data: cached } = await supabase
    .from("owner_tendencies")
    .select("owner_user_id, season, rates, updated_at")
    .in("owner_user_id", ownerUserIds)
    .in("season", [ROOKIE_YEAR, PREV_YEAR]);

  // Build a map: userId → best cached row
  // Prefer ROOKIE_YEAR over PREV_YEAR; within same season prefer most recent
  const cacheMap: Record<string, { rates: Record<string, number>; updated_at: string; season: string }> = {};
  (cached ?? []).forEach((row: any) => {
    const existing = cacheMap[row.owner_user_id];
    const rowBetter =
      !existing ||
      (row.season === ROOKIE_YEAR && existing.season !== ROOKIE_YEAR) ||
      (row.season === existing.season && row.updated_at > existing.updated_at);
    if (rowBetter) cacheMap[row.owner_user_id] = { rates: row.rates, updated_at: row.updated_at, season: row.season };
  });

  // Prior-year cache never expires (those drafts are done).
  // Current-year cache is good for 24 h while drafts are still rolling in.
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const needsFetch: string[] = [];
  ownerUserIds.forEach((userId) => {
    const c = cacheMap[userId];
    if (c) {
      const fresh = c.season === PREV_YEAR || (now - new Date(c.updated_at).getTime()) < CACHE_TTL_MS;
      if (fresh) { tendencies[userId] = c.rates; return; }
    }
    needsFetch.push(userId);
  });

  if (!needsFetch.length) { setOwnerDraftTendencies(tendencies); return; }

  // ── 2. Fetch from Sleeper for owners without a fresh cache entry ─────────
  const newRows: any[] = [];

  await Promise.all(needsFetch.map(async (userId: string) => {
    try {
      const yearsToTry = [ROOKIE_YEAR, PREV_YEAR];
      const collected: { round: number; position: string }[] = [];
      let foundSeason = PREV_YEAR;

      for (const year of yearsToTry) {
        const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/${year}`);
        const leagues = await leaguesRes.json();
        if (!Array.isArray(leagues)) continue;

        // No cap — scan all leagues for the most accurate picture
        await Promise.all(leagues.map(async (league: any) => {
          try {
            const draftsRes = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`);
            const drafts = await draftsRes.json();
            const rookieDraft = (drafts as any[]).find(
              (d: any) =>
                d.season === year &&
                d.status === "complete" &&
                (d.settings?.rounds ?? 99) <= 5
            );
            if (!rookieDraft) return;
            const picksRes = await fetch(`https://api.sleeper.app/v1/draft/${rookieDraft.draft_id}/picks`);
            const picks = await picksRes.json();
            (picks as any[])
              .filter((p: any) => p.picked_by === userId && p.metadata?.position)
              .forEach((p: any) => {
                collected.push({ round: Number(p.round), position: String(p.metadata.position) });
              });
          } catch {}
        }));

        if (collected.length >= 3) { foundSeason = year; break; }
      }

      if (collected.length < 3) return; // not enough history to be meaningful

      // Weight: R1 = 3×, R2 = 2×, later = 1× (early picks are most deliberate)
      const weighted: Record<string, number> = {};
      let totalWeight = 0;
      collected.forEach(({ round, position }) => {
        const w = round === 1 ? 3 : round === 2 ? 2 : 1;
        weighted[position] = (weighted[position] || 0) + w;
        totalWeight += w;
      });

      const rates: Record<string, number> = {};
      Object.keys(weighted).forEach((pos) => { rates[pos] = weighted[pos] / totalWeight; });

      tendencies[userId] = rates;
      newRows.push({
        owner_user_id: userId,
        season: foundSeason,
        rates,
        pick_count: collected.length,
        updated_at: new Date().toISOString(),
      });
    } catch {}
  }));

  // ── 3. Persist newly fetched data so next load hits cache ────────────────
  if (newRows.length) {
    supabase.from("owner_tendencies")
      .upsert(newRows, { onConflict: "owner_user_id,season" })
      .then(() => {});
  }

  setOwnerDraftTendencies(tendencies);
};

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
  if (!myRoster) { setReadyLeagueId(league.league_id); return; }
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
  setReadyLeagueId(league.league_id);
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

const loadGamedayMatchups = async (leagueId: string, week: number) => {
  if (!leagueId || !week) return;
  setLoadingGamedayMatchups(true);
  try {
    const data = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`)
      .then((r) => r.json())
      .catch(() => []);
    setGamedayMatchups(Array.isArray(data) ? data : []);
  } finally {
    setLoadingGamedayMatchups(false);
  }
};

// ── Leaguemate trade alerts ──────────────────────────────────────────────────
// Scans every dynasty league each leaguemate is in (not just shared leagues)
// and surfaces trades from the last 14 days as feed alerts.
// Seen trade IDs are cached in Supabase so repeat loads don't re-alert.
const tradeAlertLoadedRef = useRef(false);
const loadLeaguemateTradeAlerts = async () => {
  if (tradeAlertLoadedRef.current) return; // once per session
  if (!rosters.length || !user?.user_id) return;
  tradeAlertLoadedRef.current = true;

  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

  // Get already-known trade alert IDs so we don't duplicate
  const existingIds = new Set(latestAlertsRef.current.map((a) => a.id));
  // Also check Supabase for IDs the user has already seen / dismissed
  let seenFromDb = new Set<string>();
  if (supabaseUser) {
    const { data } = await supabase
      .from("alerts")
      .select("alert_id")
      .eq("user_id", supabaseUser.id)
      .like("alert_id", "trade-%");
    (data ?? []).forEach((row: any) => seenFromDb.add(row.alert_id));
  }

  const leaguemateOwnerIds = (rosters as any[])
    .map((r: any) => r.owner_id)
    .filter((uid: string) => uid && uid !== user.user_id);
  if (!leaguemateOwnerIds.length) return;

  const tradeAlerts: AlertsCenterItem[] = [];

  await Promise.all(leaguemateOwnerIds.map(async (ownerId: string) => {
    const ownerName = users[ownerId] || "Leaguemate";
    try {
      const leaguesRes = await fetch(
        `https://api.sleeper.app/v1/user/${ownerId}/leagues/nfl/${CURRENT_YEAR}`
      );
      const ownerLeagues = await leaguesRes.json();
      if (!Array.isArray(ownerLeagues)) return;

      const dynastyLeagues = ownerLeagues.filter((league: any) =>
        ((league.settings?.taxi_slots ?? 0) > 0 || (league.roster_positions?.length ?? 0) > 20) &&
        (league.settings?.best_ball ?? 0) === 0
      );

      await Promise.all(dynastyLeagues.map(async (league: any) => {
        try {
          // Fetch rosters + recent transactions (weeks 0-2 cover all offseason activity)
          const [leagueRosters, txn0, txn1, txn2] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`)
              .then((r) => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/0`)
              .then((r) => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/1`)
              .then((r) => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/2`)
              .then((r) => r.json()).catch(() => []),
          ]);

          const ownerRoster = (Array.isArray(leagueRosters) ? leagueRosters : [])
            .find((r: any) => String(r.owner_id) === ownerId);
          if (!ownerRoster) return;

          const allTxns = [
            ...(Array.isArray(txn0) ? txn0 : []),
            ...(Array.isArray(txn1) ? txn1 : []),
            ...(Array.isArray(txn2) ? txn2 : []),
          ];

          const recentTrades = allTxns.filter((t: any) =>
            t.type === "trade" &&
            t.status === "complete" &&
            (t.status_updated || t.created || 0) > fourteenDaysAgo &&
            (t.roster_ids || []).includes(ownerRoster.roster_id)
          );

          recentTrades.forEach((trade: any) => {
            const alertId = `trade-${trade.transaction_id}-${ownerId}`;
            if (existingIds.has(alertId) || seenFromDb.has(alertId)) return;

            // What did this owner receive?
            const acquired = Object.entries(trade.adds || {})
              .filter(([, rid]) => rid === ownerRoster.roster_id)
              .map(([pid]) => (players as any)?.[pid]?.full_name || pid)
              .filter(Boolean);

            // What did this owner send?
            const sent = Object.entries(trade.adds || {})
              .filter(([, rid]) => rid !== ownerRoster.roster_id)
              .map(([pid]) => (players as any)?.[pid]?.full_name || pid)
              .filter(Boolean);

            const pickCount = (trade.draft_picks || []).filter((p: any) =>
              p.owner_id !== ownerRoster.roster_id
            ).length;
            const picksNote = pickCount > 0
              ? ` + ${pickCount} draft pick${pickCount > 1 ? "s" : ""}`
              : "";

            if (!acquired.length && !sent.length) return; // pick-only, skip

            const leagueName = league.name || `League`;
            const tradeTs = trade.status_updated || trade.created || Date.now();

            tradeAlerts.push({
              id: alertId,
              category: "league" as const,
              source: "internal" as const,
              severity: "medium" as const,
              title: `${ownerName} made a trade — ${leagueName}`,
              detail: acquired.length
                ? `${ownerName} received ${acquired.join(", ")}${sent.length ? `, sent ${sent.join(", ")}` : ""}${picksNote} in ${leagueName}.`
                : `${ownerName} sent ${sent.join(", ")}${picksNote} in ${leagueName}.`,
              actionable: true,
              timestamp: tradeTs,
              leagueId: league.league_id,
              payload: { ownerId, ownerName, leagueName, acquired, sent, pickCount },
            });
          });
        } catch {}
      }));
    } catch {}
  }));

  if (tradeAlerts.length) {
    mergeDashboardAlerts(tradeAlerts);
  }
};

const loadActivity = async (leagueId: string) => {
  if (!leagueId) return;
  setLoadingActivity(true);
  try {
    // Fetch the last 6 weeks of transactions in parallel
    const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const results = await Promise.all(
      weeks.map(w =>
        fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${w}`)
          .then(r => r.json())
          .catch(() => [])
      )
    );
    const all = results.flat().filter((t: any) => t && t.status === "complete");
    all.sort((a: any, b: any) => (b.status_updated || b.created || 0) - (a.status_updated || a.created || 0));
    setActivityTransactions(all.slice(0, 150));
  } catch { /* silently fail */ }
  finally { setLoadingActivity(false); }
};

const loadLeagueOverview = async () => {
  if (!leagues.length || !user) return;
  setLoadingLeagueOverview(true);
  try {
    // Fetch all rosters, traded picks, and drafts for every league in parallel
    const results = await Promise.all(
      leagues.map(async (league: any) => {
        try {
          const [rostersData, tradedPicksData, draftsData, usersData] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then(r => r.json()),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).then(r => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then(r => r.json()).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`).then(r => r.json()).catch(() => []),
          ]);
          // Build userId → display_name map for this league
          const leagueUserMap: Record<string, string> = {};
          (usersData || []).forEach((u: any) => {
            leagueUserMap[u.user_id] = u.display_name || u.username || u.metadata?.team_name || `Team`;
          });

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
          const totalDraftTeams = rostersData.length || Number(currentDraft?.settings?.teams) || 0;
          tempPicks.forEach((pick: any) => {
            if (pick.season === CURRENT_YEAR) {
              const userId = rosterToUser[String(pick.roster_id)];
              const baseSlot = Number(order[String(userId)] || 0);
              const slot = getDraftRoundSlot(currentDraft, Number(pick.round), baseSlot, totalDraftTeams);
              pick.slot = slot
                ? `${pick.round}.${String(slot).padStart(2, "0")}`
                : `${pick.round}`;
            }
          });

          return { league, rosters: rostersData, picks: tempPicks, userMap: leagueUserMap };
        } catch { return null; }
      })
    );
    const byLeague: Record<string, any> = {};
    results.filter(Boolean).forEach(({ league, rosters: lr, picks, userMap }: any) => {
      byLeague[league.league_id] = { league, rosters: lr, picks, userMap };
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

const savePlayerNote = async (playerId: string, note: string) => {
  const updated = { ...playerNotes, [playerId]: note };
  setPlayerNotes(updated);
  try { localStorage.setItem("playerNotes_v1", JSON.stringify(updated)); } catch {}
  if (supabaseUser) {
    supabase.from("player_notes").upsert(
      { user_id: supabaseUser.id, player_id: playerId, note, updated_at: new Date().toISOString() },
      { onConflict: "user_id,player_id" }
    ).then(() => {});
  }
};

const savePlayerDisposition = async (playerId: string, sell: string, buy: string) => {
  const updated = { ...playerDispositions, [playerId]: { sell, buy } };
  setPlayerDispositions(updated);
  try { localStorage.setItem("playerDispositions_v1", JSON.stringify(updated)); } catch {}
  if (supabaseUser) {
    supabase.from("player_dispositions").upsert(
      { user_id: supabaseUser.id, player_id: playerId, sell, buy, updated_at: new Date().toISOString() },
      { onConflict: "user_id,player_id" }
    ).then(() => {});
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
    const sourceRows = new Map<string, { totalWeightedFpts: number; totalWeight: number; sources: string[]; kickoffAt: number | null }>();
    const getProjectionSourceKickoffAt = (row: any) => {
      const direct = getProjectionKickoffAt(row);
      if (direct) return direct;
      const nestedCandidates = [
        row?.game?.kickoffAt,
        row?.game?.kickoff_at,
        row?.game?.scheduled,
        row?.game?.start_time,
        row?.metadata?.kickoffAt,
        row?.metadata?.kickoff_at,
      ];
      const nested = nestedCandidates
        .map((value) => Number(value))
        .find((value) => Number.isFinite(value) && value > 0);
      return nested || null;
    };

    const addRow = (sleeperId: string, fpts: number, sourceId: string, weight: number, kickoffAt?: number | null) => {
      const existing = sourceRows.get(sleeperId) ?? { totalWeightedFpts: 0, totalWeight: 0, sources: [], kickoffAt: null };
      existing.totalWeightedFpts += fpts * weight;
      existing.totalWeight += weight;
      if (!existing.sources.includes(sourceId)) existing.sources.push(sourceId);
      if (!existing.kickoffAt && kickoffAt) existing.kickoffAt = kickoffAt;
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
        addRow(String(item.player_id), fpts, src.id, src.weight, getProjectionSourceKickoffAt(item));
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
        kickoffAt: row.kickoffAt,
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

  const pickSummary = YEARS.reduce((acc: Record<string, number>, year) => {
    acc[year] = 0;
    return acc;
  }, {});

  picks.forEach((p: any) => {
    if (pickSummary[p.season] !== undefined) {
      pickSummary[p.season]++;
    }
  });

  return { summary, pickSummary };
};

  const teamSummary = useMemo(() => getTeamSummary(), [roster, players, picks]);
  const gamedayWeek = useMemo(() => {
    const rawWeek = Number(nflState?.week || 0);
    return nflState?.season_type === "regular" && rawWeek > 0 ? rawWeek : 0;
  }, [nflState?.week, nflState?.season_type]);
  const gamedayMatchupCards = useMemo(() => {
    if (!selectedLeague || !rosters.length || !gamedayWeek) return [];

    const starterSlots = (selectedLeague?.roster_positions || []).filter(
      (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
    );
    const rosterMap = new Map(rosters.map((entry: any) => [Number(entry.roster_id), entry]));
    const projectionByPlayerId = new Map(
      projectionData.map((row: any) => [String(row.sleeperId), row])
    );
    const matchupMap = new Map<number, any[]>();

    gamedayMatchups.forEach((entry: any) => {
      const matchupId = Number(entry?.matchup_id || 0);
      if (!matchupId) return;
      if (!matchupMap.has(matchupId)) matchupMap.set(matchupId, []);
      matchupMap.get(matchupId)?.push(entry);
    });

    const buildTeamView = (entry: any) => {
      const rosterId = Number(entry?.roster_id || 0);
      const rosterEntry = rosterMap.get(rosterId);
      const starterIds = Array.isArray(entry?.starters) && entry.starters.length > 0
        ? entry.starters.map((id: any) => String(id || ""))
        : (rosterEntry?.starters || []).map((id: any) => String(id || ""));
      const playerPoints = entry?.players_points || {};
      const starterRows = starterSlots.map((slot: string, index: number) => {
        const playerId = starterIds[index] ? String(starterIds[index]) : "";
        const player = playerId ? (players as any)?.[playerId] : null;
        const projection = playerId ? projectionByPlayerId.get(playerId) : null;
        const kickoffAt = getProjectionKickoffAt(projection);
        const actualPoints = Number(playerId ? playerPoints[playerId] ?? entry?.starters_points?.[index] ?? 0 : 0);
        const gameState = getKickoffState(kickoffAt);
        const remainingProjection = gameState === "Upcoming"
          ? Number(projection?.fpts || 0)
          : gameState === "Live"
          ? Math.max(Number(projection?.fpts || 0) - actualPoints, 0)
          : 0;

        return {
          slot,
          playerId,
          player,
          actualPoints,
          remainingProjection,
          kickoffAt,
          kickoffLabel: formatKickoffTime(kickoffAt),
          gameState,
        };
      });

      const starterIdSet = new Set(starterRows.map((row: any) => row.playerId).filter(Boolean));
      const taxiIdSet = new Set((rosterEntry?.taxi || []).map((id: any) => String(id)));
      const buildReserveRow = (playerId: string) => {
        const player = (players as any)?.[playerId];
        const projection = projectionByPlayerId.get(String(playerId));
        const kickoffAt = getProjectionKickoffAt(projection);
        const actualPoints = Number(playerPoints[playerId] ?? 0);
        const gameState = getKickoffState(kickoffAt);
        const remainingProjection = gameState === "Upcoming"
          ? Number(projection?.fpts || 0)
          : gameState === "Live"
          ? Math.max(Number(projection?.fpts || 0) - actualPoints, 0)
          : 0;
        return {
          playerId,
          player,
          actualPoints,
          remainingProjection,
          kickoffAt,
          kickoffLabel: formatKickoffTime(kickoffAt),
          gameState,
        };
      };

      const benchRows = (rosterEntry?.players || [])
        .map((id: any) => String(id))
        .filter((playerId: string) => !starterIdSet.has(playerId) && !taxiIdSet.has(playerId))
        .map(buildReserveRow)
        .filter((row: any) => row.player)
        .sort((a: any, b: any) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

      const taxiRows = (rosterEntry?.taxi || [])
        .map((id: any) => String(id))
        .map(buildReserveRow)
        .filter((row: any) => row.player)
        .sort((a: any, b: any) => (b.remainingProjection + b.actualPoints) - (a.remainingProjection + a.actualPoints));

      return {
        rosterId,
        ownerId: rosterEntry?.owner_id,
        ownerName: (users as any)?.[rosterEntry?.owner_id] || (users as any)?.[rosterId] || `Team ${rosterId}`,
        actualPoints: Number(entry?.points || 0),
        remainingProjection: Math.round(sum(starterRows.map((row: any) => row.remainingProjection)) * 10) / 10,
        projectedFinal: Math.round((Number(entry?.points || 0) + sum(starterRows.map((row: any) => row.remainingProjection))) * 10) / 10,
        finishedStarters: starterRows.filter((row: any) => row.gameState === "Final" && row.playerId).length,
        liveStarters: starterRows.filter((row: any) => row.gameState === "Live" && row.playerId).length,
        upcomingStarters: starterRows.filter((row: any) => row.gameState === "Upcoming" && row.playerId).length,
        totalStarters: starterRows.filter((row: any) => row.playerId).length,
        starterRows,
        benchRows,
        taxiRows,
      };
    };

    return [...matchupMap.entries()]
      .map(([matchupId, entries]) => {
        const teams = entries
          .map((entry) => buildTeamView(entry))
          .sort((a: any, b: any) => b.actualPoints - a.actualPoints);
        const sortKickoff = teams
          .flatMap((team: any) => team.starterRows.map((row: any) => row.kickoffAt).filter(Boolean))
          .sort((a: number, b: number) => a - b)[0] || Number.MAX_SAFE_INTEGER;

        return {
          matchupId,
          teams,
          sortKickoff,
        };
      })
      .sort((a: any, b: any) => {
        if (a.sortKickoff !== b.sortKickoff) return a.sortKickoff - b.sortKickoff;
        return a.matchupId - b.matchupId;
      });
  }, [selectedLeague?.league_id, selectedLeague?.roster_positions, rosters, gamedayMatchups, gamedayWeek, players, projectionData, users]);
  const selectedGamedayMatchup = useMemo(
    () => gamedayMatchupCards.find((card: any) => card.matchupId === selectedGamedayMatchupId) || gamedayMatchupCards[0] || null,
    [gamedayMatchupCards, selectedGamedayMatchupId]
  );
  useEffect(() => {
    if (!gamedayMatchupCards.length) {
      setSelectedGamedayMatchupId(null);
      return;
    }
    if (!gamedayMatchupCards.some((card: any) => card.matchupId === selectedGamedayMatchupId)) {
      setSelectedGamedayMatchupId(gamedayMatchupCards[0].matchupId);
    }
  }, [gamedayMatchupCards, selectedGamedayMatchupId]);
  const selectedLeagueDirection = useMemo(() => {
    if (!selectedLeague || !rosters.length || !user?.user_id) return null;
    const myRosterId = rosters.find((r: any) => r.owner_id === user.user_id)?.roster_id;
    if (!myRosterId) return null;
    return getRosterDirectionProfile({
      rosterId: myRosterId,
      rosters,
      ownedPicks: allPicks,
      players,
      pickValues: pickFcValues,
      redraftValues,
      dynastyValueForPlayer: (id: string) => calcFcValues[id] ?? (players as any)?.[id]?.value ?? 0,
    });
  }, [selectedLeague?.league_id, rosters, allPicks, players, pickFcValues, redraftValues, calcFcValues, user?.user_id]);
  const selectedLeagueSimulation = useMemo(() => {
    if (!selectedLeague || !rosters.length) return null;

    const leagueId = selectedLeague.league_id;
    const nflWeek = Number(nflState?.week || 0);
    const isRegularSeason = nflState?.season_type === "regular" && nflWeek > 0;
    const currentWeek = isRegularSeason ? nflWeek : 0;
    const simulationMode = currentWeek > 0 ? "in_season" : "offseason";
    const regularSeasonWeeks = Math.max(1, Number(selectedLeague?.settings?.playoff_week_start || 15) - 1);
    const playoffTeams = Number(selectedLeague?.settings?.playoff_teams || Math.ceil(rosters.length / 2));
    const byeTeams = playoffTeams >= 6 ? 2 : playoffTeams === 5 ? 1 : 0;
    const simCount = simulationMode === "offseason" ? 350 : 250;
    const weeklyHistory = (leagueWeeklyMatchups[leagueId] || []) as Array<{ week: number; matchups: any[] }>;
    const projectionMap = new Map(
      ((projectionWeek === 0 || projectionWeek === currentWeek) ? projectionData : []).map((row: any) => [String(row.sleeperId), Number(row.fpts || 0)])
    );
    const lineupSlots = (selectedLeague?.roster_positions || []).filter(
      (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
    );
    const weeksPlayed = currentWeek > 0
      ? weeklyHistory.filter((week) => week.week < currentWeek).length
      : 0;
    const projectionIsSeason = projectionWeek === 0;

    const scorePlayer = (playerId: string) => {
      const projected = projectionMap.get(String(playerId));
      if (typeof projected === "number" && projected > 0) return projected;
      return (redraftValues[playerId] ?? 0) / 250;
    };

    const buildLineupStrength = (rosterEntry: any) => {
      const available = (rosterEntry?.players || [])
        .map((id: string) => (players as any)?.[id])
        .filter((player: any) => player && ["QB", "RB", "WR", "TE"].includes(player.position))
        .map((player: any) => ({
          ...player,
          score: scorePlayer(player.player_id),
        }))
        .sort((a: any, b: any) => b.score - a.score);

      const used = new Set<string>();
      const lineup: any[] = [];
      const claimBest = (eligible: string[], slot: string) => {
        const next = available.find((player: any) => !used.has(player.player_id) && eligible.includes(player.position));
        if (!next) {
          lineup.push({ slot, player: null, score: 0 });
          return;
        }
        used.add(next.player_id);
        lineup.push({ slot, player: next, score: next.score });
      };

      lineupSlots.forEach((slot: string) => {
        if (slot === "FLEX") return claimBest(["RB", "WR", "TE"], slot);
        if (slot === "SUPER_FLEX") return claimBest(["QB", "RB", "WR", "TE"], slot);
        return claimBest([slot], slot);
      });

      const bench = available.filter((player: any) => !used.has(player.player_id));
      const rawLineupScore = sum(lineup.map((slot) => slot.score || 0));
      const rawBenchDepth = sum(bench.slice(0, 5).map((player: any) => player.score || 0));
      const weeklyLineupScore = rawLineupScore / (projectionIsSeason ? regularSeasonWeeks : 1);
      const weeklyBenchDepth = rawBenchDepth / (projectionIsSeason ? regularSeasonWeeks : 1);
      const seasonProjection = projectionIsSeason
        ? rawLineupScore
        : Number(rosterEntry?.settings?.fpts_max || 0) + (Math.max(regularSeasonWeeks - Math.max(currentWeek - 1, 0), 0) * rawLineupScore);
      return {
        lineupScore: weeklyLineupScore,
        benchDepth: weeklyBenchDepth,
        projectedMaxPf: Math.round(seasonProjection * 10) / 10,
        powerScore: Math.round((weeklyLineupScore + weeklyBenchDepth * 0.35) * 10) / 10,
        weeklyStdDev: Math.max(8, weeklyLineupScore * 0.16 + weeklyBenchDepth * 0.08),
      };
    };

    const rows: any[] = rosters.map((rosterEntry: any) => {
      const strength = buildLineupStrength(rosterEntry);
      const standing = standings.find((entry: any) => Number(entry.roster_id) === Number(rosterEntry.roster_id));
      const ownerName = (users as any)[rosterEntry.owner_id] || `Team ${rosterEntry.roster_id}`;
      return {
        rosterId: Number(rosterEntry.roster_id),
        ownerId: rosterEntry.owner_id,
        ownerName,
        actualWins: Number(standing?.wins || rosterEntry.settings?.wins || 0),
        actualLosses: Number(standing?.losses || rosterEntry.settings?.losses || 0),
        pointsFor: Number(standing?.fpts || rosterEntry.settings?.fpts || 0),
        maxPf: Number(standing?.max_pf || rosterEntry.settings?.fpts_max || 0),
        ...strength,
      };
    });

    const rowByRosterId = new Map(rows.map((row) => [row.rosterId, row]));
    const rosterIds = rows.map((row) => row.rosterId).sort((a, b) => a - b);
    const generatedSchedule = buildRoundRobinSchedule(rosterIds, regularSeasonWeeks);
    const actualScheduleByWeek = new Map<number, Array<[number, number]>>();
    weeklyHistory.forEach((week) => {
      const grouped = new Map<number, number[]>();
      (week.matchups || [])
        .filter((entry: any) => entry?.matchup_id && entry?.roster_id)
        .forEach((entry: any) => {
          const matchupId = Number(entry.matchup_id);
          if (!grouped.has(matchupId)) grouped.set(matchupId, []);
          grouped.get(matchupId)?.push(Number(entry.roster_id));
        });
      const pairs = [...grouped.values()]
        .filter((pair) => pair.length === 2)
        .map((pair) => [pair[0], pair[1]] as [number, number]);
      if (pairs.length > 0) actualScheduleByWeek.set(Number(week.week), pairs);
    });

    const scheduleByWeek = Array.from({ length: regularSeasonWeeks }, (_, idx) => {
      const week = idx + 1;
      const actualPairs = actualScheduleByWeek.get(week) || [];
      return {
        week,
        source: actualPairs.length > 0 ? "scheduled" : "generated",
        pairs: actualPairs.length > 0 ? actualPairs : generatedSchedule[idx] || [],
      };
    });

    const playMatch = (aRosterId: number, bRosterId: number, rng: () => number) => {
      const aRow = rowByRosterId.get(aRosterId);
      const bRow = rowByRosterId.get(bRosterId);
      if (!aRow || !bRow) return { winner: aRosterId, loser: bRosterId, aPoints: 0, bPoints: 0 };
      const aPoints = Math.max(40, aRow.lineupScore + randomNormal(rng) * aRow.weeklyStdDev);
      const bPoints = Math.max(40, bRow.lineupScore + randomNormal(rng) * bRow.weeklyStdDev);
      if (aPoints === bPoints) {
        return rng() < 0.5
          ? { winner: aRosterId, loser: bRosterId, aPoints, bPoints }
          : { winner: bRosterId, loser: aRosterId, aPoints, bPoints };
      }
      return aPoints > bPoints
        ? { winner: aRosterId, loser: bRosterId, aPoints, bPoints }
        : { winner: bRosterId, loser: aRosterId, aPoints, bPoints };
    };

    const seededIndex = (seededIds: number[], rosterId: number) => seededIds.indexOf(rosterId);
    const simulatePlayoffs = (seededIds: number[], rng: () => number) => {
      if (seededIds.length === 0) return null;
      if (seededIds.length === 1) return seededIds[0];

      let roundTeams = [...seededIds];
      if (byeTeams > 0 && roundTeams.length > byeTeams) {
        const byes = roundTeams.slice(0, byeTeams);
        const openingRound = roundTeams.slice(byeTeams);
        const winners: number[] = [];
        while (openingRound.length >= 2) {
          const high = openingRound.shift()!;
          const low = openingRound.pop()!;
          winners.push(playMatch(high, low, rng).winner);
        }
        roundTeams = [...byes, ...winners].sort((a, b) => seededIndex(seededIds, a) - seededIndex(seededIds, b));
      }

      while (roundTeams.length > 1) {
        const roundSeeds = [...roundTeams].sort((a, b) => seededIndex(seededIds, a) - seededIndex(seededIds, b));
        const winners: number[] = [];
        while (roundSeeds.length >= 2) {
          const high = roundSeeds.shift()!;
          const low = roundSeeds.pop()!;
          winners.push(playMatch(high, low, rng).winner);
        }
        roundTeams = winners.sort((a, b) => seededIndex(seededIds, a) - seededIndex(seededIds, b));
      }
      return roundTeams[0];
    };

    rows.forEach((row) => {
      const others = rows.filter((other) => other.rosterId !== row.rosterId);
      row.avgWinProb = others.length
        ? average(others.map((other) => logisticWinProb(row.powerScore, other.powerScore, 14) * 100)) / 100
        : 0.5;
      row.currentWeekWinProb = row.avgWinProb;
      row.currentOpponent = null;
      row.allPlayWins = 0;
      row.allPlayLosses = 0;
      row.upcomingSchedule = [] as any[];
    });

    if (currentWeek > 0) {
      weeklyHistory
        .filter((week) => week.week < currentWeek)
        .forEach((week) => {
          const scored = (week.matchups || []).filter((matchup: any) => matchup?.roster_id);
          scored.forEach((entry: any) => {
            const row = rowByRosterId.get(Number(entry.roster_id));
            if (!row) return;
            const wins = scored.filter((other: any) => Number(other.roster_id) !== Number(entry.roster_id) && Number(entry.points || 0) > Number(other.points || 0)).length;
            const losses = scored.filter((other: any) => Number(other.roster_id) !== Number(entry.roster_id) && Number(entry.points || 0) < Number(other.points || 0)).length;
            row.allPlayWins += wins;
            row.allPlayLosses += losses;
          });
        });
    }

    const displayWeeks = scheduleByWeek
      .filter((week) => week.week >= (currentWeek || 1))
      .slice(0, 4)
      .map((week) => {
        const matchups = week.pairs.map(([aRosterId, bRosterId]) => {
          const aRow = rowByRosterId.get(aRosterId);
          const bRow = rowByRosterId.get(bRosterId);
          if (!aRow || !bRow) return null;
          const aProb = logisticWinProb(aRow.powerScore, bRow.powerScore, 14);
          const bProb = 1 - aProb;
          const matchup = {
            week: week.week,
            source: week.source,
            aRosterId,
            aName: aRow.ownerName,
            aWinProb: aProb,
            aProjected: Math.round(aRow.lineupScore * 10) / 10,
            bRosterId,
            bName: bRow.ownerName,
            bWinProb: bProb,
            bProjected: Math.round(bRow.lineupScore * 10) / 10,
          };
          aRow.upcomingSchedule.push({
            week: week.week,
            opponentRosterId: bRosterId,
            opponentName: bRow.ownerName,
            winProb: aProb,
            projectedPoints: matchup.aProjected,
            source: week.source,
          });
          bRow.upcomingSchedule.push({
            week: week.week,
            opponentRosterId: aRosterId,
            opponentName: aRow.ownerName,
            winProb: bProb,
            projectedPoints: matchup.bProjected,
            source: week.source,
          });
          if (week.week === currentWeek) {
            aRow.currentWeekWinProb = aProb;
            bRow.currentWeekWinProb = bProb;
            aRow.currentOpponent = bRow.ownerName;
            bRow.currentOpponent = aRow.ownerName;
          }
          return matchup;
        }).filter(Boolean);
        return { week: week.week, source: week.source, matchups };
      });

    const simulationStats = Object.fromEntries(
      rows.map((row) => [row.rosterId, {
        winsSum: 0,
        finishCounts: Array.from({ length: rosters.length + 1 }, () => 0),
        slotCounts: Array.from({ length: rosters.length + 1 }, () => 0),
        playoffCount: 0,
        byeCount: 0,
        titleCount: 0,
      }])
    ) as Record<number, any>;

    const leagueSeed = String(leagueId).split("").reduce((acc, char, idx) => acc + char.charCodeAt(0) * (idx + 1), 0) + simSalt;
    const simStartWeek = currentWeek > 0 ? currentWeek : 1;
    for (let sim = 0; sim < simCount; sim++) {
      const rng = createSeededRandom(leagueSeed + sim * 7919 + regularSeasonWeeks * 17);
      const winMap = new Map<number, number>(rows.map((row) => [row.rosterId, row.actualWins]));
      const pointMap = new Map<number, number>(rows.map((row) => [row.rosterId, row.pointsFor]));

      scheduleByWeek
        .filter((week) => week.week >= simStartWeek)
        .forEach((week) => {
          week.pairs.forEach(([aRosterId, bRosterId]) => {
            const result = playMatch(aRosterId, bRosterId, rng);
            pointMap.set(aRosterId, (pointMap.get(aRosterId) || 0) + result.aPoints);
            pointMap.set(bRosterId, (pointMap.get(bRosterId) || 0) + result.bPoints);
            winMap.set(result.winner, (winMap.get(result.winner) || 0) + 1);
          });
        });

      const simStandings = rows
        .map((row) => ({
          rosterId: row.rosterId,
          wins: winMap.get(row.rosterId) || 0,
          points: pointMap.get(row.rosterId) || 0,
          powerScore: row.powerScore,
          projectedMaxPf: row.projectedMaxPf,
        }))
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.points !== a.points) return b.points - a.points;
          if (b.powerScore !== a.powerScore) return b.powerScore - a.powerScore;
          return b.projectedMaxPf - a.projectedMaxPf;
        });

      const seededIds = simStandings.map((entry) => entry.rosterId);
      seededIds.forEach((rosterId, index) => {
        const stats = simulationStats[rosterId];
        stats.winsSum += winMap.get(rosterId) || 0;
        stats.finishCounts[index + 1] += 1;
        stats.slotCounts[rosters.length - index] += 1;
      });
      seededIds.slice(0, playoffTeams).forEach((rosterId, index) => {
        simulationStats[rosterId].playoffCount += 1;
        if (index < byeTeams) simulationStats[rosterId].byeCount += 1;
      });
      const championRosterId = simulatePlayoffs(seededIds.slice(0, playoffTeams), rng);
      if (championRosterId != null) simulationStats[championRosterId].titleCount += 1;
    }

    rows.forEach((row) => {
      const stats = simulationStats[row.rosterId];
      const finishCounts = stats.finishCounts as number[];
      const slotCounts = stats.slotCounts as number[];
      const expectedFinish = finishCounts.reduce((total, count, finish) => total + finish * count, 0) / simCount;
      const likelyFinish = finishCounts.reduce((bestIdx, count, idx, arr) => count > arr[bestIdx] ? idx : bestIdx, 1);
      const floorFinish = percentileFromCounts(finishCounts, 0.2);
      const ceilingFinish = percentileFromCounts(finishCounts, 0.8);

      row.expectedWins = Math.round((stats.winsSum / simCount) * 10) / 10;
      row.avgFinish = Math.round(expectedFinish * 10) / 10;
      row.projectedFinish = likelyFinish;
      row.finishRange = `${floorFinish || likelyFinish}-${ceilingFinish || likelyFinish}`;
      row.playoffOdds = Math.round((stats.playoffCount / simCount) * 1000) / 10;
      row.byeOdds = Math.round((stats.byeCount / simCount) * 1000) / 10;
      row.titleOdds = Math.round((stats.titleCount / simCount) * 1000) / 10;
      row.finishProbabilities = finishCounts.map((count) => count / simCount);
      row.slotProbabilities = slotCounts.map((count) => count / simCount);
      row.allPlayExpectedWins = weeksPlayed > 0 ? Math.round((row.allPlayWins / Math.max(rosters.length - 1, 1)) * 10) / 10 : 0;
      row.luckScore = weeksPlayed > 0 ? Math.round((row.actualWins - row.allPlayExpectedWins) * 10) / 10 : 0;
      row.oneOhOneOdds = Math.round(((slotCounts[1] || 0) / simCount) * 1000) / 10;
      row.upcomingSchedule = row.upcomingSchedule.slice(0, 4);
    });

    const ranked = [...rows].sort((a: any, b: any) => {
      if (b.playoffOdds !== a.playoffOdds) return b.playoffOdds - a.playoffOdds;
      if (b.titleOdds !== a.titleOdds) return b.titleOdds - a.titleOdds;
      if (b.expectedWins !== a.expectedWins) return b.expectedWins - a.expectedWins;
      return b.powerScore - a.powerScore;
    });

    return {
      currentWeek,
      simulationMode,
      regularSeasonWeeks,
      playoffTeams,
      byeTeams,
      weeksPlayed,
      simCount,
      rows: ranked,
      weeklyMatchups: displayWeeks,
      rowByRosterId: new Map(ranked.map((row) => [row.rosterId, row])),
    };
  }, [
    selectedLeague?.league_id,
    selectedLeague?.settings?.playoff_week_start,
    selectedLeague?.settings?.playoff_teams,
    selectedLeague?.roster_positions,
    rosters,
    nflState?.week,
    nflState?.season_type,
    projectionData,
    projectionWeek,
    players,
    redraftValues,
    leagueWeeklyMatchups,
    standings,
    users,
    simSalt,
  ]);

  // Combines dynasty rank, redraft rank, simulation playoff odds, and core age into one profile.
  // This is the authoritative direction — use this everywhere instead of raw selectedLeagueDirection.
  const selectedLeagueDirectionAdjusted = useMemo(() => {
    if (!selectedLeagueDirection) return null;
    const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;
    const mySimRow = selectedLeagueSimulation?.rowByRosterId?.get(Number(myRosterId));
    const playoffOdds = mySimRow?.playoffOdds ?? 0;
    const adjustedBucket = getAdjustedDirectionBucket(selectedLeagueDirection.bucket, selectedLeagueDirection, playoffOdds, !!mySimRow);
    return {
      ...selectedLeagueDirection,
      bucket: adjustedBucket,
      bucketColor: getBucketColor(adjustedBucket),
      rawBucket: selectedLeagueDirection.bucket,
      playoffOdds,
    };
  }, [selectedLeagueDirection, selectedLeagueSimulation, rosters, user?.user_id]);

  const selectedLeagueDynamicPickValues = useMemo(() => {
    const leagueId = selectedLeague?.league_id;
    if (!leagueId || !selectedLeagueSimulation) return {} as Record<string, any>;
    // Always prefer the live sim for the currently selected league — it's always current.
    // Fall back to the frozen committed snapshot only when the live sim lacks the row
    // (shouldn't happen for the selected league, but keeps the fallback path safe).
    const frozenRows = committedSimsByLeague[leagueId];
    const getProjection = (rosterId: number) =>
      selectedLeagueSimulation.rowByRosterId.get(rosterId)
        ?? (frozenRows ? frozenRows[rosterId] : undefined);

    const totalTeams = rosters.length || 12;
    const slots = Array.from({ length: totalTeams }, (_, idx) => idx + 1);

    // Rank-based slot assignment: sort all rosters by their mean expected slot
    // (worst team = lowest mean slot = gets slot 1, best = slot N).
    const rosterRankSlot = (() => {
      const entries = (rosters as any[]).map((r: any) => {
        const proj = getProjection(Number(r.roster_id));
        const rawSlots = slots.map((slot: number) => proj?.slotProbabilities?.[slot] ?? (1 / totalTeams));
        const slotTotal = sum(rawSlots) || 1;
        const normSlots = rawSlots.map((p: number) => p / slotTotal);
        const meanSlot = normSlots.reduce((t: number, p: number, idx: number) => t + p * (idx + 1), 0);
        return { rosterId: Number(r.roster_id), meanSlot };
      }).sort((a, b) => a.meanSlot - b.meanSlot); // ascending: lowest mean slot = worst team
      return new Map(entries.map((e, idx) => [e.rosterId, idx + 1]));
    })();

    const bucketForSlot = (slot: number) => {
      const earlyCut = Math.ceil(totalTeams / 3);
      const midCut = Math.ceil((totalTeams * 2) / 3);
      if (slot <= earlyCut) return "early";
      if (slot <= midCut) return "mid";
      return "late";
    };
    const currentRoundValue = (round: number) => pickFcValues[`${CURRENT_YEAR}-${round}`] || 0;
    const getBandValue = (season: string, round: number, bucket: "early" | "mid" | "late") => {
      const bucketSlots = slots.filter((slot) => bucketForSlot(slot) === bucket);
      const baseSlots = bucketSlots
        .map((slot) => pickFcValues[`${CURRENT_YEAR}-${round}.${String(slot).padStart(2, "0")}`])
        .filter(Boolean);
      const baseBandValue = baseSlots.length > 0
        ? Math.round(sum(baseSlots as number[]) / baseSlots.length)
        : Math.round((currentRoundValue(round) || 0) * (bucket === "early" ? 1.2 : bucket === "mid" ? 1 : 0.8));
      const seasonRoundValue = pickFcValues[`${season}-${round}`] || currentRoundValue(round) || baseBandValue;
      const currentRoundBase = currentRoundValue(round) || baseBandValue || 1;
      return Math.round(baseBandValue * (seasonRoundValue / currentRoundBase));
    };

    return Object.fromEntries(
      (allPicks as any[]).map((pick: any) => {
        const key = `${pick.season}-${pick.round}-${pick.roster_id}`;
        const rosterProjection = getProjection(Number(pick.roster_id));
        const fallback = getStoredPickValue(pickFcValues, pick);
        if (!rosterProjection) {
          const midFallback = fallback;
          const floorValue = Math.round(midFallback * 0.85);
          const ceilingValue = Math.round(midFallback * 1.15);
          return [key, {
            bucket: "mid",
            label: "Mid outcome most likely",
            expectedValue: midFallback,
            expectedSlot: Math.round((totalTeams + 1) / 2),
            floorValue,
            ceilingValue,
            probabilities: { early: 0.2, mid: 0.6, late: 0.2 },
            likelySlots: [],
          }];
        }

        if (String(pick.season) === CURRENT_YEAR && String(pick.slot || "").includes(".")) {
          const slot = Number(String(pick.slot).split(".")[1] || 0);
          const bucket = bucketForSlot(slot) as "early" | "mid" | "late";
          const exactValue = getStoredPickValue(pickFcValues, pick);
          return [key, {
            bucket,
            label: `${bucket[0].toUpperCase()}${bucket.slice(1)} slot locked in`,
            expectedValue: exactValue,
            expectedSlot: slot,
            floorValue: exactValue,
            ceilingValue: exactValue,
            probabilities: {
              early: bucket === "early" ? 1 : 0,
              mid: bucket === "mid" ? 1 : 0,
              late: bucket === "late" ? 1 : 0,
            },
            slotProbabilities: slots.map((currentSlot) => currentSlot === slot ? 1 : 0),
            likelySlots: [{ slot, probability: 1 }],
          }];
        }

        const rawSlotProbabilities = slots.map((slot) => rosterProjection.slotProbabilities?.[slot] ?? (1 / totalTeams));
        const slotTotal = sum(rawSlotProbabilities) || 1;
        const slotProbabilities = rawSlotProbabilities.map((probability) => probability / slotTotal);
        const slotValues = slots.map((slot) => {
          const bucket = bucketForSlot(slot) as "early" | "mid" | "late";
          const currentSlotValue = pickFcValues[`${CURRENT_YEAR}-${pick.round}.${String(slot).padStart(2, "0")}`];
          if (currentSlotValue) {
            const seasonRoundValue = pickFcValues[`${pick.season}-${pick.round}`] || currentRoundValue(Number(pick.round)) || 1;
            const currentBase = currentRoundValue(Number(pick.round)) || 1;
            return Math.round((currentSlotValue as number) * (seasonRoundValue / currentBase));
          }
          return getBandValue(String(pick.season), Number(pick.round), bucket);
        });
        const bucketProbabilities = slotProbabilities.reduce((acc: Record<string, number>, probability, idx) => {
          const bucket = bucketForSlot(idx + 1);
          acc[bucket] = (acc[bucket] || 0) + probability;
          return acc;
        }, { early: 0, mid: 0, late: 0 });
        // Rank-based slot: integer 1–N where 1 = worst team in league (picks first).
        const expectedSlot = rosterRankSlot.get(Number(pick.roster_id)) ?? Math.round((totalTeams + 1) / 2);
        // Linear interpolation between the floor and ceiling slot values.
        // FantasyCalc has a huge slot-1 premium that makes raw per-slot values non-linear —
        // users expect slot 2 to be close to the range top, not halfway down. Interpolating
        // gives a fair expected value that scales evenly from worst team (slot 1 = ceiling)
        // to best team (slot N = floor).
        const ceilingValue = Math.max(...slotValues);
        const floorValue = Math.min(...slotValues);
        const expectedValue = totalTeams <= 1
          ? ceilingValue
          : Math.round(ceilingValue - (ceilingValue - floorValue) * (expectedSlot - 1) / (totalTeams - 1));
        const likelySlots = slotProbabilities
          .map((probability, idx) => ({ slot: idx + 1, probability }))
          .sort((a, b) => b.probability - a.probability)
          .slice(0, 3);
        const bestBucket = (Object.entries(bucketProbabilities).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || "mid") as "early" | "mid" | "late";
        // Derive finish range directly from slotProbabilities so it is always
        // consistent with expectedSlot and expectedValue — never stale.
        // slot k+1 is given to the team finishing (totalTeams - k)th, so
        // P(finish j) = slotProbabilities[totalTeams - j] (0-based).
        let cumFinish = 0;
        let floorFinishPos = totalTeams;
        let ceilFinishPos = totalTeams;
        let floorFound = false;
        for (let finishPos = 1; finishPos <= totalTeams; finishPos++) {
          cumFinish += slotProbabilities[totalTeams - finishPos] || 0;
          if (!floorFound && cumFinish >= 0.2) { floorFinishPos = finishPos; floorFound = true; }
          if (cumFinish >= 0.8) { ceilFinishPos = finishPos; break; }
        }
        const derivedFinishRange = `${floorFinishPos}-${ceilFinishPos}`;
        return [key, {
          bucket: bestBucket,
          label: `${bestBucket[0].toUpperCase()}${bestBucket.slice(1)} most likely`,
          expectedValue,
          expectedSlot,
          floorValue: Math.min(...slotValues),
          ceilingValue: Math.max(...slotValues),
          probabilities: {
            early: Math.round((bucketProbabilities.early || 0) * 100) / 100,
            mid: Math.round((bucketProbabilities.mid || 0) * 100) / 100,
            late: Math.round((bucketProbabilities.late || 0) * 100) / 100,
          },
          bandValues: {
            early: getBandValue(String(pick.season), Number(pick.round), "early"),
            mid: getBandValue(String(pick.season), Number(pick.round), "mid"),
            late: getBandValue(String(pick.season), Number(pick.round), "late"),
          },
          slotProbabilities,
          likelySlots,
          projectedFinish: rosterProjection.projectedFinish,
          finishRange: derivedFinishRange,
          issuerName: rosterProjection.ownerName,
          issuerPlayoffOdds: (() => {
            const playoffTeamCount = Number(selectedLeague?.settings?.playoff_teams || Math.ceil(totalTeams / 2));
            return Math.round(slotProbabilities.slice(totalTeams - playoffTeamCount).reduce((s, p) => s + p, 0) * 100);
          })(),
        }];
      })
    ) as Record<string, any>;
  }, [selectedLeague?.league_id, committedSimsByLeague, selectedLeagueSimulation, allPicks, pickFcValues, rosters.length]);
  const selectedLeagueMateProfiles = useMemo(() => {
    if (!selectedLeague || !rosters.length || !user?.user_id) return [];

    const dynastyValueForPlayer = (id: string) => calcFcValues[id] ?? (players as any)?.[id]?.value ?? 0;
    const myRoster = rosters.find((r: any) => r.owner_id === user.user_id);
    if (!myRoster) return [];

    const myProfile = getRosterDirectionProfile({
      rosterId: myRoster.roster_id,
      rosters,
      ownedPicks: allPicks,
      players,
      pickValues: pickFcValues,
      redraftValues,
      dynastyValueForPlayer,
    });

    return rosters
      .filter((r: any) => r.owner_id && r.owner_id !== user.user_id)
      .map((r: any) => {
        const directionProfile = getRosterDirectionProfile({
          rosterId: r.roster_id,
          rosters,
          ownedPicks: allPicks,
          players,
          pickValues: pickFcValues,
          redraftValues,
          dynastyValueForPlayer,
        });
        if (!directionProfile) return null;

        const rosterPlayers = (r.players || [])
          .map((id: string) => {
            const player = (players as any)?.[id];
            return player
              ? {
                  ...player,
                  dynValue: dynastyValueForPlayer(id),
                }
              : null;
          })
          .filter(Boolean)
          .filter((player: any) => ["QB", "RB", "WR", "TE"].includes(player.position));

        const posValueTotals = ["QB", "RB", "WR", "TE"].map((pos) => ({
          pos,
          total: rosterPlayers
            .filter((player: any) => player.position === pos)
            .reduce((sum: number, player: any) => sum + (player.dynValue || 0), 0),
        })).sort((a, b) => b.total - a.total);

        const tradeIntel = leagueMateTradeIntel[String(r.roster_id)] || {
          tradeCount30d: 0,
          bought: { QB: 0, RB: 0, WR: 0, TE: 0 },
          picksIn: 0,
          picksOut: 0,
          lastTradeAt: null,
        };
        const recentBuy = Object.entries(tradeIntel.bought || {}) as Array<[string, number]>;
        const recentBuyTop = [...recentBuy]
          .sort((a: any, b: any) => b[1] - a[1])[0];
        const fit = getTradePartnerFit({
          myProfile,
          oppProfile: directionProfile,
          tradeCount30d: tradeIntel.tradeCount30d,
        });
        const ownerCrossLeagueIntel = crossLeagueMateIntel[String(r.owner_id)] || null;
        const crossLeaguePreferenceFit = getCrossLeaguePreferenceFit({
          myProfile,
          crossLeagueIntel: ownerCrossLeagueIntel,
        });
        const crossLeagueTradeFit = getCrossLeagueTradeBehaviorFit({
          myProfile,
          crossLeagueIntel: ownerCrossLeagueIntel,
        });
        const totalFitScore = fit.fitScore + crossLeaguePreferenceFit.fitScore + crossLeagueTradeFit.fitScore;
        const combinedFitReasons = [
          ...fit.fitReasons,
          ...crossLeaguePreferenceFit.fitReasons,
          ...crossLeagueTradeFit.fitReasons,
        ].slice(0, 4);

        return {
          rosterId: r.roster_id,
          ownerId: r.owner_id,
          ownerName: (users as any)[r.owner_id] || `Team ${r.roster_id}`,
          directionProfile,
          tradeCount30d: tradeIntel.tradeCount30d || 0,
          picksIn30d: tradeIntel.picksIn || 0,
          picksOut30d: tradeIntel.picksOut || 0,
          lastTradeAt: tradeIntel.lastTradeAt,
          recentBuyLabel: recentBuyTop && recentBuyTop[1] > 0 ? `Recently bought ${recentBuyTop[0]}` : "No strong recent buy signal",
          buildBiasLabel: posValueTotals[0]?.total > 0 ? `${posValueTotals[0].pos}-heavy build` : "Balanced build",
          strongestPos: posValueTotals[0]?.pos || "-",
          secondPos: posValueTotals[1]?.pos || "-",
          motivation: getLeagueMateMotivation(directionProfile, tradeIntel.tradeCount30d || 0),
          fitScore: totalFitScore,
          fitLabel: getTradePartnerFitLabel(totalFitScore),
          fitReasons: combinedFitReasons,
          baseFitReasons: fit.fitReasons,
          crossLeagueFitReasons: [...crossLeaguePreferenceFit.fitReasons, ...crossLeagueTradeFit.fitReasons],
          crossLeagueSummary: ownerCrossLeagueIntel?.crossLeagueSummary || "Cross-league tendencies still loading.",
          crossLeagueTradeSummary: ownerCrossLeagueIntel?.crossLeagueTradeSummary || "Cross-league trade behavior still loading.",
          preferenceLabel: ownerCrossLeagueIntel?.preferenceLabel || "League-specific read only",
          tradePreferenceLabel: ownerCrossLeagueIntel?.tradePreferenceLabel || "Trade behavior still loading",
          preferredPositions: ownerCrossLeagueIntel?.preferredPositions || [],
          tradePreferredPositions: ownerCrossLeagueIntel?.tradePreferredPositions || [],
          repeatedPlayers: ownerCrossLeagueIntel?.repeatedPlayers || [],
          acquiredPlayers: ownerCrossLeagueIntel?.acquiredPlayers || [],
          totalDynastyLeagues: ownerCrossLeagueIntel?.totalDynastyLeagues || 0,
          averageAgeAllLeagues: ownerCrossLeagueIntel?.averageAgeAllLeagues || 0,
          crossLeagueTradeCount30d: ownerCrossLeagueIntel?.crossLeagueTradeCount30d || 0,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
        if (b.tradeCount30d !== a.tradeCount30d) return b.tradeCount30d - a.tradeCount30d;
        return a.ownerName.localeCompare(b.ownerName);
      });
  }, [selectedLeague?.league_id, rosters, user?.user_id, allPicks, players, pickFcValues, redraftValues, calcFcValues, leagueMateTradeIntel, users, crossLeagueMateIntel]);
  const selectedLeagueMateProfilesView =
    selectedLeagueMateProfiles.length > 0
      ? selectedLeagueMateProfiles
      : (selectedLeague?.league_id ? leagueMateProfileCache[selectedLeague.league_id] || [] : []);
  const activeLeagueHubGroup = useMemo(
    () => LEAGUE_HUB_GROUPS.find((group) => group.tabs.some((tab) => tab.id === leagueHubTab)) || LEAGUE_HUB_GROUPS[0],
    [leagueHubTab]
  );
  const leagueMateProfileByRosterId = useMemo(
    () => new Map(selectedLeagueMateProfilesView.map((profile: any) => [Number(profile.rosterId), profile])),
    [selectedLeagueMateProfilesView]
  );
  const tradePartnerRankings = useMemo(() => {
    if (!selectedLeague || !rosters.length || !user?.user_id || !selectedLeagueSimulation || !selectedLeagueDirection) return [];

    const myRoster = rosters.find((entry: any) => entry.owner_id === user.user_id);
    if (!myRoster) return [];

    const mySimRow = selectedLeagueSimulation.rowByRosterId.get(Number(myRoster.roster_id));
    // Use the fully adjusted profile (dynasty + redraft + sim + age) as the source of truth
    const myEffectiveProfile = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
    const myBuckets = getProfilePosBuckets(myEffectiveProfile);
    const strongPos = myBuckets.strong[0] || myEffectiveProfile.positionRanks?.sort((a: any, b: any) => a.rank - b.rank)?.[0]?.pos || "WR";
    const weakPos = myBuckets.weak[0] || myEffectiveProfile.positionRanks?.sort((a: any, b: any) => b.rank - a.rank)?.[0]?.pos || "RB";

    return selectedLeagueMateProfilesView
      .map((partner: any) => {
        const simRow = selectedLeagueSimulation.rowByRosterId.get(Number(partner.rosterId));
        const partnerPlayoffOdds = simRow?.playoffOdds ?? 0;
        // Apply the same three-factor adjustment to each partner's bucket
        const partnerAdjustedBucket = getAdjustedDirectionBucket(
          partner.directionProfile?.bucket,
          partner.directionProfile,
          partnerPlayoffOdds,
          !!simRow
        );
        const partnerAdjustedProfile = { ...partner.directionProfile, bucket: partnerAdjustedBucket };
        const partnerBuckets = getProfilePosBuckets(partnerAdjustedProfile);
        const isSeller = partnerPlayoffOdds < 50 || ["Rebuilder", "Blow Up", "Hopeless"].includes(partnerAdjustedBucket);
        const isBuyer = partnerPlayoffOdds >= 55 || ["Elite", "True Contender", "Almost There"].includes(partnerAdjustedBucket);
        const bestApproach =
          isSeller ? `Buy ${weakPos}` :
          isBuyer && partnerBuckets.weak.includes(strongPos) ? `Sell ${strongPos}` :
          partnerBuckets.strong.includes(weakPos) ? `Tier up at ${weakPos}` :
          `Explore 2-for-1`;
        const rankScore = Math.round(
          partner.fitScore +
          (isSeller ? 8 : 0) +
          (isBuyer ? 6 : 0) +
          (partnerBuckets.weak.includes(strongPos) ? 6 : 0) +
          (partnerBuckets.strong.includes(weakPos) ? 5 : 0) +
          Math.max(0, 12 - Math.abs((mySimRow?.playoffOdds ?? 50) - (simRow?.playoffOdds ?? 50)) / 6)
        );
        const negotiationNotes = [
          partner.motivation,
          partner.recentBuyLabel,
          partner.tradeCount30d >= 2 ? "Lead with a direct, actionable first offer." : "You may need a cleaner first offer and a clearer why-now pitch.",
        ].filter(Boolean).slice(0, 3);

        return {
          ...partner,
          // Override directionProfile with the adjusted version so downstream consumers
          // (recommendation cards, guardrails, etc.) all see the same bucket
          directionProfile: { ...partnerAdjustedProfile, bucketColor: getBucketColor(partnerAdjustedBucket) },
          playoffOdds: simRow?.playoffOdds ?? 0,
          titleOdds: simRow?.titleOdds ?? 0,
          finishRange: simRow?.finishRange || "-",
          oneOhOneOdds: simRow?.oneOhOneOdds ?? 0,
          bestApproach,
          rankScore,
          negotiationNotes,
          isSeller,
          isBuyer,
        };
      })
      .sort((a: any, b: any) => {
        if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
        if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
        return a.ownerName.localeCompare(b.ownerName);
      });
  }, [selectedLeague?.league_id, rosters, user?.user_id, selectedLeagueSimulation, selectedLeagueDirection, selectedLeagueMateProfilesView]);
  const tradeRecommendationCards = useMemo(() => {
    if (!selectedLeague || !rosters.length || !user?.user_id || !selectedLeagueDirection) return [];

    const myRoster = rosters.find((entry: any) => entry.owner_id === user.user_id);
    if (!myRoster) return [];

    // Use the fully adjusted profile — dynasty rank + redraft rank + sim + age all combined
    const myProfile = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
    const myBuckets = getProfilePosBuckets(myProfile);
    const myPlayoffOdds = (myProfile as any)?.playoffOdds ?? (selectedLeagueSimulation?.rowByRosterId?.get(Number(myRoster.roster_id))?.playoffOdds ?? 0);
    // A team below 50% to make playoffs should NEVER be buying points.
    // Winning 2 extra games moves you from 1.02 to 1.05 pick without any championship upside.
    // The only valid strategy is accumulating draft capital and young upside shots.
    const iAmTanking = myPlayoffOdds < 50;
    const iAmContending = myPlayoffOdds >= 50;
    const dynValueForPlayer = (id: string) => calcFcValues[id] ?? (players as any)?.[id]?.value ?? 0;
    const playerListForRoster = (rosterId: number) => {
      const rosterEntry = rosters.find((entry: any) => Number(entry.roster_id) === Number(rosterId));
      return (rosterEntry?.players || [])
        .map((id: string) => {
          const player = (players as any)?.[id];
          return player ? {
            ...player,
            dynValue: dynValueForPlayer(id),
            redValue: redraftValues[id] ?? 0,
          } : null;
        })
        .filter(Boolean)
        .filter((player: any) => ["QB", "RB", "WR", "TE"].includes(player.position));
    };
    const myPlayersDetailed = playerListForRoster(myRoster.roster_id);
    const myPicksDetailed = (allPicks as any[])
      .filter((pick: any) => Number(pick.owner_id) === Number(myRoster.roster_id))
      .map((pick: any) => {
        const key = `${pick.season}-${pick.round}-${pick.roster_id}`;
        const dynamic = selectedLeagueDynamicPickValues[key];
        return {
          ...pick,
          expectedValue: dynamic?.expectedValue ?? getStoredPickValue(pickFcValues, pick),
          dynamic,
          label: dynamic?.label || "Flat value",
          expectedSlot: dynamic?.expectedSlot ?? null,
        };
      })
      .sort((a: any, b: any) => b.expectedValue - a.expectedValue);

    const strongPos = myBuckets.strong[0] || myProfile?.positionRanks?.sort((a: any, b: any) => a.rank - b.rank)?.[0]?.pos || "WR";
    const weakPos = myBuckets.weak[0] || myProfile?.positionRanks?.sort((a: any, b: any) => b.rank - a.rank)?.[0]?.pos || "RB";
    const teamCount = rosters.length || 12;
    const weakPositions = new Set(
      (myProfile?.positionRanks || [])
        .filter((entry: any) => entry.rank >= Math.max(4, teamCount - 2))
        .map((entry: any) => entry.pos)
    );
    const strongPositions = new Set(
      (myProfile?.positionRanks || [])
        .filter((entry: any) => entry.rank <= Math.max(2, Math.ceil(teamCount / 3)))
        .map((entry: any) => entry.pos)
    );
    const agingSellCandidate = [...myPlayersDetailed]
      .filter((player: any) =>
        (player.position === "RB" && Number(player.age || 0) >= 25) ||
        (player.position === "QB" && Number(player.age || 0) >= 29) ||
        (["WR", "TE"].includes(player.position) && Number(player.age || 0) >= 28)
      )
      .sort((a: any, b: any) => (b.redValue - b.dynValue) - (a.redValue - a.dynValue))[0];
    const depthPieces = [...myPlayersDetailed]
      .filter((player: any) => player.position === strongPos)
      .sort((a: any, b: any) => a.dynValue - b.dynValue)
      .slice(0, 3);

    const recommendations: any[] = [];
    const sortedPartners = [...tradePartnerRankings];
    const isBlockedSellDisposition = (playerId?: string | null) =>
      !!playerId && playerDispositions[playerId]?.sell === "Not Willing to Trade";
    const isBlockedBuyDisposition = (playerId?: string | null) =>
      !!playerId && ["Zero Interest", "Skip"].includes(playerDispositions[playerId]?.buy || "");
    const assetValue = (asset: any) => asset?.expectedValue ?? asset?.dynValue ?? asset?.value ?? 0;
    const meaningfulPlayerThreshold = 350;
    const fairDeltaLimit = (total: number) => Math.max(250, Math.min(900, Math.round(total * 0.16)));
    // Waiver credit: same formula as trade calculator & trade finder (0.42× extra asset value, capped)
    const calcWaiverCredit = (extras: number[]) =>
      extras.reduce((s, v, i) => s + Math.min(Math.round(v * 0.42), i === 0 ? 550 : 750), 0);
    const isFairPackage = (give: any[], receive: any[]) => {
      const giveVals = give.map((a: any) => assetValue(a)).sort((a, b) => b - a);
      const receiveVals = receive.map((a: any) => assetValue(a)).sort((a, b) => b - a);
      const rawGive = Math.round(giveVals.reduce((s, v) => s + v, 0));
      const rawReceive = Math.round(receiveVals.reduce((s, v) => s + v, 0));
      if (rawGive <= 0 || rawReceive <= 0) return false;
      // Apply waiver credit to the side with fewer assets (same as calculator/finder)
      const assetDiff = giveVals.length - receiveVals.length;
      const waiverAdj = assetDiff > 0
        ? calcWaiverCredit(giveVals.slice(receiveVals.length))
        : assetDiff < 0
        ? calcWaiverCredit(receiveVals.slice(giveVals.length))
        : 0;
      const giveAdj = rawGive + (assetDiff < 0 ? waiverAdj : 0);
      const receiveAdj = rawReceive + (assetDiff > 0 ? waiverAdj : 0);
      const delta = Math.abs(receiveAdj - giveAdj);
      const ratio = receiveAdj / Math.max(giveAdj, 1);
      return delta <= fairDeltaLimit(Math.max(giveAdj, receiveAdj)) && ratio >= 0.78 && ratio <= 1.22;
    };
    const chooseClosestPackage = (packages: any[][], targetValue: number, opts?: { minValue?: number; maxValue?: number }) => {
      const minValue = opts?.minValue ?? Math.max(400, Math.round(targetValue * 0.78));
      const maxValue = opts?.maxValue ?? Math.round(targetValue * 1.22);
      return packages
        .map((pkg) => ({
          assets: pkg,
          total: Math.round(sum(pkg.map((asset: any) => assetValue(asset)))),
        }))
        .filter((entry) => entry.total >= minValue && entry.total <= maxValue)
        .sort((a, b) => Math.abs(a.total - targetValue) - Math.abs(b.total - targetValue))[0] || null;
    };
    const twoAssetCombos = (assets: any[]) => {
      const combos: any[][] = [];
      for (let i = 0; i < assets.length; i++) {
        for (let j = i + 1; j < assets.length; j++) {
          combos.push([assets[i], assets[j]]);
        }
      }
      return combos;
    };
    const buildCard = ({
      archetype,
      partner,
      give,
      receive,
      whyYou,
      whyThem,
      summary,
    }: any) => {
      const giveValsAdj = give.map((a: any) => assetValue(a)).sort((a: number, b: number) => b - a);
      const receiveValsAdj = receive.map((a: any) => assetValue(a)).sort((a: number, b: number) => b - a);
      const giveTotal = Math.round(giveValsAdj.reduce((s: number, v: number) => s + v, 0));
      const receiveTotal = Math.round(receiveValsAdj.reduce((s: number, v: number) => s + v, 0));
      const assetDiffCard = giveValsAdj.length - receiveValsAdj.length;
      const waiverAdjCard = assetDiffCard > 0
        ? calcWaiverCredit(giveValsAdj.slice(receiveValsAdj.length))
        : assetDiffCard < 0
        ? calcWaiverCredit(receiveValsAdj.slice(giveValsAdj.length))
        : 0;
      const giveTotalAdj = giveTotal + (assetDiffCard < 0 ? waiverAdjCard : 0);
      const receiveTotalAdj = receiveTotal + (assetDiffCard > 0 ? waiverAdjCard : 0);
      const packageDelta = receiveTotalAdj - giveTotalAdj;
      if (give.some((asset: any) => !asset?.season && isBlockedSellDisposition(asset?.player_id))) return null;
      if (receive.some((asset: any) => !asset?.season && isBlockedBuyDisposition(asset?.player_id))) return null;
      if (!isFairPackage(give, receive)) return null;
      if (give.some((asset: any) => asset?.dynValue != null && asset.dynValue < meaningfulPlayerThreshold && !asset?.season)) return null;
      if (receive.some((asset: any) => asset?.dynValue != null && asset.dynValue < meaningfulPlayerThreshold && !asset?.season)) return null;
      const archetypeBonus = archetype === "Draft Capital" ? 5 : archetype === "Tier Up" ? 4 : archetype === "Buy Low" ? 3 : 2;
      const recommendationScore = Math.round(
        partner.rankScore +
        Math.max(0, 16 - Math.abs(packageDelta) / 140) +
        archetypeBonus
      );
      return {
        archetype,
        partnerName: partner.ownerName,
        fitLabel: partner.fitLabel,
        give,
        receive,
        whyYou,
        whyThem,
        summary,
        partnerPlayoffOdds: partner.playoffOdds,
        partnerTitleOdds: partner.titleOdds,
        partnerRankScore: partner.rankScore,
        recommendationScore,
        giveTotal,
        receiveTotal,
        packageDelta,
        bestApproach: partner.bestApproach,
        negotiationNotes: partner.negotiationNotes,
        openingOffer: `Open with the clean version first: ${archetype.toLowerCase()} framed around ${partner.bestApproach.toLowerCase()}.`,
      };
    };

    const isAgingAsset = (player: any) =>
      (player.position === "RB" && Number(player.age || 0) >= 25) ||
      (player.position === "QB" && Number(player.age || 0) >= 29) ||
      (["WR", "TE"].includes(player.position) && Number(player.age || 0) >= 28);
    const isYoungInsulation = (player: any) =>
      (["QB", "WR"].includes(player.position) && Number(player.age || 99) <= 25) ||
      (player.position === "TE" && Number(player.age || 99) <= 25) ||
      (player.position === "RB" && Number(player.age || 99) <= 23);
    // A floor filler wins you games now but adds no dynasty upside — dangerous for tanking teams
    // because it moves you from 1.02 to 1.05 pick without any realistic championship path.
    const isFloorFiller = (player: any) =>
      (player.position === "RB" && Number(player.age || 0) >= 24) ||
      (player.position === "QB" && Number(player.age || 0) >= 28) ||
      (["WR", "TE"].includes(player.position) && Number(player.age || 0) >= 27);
    const getPickPackage = (rosterId: number) =>
      (allPicks as any[])
        .filter((pick: any) => Number(pick.owner_id) === Number(rosterId))
        .map((pick: any) => {
          const dynKey = `${pick.season}-${pick.round}-${pick.roster_id}`;
          const dyn = selectedLeagueDynamicPickValues[dynKey];
          return {
            ...pick,
            expectedValue: dyn?.expectedValue ?? getStoredPickValue(pickFcValues, pick),
            label: dyn?.label || "Flat value",
            expectedSlot: dyn?.expectedSlot ?? null,
          };
        })
        .filter((pick: any) => pick.expectedValue > 0)
        .sort((a: any, b: any) => b.expectedValue - a.expectedValue)
        .slice(0, 6);
    const comboPackages = (assets: any[], maxItems = 2) => {
      const singles = assets.map((asset: any) => [asset]);
      if (maxItems <= 1) return singles;
      return [...singles, ...twoAssetCombos(assets)];
    };
    const classifyArchetype = (give: any[], receive: any[], partner: any) => {
      const givePlayers = give.filter((asset: any) => !asset?.season);
      const receivePlayers = receive.filter((asset: any) => !asset?.season);
      const givePicks = give.filter((asset: any) => !!asset?.season);
      const receivePicks = receive.filter((asset: any) => !!asset?.season);
      if (receivePicks.length > 0 && givePlayers.some((player: any) => isAgingAsset(player))) return "Sell High";
      // Tanking teams trading floor fillers for picks = Draft Capital accumulation
      if (iAmTanking && receivePicks.length > 0 && givePlayers.some((player: any) => isFloorFiller(player))) return "Draft Capital";
      if (givePicks.length > 0 && receivePlayers.some((player: any) => weakPositions.has(player.position))) return "Buy Low";
      if (give.length > receive.length && receivePlayers.length === 1) return "2-for-1";
      if (give.length >= 2 && receivePlayers.length === 1 && receivePlayers[0]?.dynValue > Math.max(...givePlayers.map((player: any) => player.dynValue || 0), 0)) return "Tier Up";
      if (partner?.isSeller) return "Insulation Buy";
      return "Value Rebalance";
    };
    const scoreRecommendationFit = (give: any[], receive: any[], partner: any) => {
      const givePlayers = give.filter((asset: any) => !asset?.season);
      const receivePlayers = receive.filter((asset: any) => !asset?.season);
      const givePicks = give.filter((asset: any) => !!asset?.season);
      const receivePicks = receive.filter((asset: any) => !!asset?.season);
      const partnerBuckets = getProfilePosBuckets(partner.directionProfile);
      let myScore = 0;
      let theirScore = 0;

      if (["Rebuilder", "Blow Up", "Hopeless"].includes(myProfile.bucket)) {
        myScore += givePlayers.filter((player: any) => isAgingAsset(player)).length * 8;
        myScore += givePlayers.filter((player: any) => isFloorFiller(player) && !isAgingAsset(player)).length * 5;
        myScore += receivePlayers.filter((player: any) => isYoungInsulation(player)).length * 8;
        myScore += receivePicks.length * 7;
        myScore -= receivePlayers.filter((player: any) => isAgingAsset(player)).length * 16;
        myScore -= receivePlayers.filter((player: any) => isFloorFiller(player) && !isAgingAsset(player)).length * 10;
      } else if (["Elite", "True Contender", "Almost There"].includes(myProfile.bucket)) {
        myScore += receivePlayers.filter((player: any) => weakPositions.has(player.position)).length * 8;
        myScore += receivePlayers.reduce((sum: number, player: any) => sum + (player.redValue || 0), 0) / 350;
        myScore -= receivePicks.length * 3;
        // RBs injure at the highest rate and are hardest to replace off waivers.
        // Contending teams should value RB depth even when RB is already a "strong" position.
        myScore += receivePlayers.filter((player: any) =>
          player.position === "RB" && Number(player.age || 0) >= 22 && Number(player.age || 0) <= 26
        ).length * 5;
      } else if (iAmTanking) {
        // Purgatory/Fading teams below 50% playoff odds — buying points is COUNTERPRODUCTIVE.
        // Going from 4-9 to 6-7 moves the 1.02 to 1.05 without any playoff upside.
        // Only valid moves: sell floor fillers, accumulate picks, target young upside shots.
        myScore += givePlayers.filter((player: any) => isFloorFiller(player)).length * 7;
        myScore += givePlayers.filter((player: any) => isAgingAsset(player)).length * 8;
        myScore += receivePlayers.filter((player: any) => isYoungInsulation(player)).length * 9;
        myScore += receivePicks.length * 10;
        myScore -= receivePlayers.filter((player: any) => isFloorFiller(player)).length * 16;
        myScore -= receivePlayers.filter((player: any) => isAgingAsset(player)).length * 20;
        // Filling a weak position with a floor player is exactly wrong — hurts draft slot
        myScore -= receivePlayers.filter((player: any) => weakPositions.has(player.position) && isFloorFiller(player)).length * 8;
      } else {
        // True middle — realistic playoff path, balanced approach
        myScore += receivePlayers.filter((player: any) => weakPositions.has(player.position)).length * 6;
        myScore += receivePlayers.filter((player: any) => isYoungInsulation(player)).length * 4;
        myScore += receivePicks.length * 3;
      }

      if (partner.isBuyer) {
        theirScore += givePlayers.filter((player: any) => partnerBuckets.weak.includes(player.position)).length * 8;
        theirScore += givePlayers.reduce((sum: number, player: any) => sum + (player.redValue || 0), 0) / 350;
        theirScore -= receivePicks.length * 2;
      } else if (partner.isSeller) {
        theirScore += givePicks.length * 7;
        theirScore += givePlayers.filter((player: any) => isYoungInsulation(player)).length * 7;
        theirScore += receivePlayers.filter((player: any) => isAgingAsset(player)).length * 6;
        theirScore -= givePlayers.filter((player: any) => isAgingAsset(player)).length * 6;
      } else {
        theirScore += givePlayers.filter((player: any) => partnerBuckets.weak.includes(player.position)).length * 5;
        theirScore += givePicks.length * 3;
      }

      return { myScore, theirScore };
    };
    const passesRecommendationGuard = (give: any[], receive: any[], partner: any) => {
      const givePlayers = give.filter((asset: any) => !asset?.season);
      const receivePlayers = receive.filter((asset: any) => !asset?.season);
      const givePicks = give.filter((asset: any) => !!asset?.season);
      const receivePicks = receive.filter((asset: any) => !!asset?.season);
      const partnerBuckets = getProfilePosBuckets(partner.directionProfile);
      const incomingAging = receivePlayers.filter((player: any) => isAgingAsset(player)).length;
      const incomingYoung = receivePlayers.filter((player: any) => isYoungInsulation(player)).length;
      const outgoingAging = givePlayers.filter((player: any) => isAgingAsset(player)).length;
      const givesPremiumCurrentPick = givePicks.some((pick: any) => String(pick.season) === CURRENT_YEAR && Number(pick.round) === 1);
      const receivesPremiumCurrentPick = receivePicks.some((pick: any) => String(pick.season) === CURRENT_YEAR && Number(pick.round) === 1);

      if (["Rebuilder", "Blow Up", "Hopeless"].includes(myProfile.bucket)) {
        if (incomingAging > 0) return false;
        if (givesPremiumCurrentPick && incomingYoung === 0 && receivePicks.length === 0) return false;
        if (receivePlayers.some((player: any) => player.position === "RB" && Number(player.age || 99) >= 24)) return false;
      }

      // Tanking teams (below 50% playoff odds) in non-rebuild buckets must follow the same discipline.
      // Buying points is actively harmful — it ruins your draft slot without adding championship upside.
      // The ONLY valid acquisitions are: young upside shots, future picks, draft capital.
      if (iAmTanking && !["Rebuilder", "Blow Up", "Hopeless"].includes(myProfile.bucket)) {
        // Never take on aging assets regardless of position need
        if (incomingAging > 0) return false;
        // Never take on floor fillers unless also getting picks — you'd just win extra games
        if (receivePlayers.some((p: any) => isFloorFiller(p)) && receivePicks.length === 0 && incomingYoung === 0) return false;
        // Must receive picks or young upside — point fillers without future capital are vetoed
        if (receivePlayers.length > 0 && receivePlayers.every((p: any) => !isYoungInsulation(p)) && receivePicks.length === 0) return false;
        // Guard premium current picks — should only move them for meaningful future capital
        if (givesPremiumCurrentPick && incomingYoung === 0 && receivePicks.length === 0) return false;
        // Older RBs are the most dangerous floor-fillers: they win games now, crater fast
        if (receivePlayers.some((p: any) => p.position === "RB" && Number(p.age || 99) >= 24)) return false;
      }

      if (["Elite", "True Contender", "Almost There"].includes(myProfile.bucket)) {
        if (receive.length > 0 && receivePlayers.length === 0) return false;
        if (receivePlayers.length > 0 && receivePlayers.every((player: any) => isYoungInsulation(player)) && receivePicks.length > 0 && givePlayers.length > 0) {
          return false;
        }
      }

      if (partner.isBuyer) {
        const pointsComingToPartner = givePlayers.reduce((sum: number, player: any) => sum + (player.redValue || 0), 0);
        if (pointsComingToPartner <= 0 && givePicks.length > 0) return false;
        if (partnerBuckets.weak.length > 0 && !givePlayers.some((player: any) => partnerBuckets.weak.includes(player.position)) && pointsComingToPartner < 1000) {
          return false;
        }
      }

      if (partner.isSeller) {
        if (outgoingAging > 0 && givePicks.length === 0 && givePlayers.filter((player: any) => isYoungInsulation(player)).length === 0) return false;
        if (receivesPremiumCurrentPick && partner.playoffOdds > 55) return false;
      }

      return true;
    };
    const getCandidateText = (archetype: string, partner: any, give: any[], receive: any[]) => {
      const givePlayers = give.filter((asset: any) => !asset?.season);
      const receivePlayers = receive.filter((asset: any) => !asset?.season);
      const receivePicks = receive.filter((asset: any) => !!asset?.season);
      if (archetype === "Draft Capital") {
        return {
          whyYou: `At ${Math.round(myPlayoffOdds)}% to make the playoffs, buying points is counterproductive — getting marginally better moves you from a 1.02 to a 1.05 without any realistic championship path. Converting this floor player into picks preserves your draft slot and maximizes the only real lever you have.`,
          whyThem: `${partner.ownerName} gets production that matches a buying window. The floor player helps them now; the picks help you long-term.`,
          summary: "A draft capital accumulation trade that protects your rebuild trajectory without surrendering cornerstone pieces.",
        };
      }
      if (archetype === "Sell High") {
        return {
          whyYou: "Moves present production into future insulation without waiting for the market to cool.",
          whyThem: `${partner.ownerName} gets immediate points that better match a buying profile.`,
          summary: "A fair veteran-for-future package that aligns with both roster timelines.",
        };
      }
      if (archetype === "Buy Low" || archetype === "Insulation Buy") {
        return {
          whyYou: "Targets younger insulation without paying a reckless premium.",
          whyThem: `${partner.ownerName} gets the kind of future value a seller should actually consider.`,
          summary: "A future-facing package built around a player they can realistically move.",
        };
      }
      if (archetype === "2-for-1" || archetype === "Tier Up") {
        return {
          whyYou: `Converts extra depth into one stronger piece at a weaker spot without blowing past fair value.`,
          whyThem: `${partner.ownerName} gets multiple assets that better fit their roster shape.`,
          summary: "A balanced consolidation deal that should make sense to both sides.",
        };
      }
      return {
        whyYou: `Improves roster shape with a package that stays inside a realistic value band.`,
        whyThem: `${partner.ownerName} gets assets that better match their profile and current incentives.`,
        summary: receivePicks.length > 0
          ? "A fair rebalance that includes future insulation."
          : `A fair rebalance centered on ${receivePlayers[0]?.position || "roster"} value.`,
      };
    };

    sortedPartners.forEach((partner: any) => {
      const partnerPlayers = playerListForRoster(Number(partner.rosterId));
      const partnerPicks = getPickPackage(Number(partner.rosterId));
      const partnerBuckets = getProfilePosBuckets(partner.directionProfile);

      const myOfferPlayers = myPlayersDetailed
        .filter((player: any) => {
          const disp = playerDispositions[player.player_id];
          if (isBlockedSellDisposition(player.player_id)) return false;
          // Never offer players I've explicitly tagged as "buy" — I want them
          if (disp?.buy) return false;
          // Always include players I've tagged as "sell" (lower threshold: just needs some real value)
          if (disp?.sell) return player.dynValue >= 150;
          // Default criteria: strong positions, aging assets, or partner's weak spots
          return (
            player.dynValue >= meaningfulPlayerThreshold &&
            (
              strongPositions.has(player.position) ||
              isAgingAsset(player) ||
              (iAmTanking && isFloorFiller(player)) ||
              partnerBuckets.weak.includes(player.position)
            )
          );
        })
        .sort((a: any, b: any) => {
          // Sell-tagged players sort first so they're prioritized in combo generation
          const aIsSell = playerDispositions[a.player_id]?.sell ? 1 : 0;
          const bIsSell = playerDispositions[b.player_id]?.sell ? 1 : 0;
          if (bIsSell !== aIsSell) return bIsSell - aIsSell;
          return a.dynValue - b.dynValue;
        })
        .slice(0, 12);
      const myOfferPicks = myPicksDetailed.slice(0, 5);

      const partnerTradeablePlayers = partnerPlayers
        .filter((player: any) =>
          !isBlockedBuyDisposition(player.player_id) &&
          player.dynValue >= meaningfulPlayerThreshold &&
          (
            // Always target players I've explicitly flagged as buy interest, regardless of profile
            !!playerDispositions[player.player_id]?.buy ||
            // Contending teams target positional needs; tanking teams target youth/upside only
            (iAmContending && weakPositions.has(player.position)) ||
            (iAmTanking && isYoungInsulation(player)) ||
            (partner.isSeller && (isAgingAsset(player) || isYoungInsulation(player))) ||
            (partner.isBuyer && partnerBuckets.strong.includes(player.position))
          )
        )
        .sort((a: any, b: any) => {
          // Buy-tagged players sort first
          const aIsBuy = playerDispositions[a.player_id]?.buy ? 1 : 0;
          const bIsBuy = playerDispositions[b.player_id]?.buy ? 1 : 0;
          if (bIsBuy !== aIsBuy) return bIsBuy - aIsBuy;
          return b.dynValue - a.dynValue;
        })
        .slice(0, 12);

      const givePackages = comboPackages([...myOfferPlayers, ...myOfferPicks], 2).slice(0, 45);
      const receivePackages = comboPackages([...partnerTradeablePlayers, ...partnerPicks], 2).slice(0, 45);
      const candidateCards: any[] = [];
      const tryBuildCandidates = (minimumFit: number, bandFloor: number, bandCeil: number) => {
        givePackages.forEach((givePkg: any[]) => {
          const giveTotal = Math.round(sum(givePkg.map((asset: any) => assetValue(asset))));
          if (giveTotal < meaningfulPlayerThreshold) return;
          const matchedReceive = chooseClosestPackage(receivePackages, giveTotal, {
            minValue: Math.round(giveTotal * bandFloor),
            maxValue: Math.round(giveTotal * bandCeil),
          });
          if (!matchedReceive) return;
          const receivePkg = matchedReceive.assets;
          if (!passesRecommendationGuard(givePkg, receivePkg, partner)) return;
          const fit = scoreRecommendationFit(givePkg, receivePkg, partner);
          if (fit.myScore < minimumFit || fit.theirScore < minimumFit) return;

          const archetype = classifyArchetype(givePkg, receivePkg, partner);
          const text = getCandidateText(archetype, partner, givePkg, receivePkg);
          const card = buildCard({
            archetype,
            partner,
            give: givePkg,
            receive: receivePkg,
            whyYou: text.whyYou,
            whyThem: text.whyThem,
            summary: text.summary,
          });
          if (!card) return;
          candidateCards.push({
            ...card,
            recommendationScore: card.recommendationScore + fit.myScore + fit.theirScore,
          });
        });
      };

      tryBuildCandidates(6, 0.82, 1.12);
      if (candidateCards.length === 0) tryBuildCandidates(4, 0.86, 1.14);
      if (candidateCards.length === 0) tryBuildCandidates(3, 0.9, 1.1);

      // ── Per-partner lottery ticket candidates ─────────────────────────────
      // "Outside top 150" = dynValue < 700 but still has real upside potential.
      // These compete with regular cards so the single best deal per partner wins.
      // Dispositions: skip "Zero Interest" receive targets; boost "Buy Low" targets.
      const LOTTERY_CEILING = 700;
      const roundOrd = (r: number) => r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : `${r}th`;
      const myLotteryPicks = myPicksDetailed.filter((p: any) => Number(p.round) >= 3);
      if (myLotteryPicks.length > 0) {
        partnerPlayers
          .filter((p: any) => {
            if (playerDispositions[p.player_id]?.buy === "Zero Interest") return false;
            const age = Number(p.age || 99);
            const val = Number(p.dynValue || 0);
            if (val < 60 || val >= LOTTERY_CEILING) return false;
            if (p.position === "RB" && age > 23) return false;
            if (p.position === "QB" && age > 26) return false;
            if (["WR", "TE"].includes(p.position) && age > 27) return false;
            return true;
          })
          .sort((a: any, b: any) => b.dynValue - a.dynValue)
          .slice(0, 3)
          .forEach((target: any) => {
            const targetVal = Number(target.dynValue || 0);
            const bestPick = myLotteryPicks
              .map((p: any) => ({ ...p, diff: Math.abs(assetValue(p) - targetVal) }))
              .sort((a: any, b: any) => a.diff - b.diff)[0];
            if (!bestPick) return;
            const pickVal = assetValue(bestPick);
            if (pickVal <= 0 || targetVal <= 0) return;
            if (targetVal / pickVal < 0.3 || targetVal / pickVal > 1.8) return;
            const dispBonus = playerDispositions[target.player_id]?.buy === "Buy Low" ? 3
              : playerDispositions[target.player_id]?.buy === "Buy at Market" ? 1 : 0;
            candidateCards.push({
              archetype: "Lottery Ticket",
              partnerName: partner.ownerName,
              fitLabel: partner.fitLabel,
              give: [bestPick],
              receive: [target],
              whyYou: `${target.full_name} is priced outside the top 150 right now but has the age and upside to break into starter value. Worst case: a late pick you were unlikely to hit on. Best case: a future contributor at almost nothing.`,
              whyThem: `${partner.ownerName} converts a developmental player into a guaranteed future pick.`,
              summary: `Low-stakes upside bet: a ${roundOrd(Number(bestPick.round))}-round pick for a young player with breakout potential.`,
              partnerPlayoffOdds: partner.playoffOdds,
              partnerTitleOdds: partner.titleOdds,
              partnerRankScore: partner.rankScore,
              recommendationScore: Math.round(partner.rankScore * 0.4 + 8 + dispBonus),
              giveTotal: Math.round(pickVal),
              receiveTotal: Math.round(targetVal),
              packageDelta: Math.round(targetVal - pickVal),
              bestApproach: partner.bestApproach,
              negotiationNotes: partner.negotiationNotes || [],
              openingOffer: `Keep it casual — "I like ${target.full_name}, would you do him for my ${bestPick.season} ${roundOrd(Number(bestPick.round))}?"`,
              isLottery: true,
            });
          });
      }

      const bestCard = candidateCards
        .sort((a: any, b: any) => b.recommendationScore - a.recommendationScore)[0];
      if (bestCard) recommendations.push(bestCard);
    });

    return recommendations
      .filter(Boolean)
      .filter((card: any) =>
        !card.give.some((asset: any) => !asset?.season && isBlockedSellDisposition(asset?.player_id)) &&
        !card.receive.some((asset: any) => !asset?.season && isBlockedBuyDisposition(asset?.player_id))
      )
      .sort((a: any, b: any) => b.recommendationScore - a.recommendationScore)
      .slice(0, sortedPartners.length || 12);
  }, [
    selectedLeague?.league_id,
    rosters,
    user?.user_id,
    selectedLeagueDirection,
    selectedLeagueDirectionAdjusted,
    selectedLeagueSimulation,
    calcFcValues,
    players,
    redraftValues,
    allPicks,
    selectedLeagueDynamicPickValues,
    pickFcValues,
    tradePartnerRankings,
    playerDispositions,
  ]);
  useEffect(() => {
    if (!supabaseUser || !selectedLeague?.league_id || selectedLeagueMateProfiles.length === 0) return;
    supabase.from("leaguemate_profiles").upsert(
      {
        user_id: supabaseUser.id,
        league_id: selectedLeague.league_id,
        profiles: selectedLeagueMateProfiles,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,league_id" }
    ).then(() => {});
  }, [supabaseUser?.id, selectedLeague?.league_id, selectedLeagueMateProfiles]);

  // Save simulation results to Supabase on demand and freeze a local snapshot for
  // pick valuations. The frozen snapshot (localStorage + state) is the source of truth
  // for pick values — it never drifts between sim runs.
  const saveSimulationToSupabase = (leagueId: string, simRows: any[]) => {
    const now = new Date().toISOString();
    // Always update local state and localStorage — these are the source of truth
    // for pick valuations and must work even when Supabase auth is unavailable.
    const newEntries = Object.fromEntries(
      simRows.map((row: any) => [row.rosterId, {
        league_id: leagueId,
        roster_id: row.rosterId,
        playoff_odds: row.playoffOdds ?? 0,
        title_odds: row.titleOdds ?? 0,
        expected_wins: row.expectedWins ?? 0,
        avg_finish: row.avgFinish ?? 0,
        finish_range: row.finishRange ?? "",
        computed_at: now,
      }])
    );
    setLeagueSimCache((prev) => ({ ...prev, [leagueId]: newEntries }));
    const frozenRows = Object.fromEntries(
      simRows.map((row: any) => [row.rosterId, {
        slotProbabilities: row.slotProbabilities ?? [],
        projectedFinish: row.projectedFinish ?? 0,
        finishRange: row.finishRange ?? "",
        ownerName: row.ownerName ?? "",
        playoffOdds: row.playoffOdds ?? 0,
        computed_at: now,
      }])
    );
    setCommittedSimsByLeague((prev) => {
      const next = { ...prev, [leagueId]: frozenRows };
      try { localStorage.setItem("committedSimRows_v2", JSON.stringify(next)); } catch {}
      return next;
    });
    // Write to Supabase only when authenticated.
    if (supabaseUser) {
      const rows = simRows.map((row: any) => ({
        user_id: supabaseUser.id,
        league_id: leagueId,
        roster_id: row.rosterId,
        playoff_odds: row.playoffOdds ?? 0,
        title_odds: row.titleOdds ?? 0,
        expected_wins: row.expectedWins ?? 0,
        avg_finish: row.avgFinish ?? 0,
        finish_range: row.finishRange ?? "",
        computed_at: now,
      }));
      supabase
        .from("league_simulations")
        .upsert(rows, { onConflict: "user_id,league_id,roster_id" })
        .then(() => {});
    }
  };

  // Queue state machine: when the front of the queue is ready (loadRoster finished),
  // save the sim, advance the queue, and start loading the next league.
  useEffect(() => {
    if (!simQueue.length) return;
    if (readyLeagueId !== simQueue[0]) return;

    const leagueId = simQueue[0];
    // Only save if the live sim is actually for this league — guards against a stale
    // selectedLeagueSimulation computed for a different selectedLeague.
    if (
      selectedLeagueSimulation?.rows?.length &&
      selectedLeague?.league_id === leagueId
    ) {
      saveSimulationToSupabase(leagueId, selectedLeagueSimulation.rows);
    }

    const remaining = simQueue.slice(1);
    setSimQueue(remaining);
    setSimProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : null);

    if (remaining.length > 0) {
      const nextLeague = leagues.find((l: any) => l.league_id === remaining[0]);
      if (nextLeague) loadRoster(nextLeague);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simQueue, readyLeagueId, selectedLeagueSimulation, selectedLeague?.league_id]);

  const handleRunAllSims = () => {
    if (!leagues.length) return;
    const leagueIds = (leagues as any[]).map((l: any) => l.league_id);
    setSimProgress({ done: 0, total: leagueIds.length });
    setReadyLeagueId(null); // clear so the effect can't fire with stale data
    setSimSalt(Math.floor(Math.random() * 1_000_000)); // new salt → different sim results each run
    setSimQueue(leagueIds);
    const first = (leagues as any[]).find((l: any) => l.league_id === leagueIds[0]);
    if (first) loadRoster(first); // always reload to guarantee fresh data
  };
  const draftedPlayerIds = useMemo(
    () => new Set(draftPicks.map((pick: any) => String(pick.player_id)).filter(Boolean)),
    [draftPicks]
  );

  // ── Draft board prediction engine ─────────────────────────────────────────
  // Key design decisions:
  // - Actual picks detected by pick_no (overall pick number), not by roster matching
  // - Non-user slots: ranked by Sleeper ADP position (relative rookie rank, not absolute value)
  // - User's slots: ranked by their personal big board
  // - Need multiplier capped at 1.20 — tiebreaker only, never overrides ADP tier
  // - allPicks.owner_id = current owner after trades (used for slot ownership)
  const predictedDraftPicks = useMemo(() => {
    if (!draftSettings || !rosters.length || !rookies.length || !selectedLeague) return {};

    const numTeams = rosters.length;
    const numRounds: number = draftSettings.rounds || 4;
    const isSnake = (draftSettings.type || "snake") !== "linear";
    const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;

    // Strip Jr./Sr./II/III suffixes before collapsing to alpha-only so names from
    // Sleeper ("Omar Cooper") and FantasyCalc ("Omar Cooper Jr.") still match.
    const normName = (n: string) =>
      (n || "").toLowerCase()
        .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
        .replace(/[^a-z]/g, "");

    // rosterId → userId map — needed to look up owner tendencies
    const rosterToUserId: Record<number, string> = {};
    (rosters as any[]).forEach((r: any) => { rosterToUserId[Number(r.roster_id)] = r.owner_id; });

    // Average positional distribution across all dynasty rookie drafts (baseline)
    const leagueAvgRate: Record<string, number> = { QB: 0.12, RB: 0.28, WR: 0.48, TE: 0.12 };

    // Per-owner tendency multiplier: how much more/less likely vs. league average
    // Capped at 0.75× – 1.30× so it influences without overriding dynasty value
    const tendencyMult = (rosterId: number | null, pos: string): number => {
      if (!rosterId) return 1;
      const userId = rosterToUserId[rosterId];
      if (!userId) return 1;
      const rates = ownerDraftTendencies[userId];
      if (!rates) return 1;
      const ownerRate = rates[pos] ?? (leagueAvgRate[pos] ?? 0.25);
      const avgRate = leagueAvgRate[pos] ?? 0.25;
      const ratio = ownerRate / avgRate;
      return Math.max(0.75, Math.min(1.30, ratio));
    };

    // Build name→dynasty value map from Sleeper players dict + FC values
    // Needed because rookies use FC player_ids which may differ from Sleeper player_ids
    const valueByNormName: Record<string, number> = {};
    Object.entries(players as any).forEach(([id, p]: [string, any]) => {
      const val = calcFcValues[id] ?? (p as any).value ?? 0;
      if (val > 0 && (p as any).full_name) {
        const key = normName((p as any).full_name);
        if (!valueByNormName[key] || val > valueByNormName[key]) valueByNormName[key] = val;
      }
    });
    const getRookieValue = (r: any): number =>
      (r.player_id ? (calcFcValues[r.player_id] ?? 0) : 0) || valueByNormName[normName(r.name)] || 0;

    // Unified player pool for non-user picks.
    // Sort key uses BOTH dynasty value (FC) and ADP so the right signal always wins:
    //   - Players with FC dynasty value → sort by value descending (higher = earlier pick)
    //   - Players with ADP but no value → ADP ascending interpolated into value scale
    //   - Players with neither → board rank tiebreaker at the very end
    // This prevents ADP name-matching failures (e.g. Love at MAX_SAFE_INTEGER adp)
    // from burying high-value players — their FC value pulls them back to the top.
    const fullPool = [...rookies]
      .map((r: any, boardIdx: number) => {
        const dynVal = getRookieValue(r);
        const hasAdp = typeof r.adp === "number" && r.adp < 9999;
        let sortKey: number;
        if (dynVal > 0) {
          // FC value is authoritative — higher value = lower sort key (earlier pick)
          // Adjust by ADP within same value tier for fine-grained ordering
          const adpAdj = hasAdp ? r.adp * 0.01 : 0;
          sortKey = -dynVal + adpAdj;           // e.g. Love: -8000+0.19 = -7999.81 → top
        } else if (hasAdp) {
          // No FC value, but has ADP → insert after value-ranked players
          sortKey = 50000 + r.adp;             // e.g. WR ADP=50 → 50050, below FC players
        } else {
          // No data at all — board rank tiebreaker
          sortKey = 200000 + boardIdx;
        }
        return { ...r, _sortKey: sortKey };
      })
      .sort((a: any, b: any) => a._sortKey - b._sortKey);

    // User's personal board order for their own slots
    const boardSorted = [...rookies];

    // slot → current owner_id (after trades), from allPicks
    const slotOwnerMap = new Map<string, number>();
    (allPicks as any[]).forEach((p: any) => {
      if (p.slot && p.owner_id) slotOwnerMap.set(String(p.slot), Number(p.owner_id));
    });

    // Detect actual picks by pick_no — reliable regardless of slot/roster resolution
    const filledPickNos = new Set<number>(
      draftPicks.map((dp: any) => Number(dp.pick_no)).filter(Boolean)
    );
    const pickByNo = new Map<number, any>();
    draftPicks.forEach((dp: any) => { if (dp.pick_no) pickByNo.set(Number(dp.pick_no), dp); });

    // My slots across all rounds
    const mySlots = new Set<string>(
      (allPicks as any[])
        .filter((p: any) => String(p.owner_id) === String(myRosterId) && p.slot)
        .map((p: any) => String(p.slot))
    );

    // League starter targets for positional need calculation
    const rp: string[] = selectedLeague.roster_positions || [];
    const starterSlots: Record<string, number> = {};
    rp.forEach((p: string) => { if (!["BN","IR","TAXI"].includes(p)) starterSlots[p] = (starterSlots[p] || 0) + 1; });
    const flex = starterSlots["FLEX"] || 0;
    const sflex = starterSlots["SUPER_FLEX"] || 0;
    const posTarget: Record<string, number> = {
      QB: (starterSlots["QB"] || 0) + sflex * 0.5,
      RB: (starterSlots["RB"] || 0) + flex * 0.40,
      WR: (starterSlots["WR"] || 0) + flex * 0.35,
      TE: (starterSlots["TE"] || 0),
    };

    // Position need multiplier — round-aware so early picks stay true to value tiers
    // while later rounds allow realistic need-based swings:
    //   Round 1: cap 1.08  → barely 1-2 spot drift  (Love stays 1.01)
    //   Round 2: cap 1.20  → moderate 2-3 spot swings
    //   Round 3: cap 1.38  → 3-5 spot swings reasonable
    //   Round 4: cap 1.55  → large swings fine (deep picks, less certain)
    // Surplus penalty also scales — aggressive in round 4 to stop double-stacking one pos.
    const needMult = (rosterId: number | null, pos: string, simCounts: Record<number, Record<string, number>>, round: number): number => {
      if (!rosterId) return 1;
      const needCap     = round === 1 ? 1.08 : round === 2 ? 1.22 : round === 3 ? 1.38 : 1.55;
      const surplusMult = round === 1 ? 0.95 : round === 2 ? 0.88 : round === 3 ? 0.82 : 0.75;
      const roster = rosters.find((r: any) => Number(r.roster_id) === rosterId);
      const existing = ((roster?.players || []) as string[])
        .map((id: string) => (players as any)[id]).filter(Boolean)
        .filter((p: any) => p.position === pos).length;
      const target = posTarget[pos] ?? 1;
      const simmed = (simCounts[rosterId] || {})[pos] || 0;
      const deficit = target - existing - simmed;
      if (deficit <= -2) return surplusMult; // surplus: discourage stacking same position
      if (deficit <= 0) return 1.00;
      return Math.min(needCap, 1 + deficit * 0.14);
    };

    // Used tracking: by player_id AND normalized name (covers ID-less rookies)
    const usedIds = new Set<string>([
      ...Array.from(draftedPlayerIds),
      ...Object.values(myDraftSlotPicks),
    ]);
    const usedNames = new Set<string>();
    draftPicks.forEach((dp: any) => {
      const p = (players as any)[dp.player_id];
      if (p?.full_name) usedNames.add(normName(p.full_name));
    });
    Object.values(myDraftSlotPicks).forEach((pid) => {
      const r = rookies.find((rk: any) => rk.player_id === pid || rk.name === pid);
      if (r?.name) usedNames.add(normName(r.name));
    });

    const isUsed = (r: any) => {
      if (r.player_id && usedIds.has(String(r.player_id))) return true;
      if (r.name && usedNames.has(normName(r.name))) return true;
      return false;
    };
    const markUsed = (r: any) => {
      if (r.player_id) usedIds.add(String(r.player_id));
      if (r.name) usedNames.add(normName(r.name));
    };

    const simCounts: Record<number, Record<string, number>> = {};
    rosters.forEach((r: any) => { simCounts[Number(r.roster_id)] = {}; });

    const predictions: Record<string, { name: string; position: string; team: string; adp: number; player_id: string | null; boardRank: number; poolRank: number }> = {};

    for (let round = 1; round <= numRounds; round++) {
      // Iterate in pick ORDER (snake reverses even rounds)
      const slotOrder = isSnake && round % 2 === 0
        ? Array.from({ length: numTeams }, (_, i) => numTeams - i)
        : Array.from({ length: numTeams }, (_, i) => i + 1);

      for (let pickIdx = 0; pickIdx < numTeams; pickIdx++) {
        const slotNum = slotOrder[pickIdx];
        const slotStr = `${round}.${String(slotNum).padStart(2, "0")}`;
        const overallPick = (round - 1) * numTeams + pickIdx + 1;
        const rosterId = slotOwnerMap.get(slotStr) ?? null;

        // Actual pick detected by pick_no — doesn't require rosterId resolution
        if (filledPickNos.has(overallPick)) {
          const dp = pickByNo.get(overallPick);
          if (dp?.player_id) {
            usedIds.add(String(dp.player_id));
            const ap = (players as any)[dp.player_id];
            if (ap?.full_name) usedNames.add(normName(ap.full_name));
            if (ap?.position && rosterId) {
              simCounts[rosterId] = simCounts[rosterId] || {};
              simCounts[rosterId][ap.position] = (simCounts[rosterId][ap.position] || 0) + 1;
            }
          }
          continue;
        }

        // User override for their own picks
        if (myDraftSlotPicks[slotStr]) {
          const oid = myDraftSlotPicks[slotStr];
          const ov = rookies.find((r: any) => r.player_id === oid || r.name === oid);
          if (ov) {
            predictions[slotStr] = { name: ov.name, position: ov.position, team: ov.team || "", adp: ov.adp ?? 999, player_id: ov.player_id, boardRank: rookies.indexOf(ov) + 1, poolRank: 0 };
            if (rosterId) { simCounts[rosterId] = simCounts[rosterId] || {}; simCounts[rosterId][ov.position] = (simCounts[rosterId][ov.position] || 0) + 1; }
          }
          continue;
        }

        const isMySlot = mySlots.has(slotStr);
        // User's own unfilled slots: scored by their personal board order
        // Other teams: scored by dynasty-ADP rank + positional need + dynasty value tier
        const rankSource = isMySlot ? boardSorted : fullPool;

        const best = rankSource
          .filter((r: any) => !isUsed(r))
          .map((r: any, rankIdx: number) => {
            const baseScore = 1000 / (rankIdx + 1);
            const nm = needMult(rosterId, r.position, simCounts, round);
            // Dynasty value bonus: FC value differences within same ADP tier
            const dynVal = getRookieValue(r);
            const valBonus = dynVal > 0 ? Math.min(0.20, dynVal / 50000) : 0;
            // Owner tendency: how much this owner historically drafts this position
            // Only applied to non-user slots; user's own slots use personal board order
            const tm = isMySlot ? 1 : tendencyMult(rosterId, r.position);
            return { ...r, score: baseScore * nm * tm * (1 + valBonus) };
          })
          .sort((a: any, b: any) => b.score - a.score)[0];

        if (best) {
          const boardRank = rookies.findIndex((r: any) => (r.player_id && r.player_id === best.player_id) || normName(r.name) === normName(best.name)) + 1;
          // poolRank = player's position in consensus dynasty-value pool (1 = most valuable).
          // Used to flag REACH/VALUE on user's predicted slots:
          //   overallPick << poolRank → reaching ahead of consensus
          //   overallPick >> poolRank → getting value relative to consensus
          const poolRank = fullPool.findIndex((r: any) => (r.player_id && r.player_id === best.player_id) || normName(r.name) === normName(best.name)) + 1 || 999;
          predictions[slotStr] = { name: best.name, position: best.position, team: best.team || "", adp: best.adp ?? 999, player_id: best.player_id, boardRank, poolRank };
          markUsed(best);
          if (rosterId) { simCounts[rosterId] = simCounts[rosterId] || {}; simCounts[rosterId][best.position] = (simCounts[rosterId][best.position] || 0) + 1; }
        }
      }
    }

    return predictions;
  }, [draftSettings, rosters, rookies, draftPicks, draftedPlayerIds, myDraftSlotPicks, allPicks, selectedLeague, players, calcFcValues, ownerDraftTendencies, user?.user_id]);

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
  const dashboardOwnedPlayers = useMemo(() => {
    const map = new Map<string, any>();
    allLeagueData.forEach((entry: any) => {
      (entry?.roster?.players || []).forEach((playerId: string) => {
        const player = (players as any)?.[playerId];
        if (!player?.full_name) return;
        const existing = map.get(String(playerId)) || {
          player_id: String(playerId),
          leagues: [],
          shareCount: 0,
        };
        existing.player = player;
        existing.shareCount += 1;
        if (entry?.leagueName && !existing.leagues.includes(entry.leagueName)) {
          existing.leagues.push(entry.leagueName);
        }
        map.set(String(playerId), existing);
      });
    });
    return [...map.values()].sort((a, b) => {
      const aValue = Number((players as any)?.[a.player_id]?.value || 0);
      const bValue = Number((players as any)?.[b.player_id]?.value || 0);
      return bValue - aValue;
    });
  }, [allLeagueData, players]);

  const watchlistSearchResults = useMemo(() => {
    const normalizedQuery = watchlistSearch.trim().toLowerCase();
    if (!normalizedQuery || Object.keys(players || {}).length === 0) return [];
    return Object.values(players as Record<string, any>)
      .filter((player: any) =>
        player?.full_name &&
        ["QB", "RB", "WR", "TE"].includes(player.position) &&
        player.full_name.toLowerCase().includes(normalizedQuery)
      )
      .sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
      .slice(0, 8);
  }, [watchlistSearch, players]);

  useEffect(() => {
    localStorage.setItem(watchlistStorageKey, JSON.stringify(watchlistEntries));
  }, [watchlistEntries, watchlistStorageKey]);

  useEffect(() => {
    localStorage.setItem(alertStorageKey, JSON.stringify(dashboardAlerts));
  }, [dashboardAlerts, alertStorageKey]);

  useEffect(() => {
    localStorage.setItem(dismissedAlertStorageKey, JSON.stringify(dismissedAlertIds));
  }, [dismissedAlertIds, dismissedAlertStorageKey]);

  useEffect(() => {
    if (!supabaseUser || !dashboardAlerts.length) return;
    const payload = dashboardAlerts.slice(0, 80).map((alert) => ({
      user_id: supabaseUser.id,
      alert_id: alert.id,
      category: alert.category,
      source: alert.source,
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      actionable: alert.actionable,
      dismissed: dismissedAlertIds.includes(alert.id) || !!alert.dismissed,
      league_id: alert.leagueId || null,
      player_id: alert.playerId || null,
      payload: {
        ...(alert.payload || {}),
        link: alert.link || null,
        teamLabel: alert.teamLabel || null,
      },
      updated_at: new Date(alert.timestamp || Date.now()).toISOString(),
    }));
    supabase.from("alerts").upsert(payload, { onConflict: "user_id,alert_id" }).then(() => {});
  }, [supabaseUser?.id, dashboardAlerts, dismissedAlertIds]);

  useEffect(() => {
    const trackedPlayers = [
      ...dashboardOwnedPlayers.map((entry: any) => ({
        playerId: String(entry.player_id),
        player: (players as any)?.[entry.player_id],
        watch: watchlistEntries.find((watch) => watch.player_id === String(entry.player_id)) || null,
        shareCount: entry.shareCount || 0,
        leagues: entry.leagues || [],
      })),
      ...watchlistEntries
        .filter((entry) => !dashboardOwnedPlayers.some((owned: any) => owned.player_id === entry.player_id))
        .map((entry) => ({
          playerId: entry.player_id,
          player: (players as any)?.[entry.player_id],
          watch: entry,
          shareCount: 0,
          leagues: [],
        })),
    ].filter((entry) => entry.player?.full_name);

    if (!trackedPlayers.length) return;

    let savedSnapshots: any = {};
    try {
      savedSnapshots = JSON.parse(localStorage.getItem(alertSnapshotStorageKey) || "{}");
    } catch {
      savedSnapshots = {};
    }

    const nextPlayerSnapshot = Object.fromEntries(
      trackedPlayers.map((entry) => {
        const player = entry.player;
        const value = Number(calcFcValues[entry.playerId] ?? player?.value ?? 0);
        return [entry.playerId, {
          full_name: player.full_name,
          status: String(player.status || ""),
          team: String(player.team || ""),
          value,
          active: player.active !== false,
          shareCount: entry.shareCount || 0,
        }];
      })
    );

    const incomingAlerts: AlertsCenterItem[] = [];

    // Value-change alerts use the Supabase daily baseline (historicalSnapshotRef), NOT localStorage.
    // This prevents false "Bo Nix gained 2,274" fires caused by FC API inconsistencies across sessions.
    // Guards: baseline must be ≥ 12h old AND previous.value must be > 0 (avoids 0→value false positives).
    const historicalBase = historicalSnapshotRef.current;
    const baselineAge = historicalBase ? Date.now() - new Date(historicalBase.recorded_at).getTime() : 0;
    const baselineReady = !!historicalBase && baselineAge >= 12 * 60 * 60 * 1000;

    Object.entries(nextPlayerSnapshot).forEach(([playerId, snapshot]: any) => {
      if (baselineReady) {
        const historical = historicalBase!.players[playerId];
        if (historical && historical.value > 0) {
          const delta = Number(snapshot.value || 0) - Number(historical.value || 0);
          const watch = watchlistEntries.find((entry) => entry.player_id === playerId);
          const upThreshold = Number(watch?.threshold_up || 300);
          const downThreshold = Number(watch?.threshold_down || 300);
          if (delta >= upThreshold) {
            incomingAlerts.push({
              id: `market-up-${playerId}-${snapshot.value}`,
              category: watch ? "watchlist" : "market",
              source: watch ? "watchlist" : "internal",
              severity: delta >= upThreshold * 1.8 ? "high" : "medium",
              title: `${snapshot.full_name} is climbing`,
              detail: `${snapshot.full_name} gained ${delta.toLocaleString()} in value${snapshot.shareCount ? ` across ${snapshot.shareCount} roster${snapshot.shareCount === 1 ? "" : "s"}` : ""}.`,
              actionable: true,
              timestamp: Date.now(),
              playerId,
              teamLabel: snapshot.team || null,
              payload: { delta, direction: "up" },
            });
          } else if (delta <= -downThreshold) {
            incomingAlerts.push({
              id: `market-down-${playerId}-${snapshot.value}`,
              category: watch ? "watchlist" : "market",
              source: watch ? "watchlist" : "internal",
              severity: delta <= -downThreshold * 1.8 ? "high" : "medium",
              title: `${snapshot.full_name} is falling`,
              detail: `${snapshot.full_name} dropped ${Math.abs(delta).toLocaleString()} in value${snapshot.shareCount ? ` across ${snapshot.shareCount} roster${snapshot.shareCount === 1 ? "" : "s"}` : ""}.`,
              actionable: true,
              timestamp: Date.now(),
              playerId,
              teamLabel: snapshot.team || null,
              payload: { delta, direction: "down" },
            });
          }
        }
      }

      // Status/team alerts use localStorage (most-recent state) — these need immediate detection,
      // not a daily gate. A player going on IR should alert right away.
      const previous = savedSnapshots?.players?.[playerId];
      if (!previous) return;

      if (snapshot.status !== previous.status) {
        const nextStatus = snapshot.status || (snapshot.active ? "active" : "inactive");
        incomingAlerts.push({
          id: `status-${playerId}-${nextStatus}`,
          category: "status",
          source: "internal",
          severity: /out|doubtful|suspended|inactive/i.test(nextStatus) ? "high" : "medium",
          title: `${snapshot.full_name} status changed`,
          detail: `${snapshot.full_name} moved from ${previous.status || "active"} to ${nextStatus}.`,
          actionable: true,
          timestamp: Date.now(),
          playerId,
          teamLabel: snapshot.team || null,
          payload: { previousStatus: previous.status || "", nextStatus },
        });
      }

      if (snapshot.team && previous.team && snapshot.team !== previous.team) {
        incomingAlerts.push({
          id: `team-${playerId}-${snapshot.team}`,
          category: "status",
          source: "internal",
          severity: "medium",
          title: `${snapshot.full_name} changed teams`,
          detail: `${snapshot.full_name} moved from ${previous.team} to ${snapshot.team}.`,
          actionable: true,
          timestamp: Date.now(),
          playerId,
          teamLabel: snapshot.team,
          payload: { previousTeam: previous.team, nextTeam: snapshot.team },
        });
      }
    });

    const nextSnapshots = {
      players: nextPlayerSnapshot,
    };

    localStorage.setItem(alertSnapshotStorageKey, JSON.stringify(nextSnapshots));

    if (!alertBootstrapRef.current) {
      alertBootstrapRef.current = true;
      // Save daily snapshot to Supabase if it's missing or > 24h old.
      // This becomes the stable baseline for all future value-change alerts.
      const snapshotAge = historicalSnapshotRef.current
        ? Date.now() - new Date(historicalSnapshotRef.current.recorded_at).getTime()
        : Infinity;
      if (supabaseUser && snapshotAge > 24 * 60 * 60 * 1000) {
        const recordedAt = new Date().toISOString();
        supabase
          .from("player_value_snapshots")
          .upsert(
            { user_id: supabaseUser.id, snapshot: nextPlayerSnapshot, recorded_at: recordedAt },
            { onConflict: "user_id" }
          )
          .then(() => {
            historicalSnapshotRef.current = { players: nextPlayerSnapshot, recorded_at: recordedAt };
          });
      }
      return;
    }

    mergeDashboardAlerts(incomingAlerts);
  }, [
    dashboardOwnedPlayers,
    watchlistEntries,
    players,
    calcFcValues,
    selectedLeague?.league_id,
    selectedLeagueMateProfilesView,
    alertSnapshotStorageKey,
  ]);

  useEffect(() => {
    const trackedNames = [
      ...dashboardOwnedPlayers.slice(0, 8).map((entry: any) => (players as any)?.[entry.player_id]?.full_name),
      ...watchlistEntries.slice(0, 8).map((entry) => entry.label),
    ].filter(Boolean);
    const uniqueNames = Array.from(new Set(trackedNames)).slice(0, 10);
    if (uniqueNames.length === 0) return;

    let cancelled = false;
    setLoadingExternalAlerts(true);
    fetch(`/api/alerts/news?players=${encodeURIComponent(uniqueNames.join("|"))}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data?.items)) return;
        const items = data.items.slice(0, 8).map((item: any) => ({
          id: `news-${String(item.id || item.link || item.title).replace(/[^a-zA-Z0-9_-]/g, "")}`,
          category: "news" as const,
          source: "external" as const,
          severity: (item.impact || item.playerNames?.length > 0) ? "medium" as const : "low" as const,
          title: item.title || "Player news",
          detail: item.summary || item.matchedPlayers?.join(", ") || "External update matched one of your tracked names.",
          actionable: !!item.playerNames?.length,
          timestamp: Number(new Date(item.published || Date.now())),
          link: item.link || null,
          payload: item,
        }));
        mergeDashboardAlerts(items);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingExternalAlerts(false);
      });

    return () => { cancelled = true; };
  }, [dashboardOwnedPlayers, watchlistEntries, players]);

  const visibleDashboardAlerts = useMemo(
    () =>
      dashboardAlerts
        .filter((alert) => !dismissedAlertIds.includes(alert.id) && !alert.dismissed)
        .sort((a, b) => b.timestamp - a.timestamp),
    [dashboardAlerts, dismissedAlertIds]
  );

  const actionableDashboardAlerts = useMemo(
    () => visibleDashboardAlerts.filter((alert) => alert.actionable).slice(0, 6),
    [visibleDashboardAlerts]
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
    <>
      {/* Login overlay — lives outside <main> so no stacking context interferes */}
      {!supabaseUser && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-sm shadow-2xl" style={{ position: "relative", zIndex: 10000 }}>
            <h2 className="text-xl font-bold mb-1 text-center">DynastyZeus</h2>
            <p className="text-sm text-gray-400 text-center mb-6">Sign in to your account</p>
            {supabaseError && <div className="text-red-400 text-sm mb-3">{supabaseError}</div>}
            <div className="space-y-3">
              <input
                className="w-full p-2.5 rounded-lg bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:border-blue-500"
                placeholder="Email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
              />
              <input
                className="w-full p-2.5 rounded-lg bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:border-blue-500"
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); signIn(); } }}
              />
              <button
                type="button"
                disabled={loginLoading}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg text-sm font-semibold transition"
                onClick={(e) => { e.stopPropagation(); signIn(); }}
              >
                {loginLoading ? "Signing in…" : "Sign In"}
              </button>
              <button
                type="button"
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold transition"
                onClick={(e) => { e.stopPropagation(); signUp(); }}
              >
                Create Account
              </button>
            </div>
          </div>
        </div>
      )}
    <main className="min-h-screen bg-gray-950 text-white">
      {/* App content — always rendered but non-interactive when not signed in */}
      <div className={!supabaseUser ? "pointer-events-none select-none opacity-40" : ""}>
      <>
      {/* HEADER */}
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700">
        {/* Top bar */}
        <div className="flex overflow-x-auto scrollbar-none md:justify-center">
          <div className="flex items-center px-3 py-2 gap-4 shrink-0">
          <h1 className="text-base font-bold shrink-0">DynastyZeus</h1>
          <div className="flex items-center gap-2 min-w-0">
            {user && (
              <span className="text-xs text-gray-400 truncate hidden sm:inline max-w-[100px]">
                {user.display_name}
              </span>
            )}
            {user && (
              <button onClick={disconnectSleeper} className="px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600 shrink-0">
                Disconnect
              </button>
            )}
            {leagues.length > 0 && (
              <select
                value={selectedLeague?.league_id || ""}
                onChange={(e) => {
                  const league = leagues.find((l: any) => l.league_id === e.target.value);
                  if (league) {
                    loadRoster(league);
                    if (mainTab === "DASHBOARD") setMainTab("LEAGUES");
                    localStorage.setItem("selectedLeague", JSON.stringify(league));
                  }
                }}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs max-w-[120px] truncate"
              >
                <option value="">Select League</option>
                {leagues.map((l: any) => (
                  <option key={l.league_id} value={l.league_id}>{l.name}</option>
                ))}
              </select>
            )}
            {supabaseUser && (
              <button onClick={signOut} className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 rounded transition shrink-0">
                Log Out
              </button>
            )}
          </div>
          </div>
        </div>
        {/* NAV */}
        <div className="border-t border-gray-800">
          <div className="mx-auto max-w-7xl overflow-x-auto scrollbar-none">
            <div className="flex min-w-max justify-start px-2 md:justify-center">
              {[
                { id: "DASHBOARD", label: "Dashboard" },
                { id: "LEAGUES", label: "League Hub" },
                { id: "DATA_HUB", label: "Data Hub" },
                { id: "DRAFT", label: "Draft Hub" },
                { id: "TRADE_HUB", label: "Trade Hub" },
                { id: "GAMEDAY_HUB", label: "Gameday Hub" },
                { id: "ALERTS", label: "Alerts" },
                { id: "MANAGEMENT_HUB", label: "Management Hub" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setMainTab(tab.id)}
                  disabled={!user && tab.id !== "DASHBOARD"}
                  className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition md:px-5 ${
                    mainTab === tab.id
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-gray-400 hover:text-white"
                  } ${!user && tab.id !== "DASHBOARD" ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={mainTab === "DRAFT" || mainTab === "TRADE_HUB" || mainTab === "MANAGEMENT_HUB" || mainTab === "LEAGUES" || mainTab === "ALERTS" || mainTab === "GAMEDAY_HUB" ? "" : "max-w-3xl mx-auto p-6"}>
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
        {mainTab === "ALERTS" && (
          <AlertsPage
            alerts={visibleDashboardAlerts}
            actionableAlerts={actionableDashboardAlerts}
            watchlistEntries={watchlistEntries}
            watchlistSearch={watchlistSearch}
            onWatchlistSearchChange={setWatchlistSearch}
            watchlistSearchResults={watchlistSearchResults}
            onAddWatchlist={addWatchlistEntry}
            onRemoveWatchlist={removeWatchlistEntry}
            onDismissAlert={dismissDashboardAlert}
            watchThresholdUp={watchThresholdUp}
            watchThresholdDown={watchThresholdDown}
            onWatchThresholdUpChange={setWatchThresholdUp}
            onWatchThresholdDownChange={setWatchThresholdDown}
            loadingExternalAlerts={loadingExternalAlerts}
          />
        )}
        {/* LEAGUE HUB */}
        {mainTab === "LEAGUES" && (
          <div className="max-w-5xl mx-auto px-4 py-6">
          <>
            {/* Sub-tab nav */}
            <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="flex flex-wrap justify-center gap-2">
                {LEAGUE_HUB_GROUPS.map((group) => {
                  const isActive = activeLeagueHubGroup.id === group.id;
                  return (
                    <button
                      key={group.id}
                      onClick={() => setLeagueHubTab(group.tabs[0].id)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:text-white"
                      }`}
                    >
                      {group.label}
                    </button>
                  );
                })}
              </div>
              <div className="mx-auto mt-4 max-w-md">
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Current View
                </label>
                <select
                  value={leagueHubTab}
                  onChange={(e) => setLeagueHubTab(e.target.value as LeagueHubTab)}
                  className="w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {activeLeagueHubGroup.tabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.label}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-center text-[11px] text-gray-500">
                  {activeLeagueHubGroup.tabs.map((tab) => tab.label).join(" • ")}
                </div>
              </div>
            </div>

            {/* ── League Overview ── */}
            {leagueHubTab === "OVERVIEW" && (() => {
              if (loadingLeagueOverview) return <p className="text-sm text-blue-400">Loading league data…</p>;
              if (!leagues.length) return <p className="text-sm text-gray-500">No leagues found.</p>;

              // User-defined ordering: Purgatory = undecided crossroads (above Almost There/Rebuilder).
              // Fading Contender = still has current success. Almost There = committed rebuild trajectory.
              const bucketOrder: Record<string, number> = {
                Elite: 0,
                "True Contender": 1,
                "Fading Contender": 2,
                Purgatory: 3,
                "Almost There": 4,
                Rebuilder: 5,
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
                if (!myRosterId) return null;
                const profile = getRosterDirectionProfile({
                  rosterId: myRosterId,
                  rosters: lr,
                  ownedPicks,
                  players,
                  pickValues: pickFcValues,
                  redraftValues,
                  dynastyValueForPlayer: (id: string) => calcFcValues[id] ?? (players as any)[id]?.value ?? 0,
                });
                if (!profile) return null;
                // Pull playoff odds from the Supabase sim cache if available
                const cachedSim = leagueSimCache[league.league_id]?.[Number(myRosterId)];
                const playoffOdds = cachedSim?.playoff_odds ?? 0;
                const hasCachedSim = !!cachedSim;
                const simAge = cachedSim?.computed_at
                  ? Math.round((Date.now() - new Date(cachedSim.computed_at).getTime()) / (1000 * 60 * 60))
                  : null;
                const adjBucket = getAdjustedDirectionBucket(profile.bucket, profile, playoffOdds, hasCachedSim);
                const adjColor = getBucketColor(adjBucket);
                return {
                  league,
                  ...profile,
                  bucket: adjBucket,
                  bucketColor: adjColor,
                  rawBucket: profile.bucket,
                  playoffOdds,
                  hasCachedSim,
                  simAge,
                };
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
                  <div className="overflow-x-auto pb-1">
                    <div className="min-w-[780px] space-y-2">
                      {/* Run All Sims button + progress bar */}
                      <div className="flex items-center gap-3 pb-1">
                        <button
                          onClick={handleRunAllSims}
                          disabled={simQueue.length > 0}
                          className="text-[11px] font-semibold px-3 py-1 rounded-full border border-blue-600 text-blue-400 hover:bg-blue-900/40 transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          {simQueue.length > 0 ? "Simulating…" : "Run All Sims"}
                        </button>
                        {simProgress && (
                          <div className="flex-1 flex items-center gap-2 min-w-0">
                            <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                style={{ width: `${(simProgress.done / simProgress.total) * 100}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-400 whitespace-nowrap">
                              {simProgress.done === simProgress.total
                                ? `Done — ${simProgress.total} leagues updated`
                                : `${simProgress.done} / ${simProgress.total}`}
                            </span>
                          </div>
                        )}
                      </div>
                      {/* Header */}
                      <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(150px,1fr)_72px_72px_72px_72px_72px] gap-2 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                        <span>League</span>
                        <span>Direction</span>
                        <span className="text-center">Dyn</span>
                        <span className="text-center">Rdft</span>
                        <span className="text-center">Stnd</span>
                        <span className="text-center">MaxPF</span>
                        <span className="text-center">Playoff%</span>
                      </div>
                      {leagueRows.map((row: any) => (
                        <div key={row.league.league_id} className={`grid grid-cols-[minmax(220px,1.4fr)_minmax(190px,1.15fr)_72px_72px_72px_72px_72px] gap-2 items-center bg-gray-900 border rounded-xl px-3 py-2.5 transition-colors ${simQueue[0] === row.league.league_id ? "border-blue-700" : "border-gray-800"}`}>
                          <button className="min-w-0 text-sm text-white font-medium text-left truncate hover:text-blue-400 transition" onClick={() => { loadRoster(row.league); setLeagueHubTab("ROSTERS"); }}>
                            {row.league.name}
                          </button>
                          <div className="min-w-0">
                            <span className={`inline-flex max-w-full text-[10px] font-semibold px-2 py-0.5 rounded-full border text-center truncate ${row.bucketColor}`}>{row.bucket}</span>
                            <div className="mt-1 text-[10px] text-gray-500 truncate">{row.shortAction}</div>
                          </div>
                          <span className="text-xs text-center text-gray-300">{row.dynRank}<span className="text-gray-600">/{row.n}</span></span>
                          <span className="text-xs text-center text-gray-300">{row.redRank}<span className="text-gray-600">/{row.n}</span></span>
                          <span className="text-xs text-center text-gray-300">{row.standRank}<span className="text-gray-600">/{row.n}</span></span>
                          <span className="text-xs text-center text-gray-300">{row.maxPfRank}<span className="text-gray-600">/{row.n}</span></span>
                          <div className="text-center">
                            {row.hasCachedSim ? (
                              <div>
                                <span className={`text-xs font-mono font-semibold ${row.playoffOdds >= 50 ? "text-green-400" : row.playoffOdds >= 25 ? "text-yellow-400" : "text-red-400"}`}>
                                  {row.playoffOdds}%
                                </span>
                                {row.simAge !== null && (
                                  <div className={`text-[10px] ${row.simAge > 48 ? "text-orange-500" : "text-gray-600"}`}>
                                    {row.simAge < 1 ? "just now" : row.simAge < 24 ? `${row.simAge}h ago` : `${Math.round(row.simAge / 24)}d ago`}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-gray-600">visit league</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {!leagueOverviewLoaded && !loadingLeagueOverview && (
                    <button onClick={() => { loadLeagueOverview(); loadRedraftValues(); }} className="text-xs text-blue-400 hover:text-blue-300 border border-blue-700 rounded-lg px-3 py-1.5 transition">
                      Load Overview
                    </button>
                  )}
                </div>
              );
            })()}

            {/* ── Simulator ── */}
            {leagueHubTab === "SIMULATOR" && (() => {
              if (!selectedLeague || !rosters.length) {
                return <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view the simulator.</p>;
              }
              if (!selectedLeagueSimulation) {
                return <p className="text-sm text-blue-400">Building simulator snapshot...</p>;
              }

              const myRosterId = rosters.find((entry: any) => entry.owner_id === user?.user_id)?.roster_id;
              return (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Season Simulator</div>
                        <div className="mt-1 text-sm text-gray-200">
                          {selectedLeagueSimulation.simulationMode === "offseason"
                            ? "Offseason mode uses season-long player projections to build optimal lineups, simulate standings, and estimate projected max PF before real schedules exist."
                            : "In-season mode blends real results, current schedule, and Monte Carlo rest-of-season sims for projected standings and playoff odds."}
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {selectedLeagueSimulation.simulationMode === "offseason"
                          ? `${selectedLeagueSimulation.simCount} sims - ${selectedLeagueSimulation.regularSeasonWeeks}-week baseline`
                          : loadingLeagueWeeklyMatchups
                          ? "Loading weekly matchup history..."
                          : `Week ${selectedLeagueSimulation.currentWeek} - ${selectedLeagueSimulation.weeksPlayed} completed weeks - ${selectedLeagueSimulation.simCount} sims`}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto pb-1">
                    <div className="min-w-[1250px] space-y-2">
                      <div className="grid grid-cols-[minmax(180px,1.45fr)_78px_108px_88px_92px_92px_88px_82px_96px_92px_110px] gap-2 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                        <span>Team</span>
                        <span className="text-center">Power</span>
                        <span className="text-center">Proj Max PF</span>
                        <span className="text-center">Exp Wins</span>
                        <span className="text-center">Avg Finish</span>
                        <span className="text-center">Finish Band</span>
                        <span className="text-center">Playoffs</span>
                        <span className="text-center">Bye</span>
                        <span className="text-center">Title</span>
                        <span className="text-center">1.01</span>
                        <span className="text-center">{selectedLeagueSimulation.simulationMode === "offseason" ? "Avg Matchup" : "This Week"}</span>
                      </div>
                      {selectedLeagueSimulation.rows.map((row: any) => {
                        const isMe = Number(row.rosterId) === Number(myRosterId);
                        return (
                          <div key={row.rosterId} className={`grid grid-cols-[minmax(180px,1.45fr)_78px_108px_88px_92px_92px_88px_82px_96px_92px_110px] gap-2 items-center rounded-xl border px-3 py-3 ${isMe ? "border-blue-700 bg-blue-950/20" : "border-gray-800 bg-gray-900"}`}>
                            <div className="min-w-0">
                              <div className={`truncate text-sm font-semibold ${isMe ? "text-blue-300" : "text-white"}`}>{row.ownerName}</div>
                              <div className="text-[11px] text-gray-500">
                                {row.actualWins}-{row.actualLosses} actual • likely finish {ordinal(row.projectedFinish)}
                              </div>
                              {selectedLeagueSimulation.simulationMode !== "offseason" && (
                                <div className="text-[10px] text-gray-600">
                                  All-play {row.allPlayWins}-{row.allPlayLosses} • luck {row.luckScore > 0 ? "+" : ""}{row.luckScore.toFixed(1)}
                                </div>
                              )}
                            </div>
                            <div className="text-center text-sm font-semibold text-white">{row.powerScore.toFixed(1)}</div>
                            <div className="text-center text-sm text-gray-200">{Math.round(row.projectedMaxPf || row.maxPf || 0).toLocaleString()}</div>
                            <div className="text-center text-sm text-gray-200">{row.expectedWins.toFixed(1)}</div>
                            <div className="text-center text-sm text-gray-200">{row.avgFinish?.toFixed?.(1) ?? row.avgFinish}</div>
                            <div className="text-center text-xs text-gray-300">{row.finishRange}</div>
                            <div className="text-center text-sm text-green-300">{Math.round(row.playoffOdds)}%</div>
                            <div className="text-center text-sm text-cyan-300">{Math.round(row.byeOdds)}%</div>
                            <div className="text-center text-sm text-amber-300">{Math.round(row.titleOdds)}%</div>
                            <div className="text-center text-sm text-rose-300">{Math.round(row.oneOhOneOdds || 0)}%</div>
                            <div className="text-center text-xs text-gray-300">
                              {row.currentOpponent ? `${Math.round(row.currentWeekWinProb * 100)}% vs ${row.currentOpponent}` : `${Math.round(row.avgWinProb * 100)}% avg`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {selectedLeagueSimulation.weeklyMatchups?.length > 0 && (
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Schedule Preview</div>
                          <div className="mt-1 text-sm text-gray-200">
                            {selectedLeagueSimulation.simulationMode === "offseason"
                              ? "Generated weekly matchups used for offseason sims."
                              : "Upcoming matchup forecast from the active league schedule."}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {selectedLeagueSimulation.weeklyMatchups.slice(0, 4).map((week: any) => (
                          <div key={week.week} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-semibold text-white">Week {week.week}</div>
                              <div className="text-[10px] uppercase tracking-wide text-gray-500">{week.source}</div>
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {week.matchups?.slice(0, 6).map((matchup: any, idx: number) => (
                                <div key={`${week.week}-${idx}`} className="flex items-center justify-between rounded-lg bg-gray-800/80 px-3 py-2 text-xs">
                                  <div className="min-w-0 text-gray-200">
                                    <span className="font-medium text-white">{matchup.aName}</span>
                                    <span className="text-gray-500"> vs </span>
                                    <span className="font-medium text-white">{matchup.bName}</span>
                                  </div>
                                  <div className="shrink-0 text-right text-gray-400">
                                    {Math.round((matchup.winProb || 0) * 100)}% • {Math.round(matchup.projectedPoints || 0)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
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
                {selectedLeagueDirection && (() => {
                  // Use the fully adjusted profile for display — all three factors combined
                  const dir = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
                  return (
                  <div className="mb-4 bg-gray-900 border border-gray-700 rounded-xl p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Roster Direction</div>
                        <div className="mt-1 text-sm text-gray-200">{dir.summary}</div>
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        <span className={`inline-flex text-[10px] font-semibold px-2 py-1 rounded-full border ${dir.bucketColor}`}>
                          {dir.bucket}
                        </span>
                        {(dir as any).rawBucket && (dir as any).rawBucket !== dir.bucket && (
                          <span className="text-[10px] text-gray-500">({(dir as any).rawBucket} by assets)</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Dynasty</div>
                        <div className="text-sm font-semibold text-white">{ordinal(dir.dynRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Redraft</div>
                        <div className="text-sm font-semibold text-white">{ordinal(dir.redRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Standings</div>
                        <div className="text-sm font-semibold text-white">{ordinal(dir.standRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Max PF</div>
                        <div className="text-sm font-semibold text-white">{ordinal(dir.maxPfRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Core Age</div>
                        <div className="text-sm font-semibold text-white">{dir.coreAge || "-"}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">1sts</div>
                        <div className="text-sm font-semibold text-white">{dir.firstRounders}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {dir.actions.map((action: string) => (
                        <span key={action} className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-1 text-[11px] text-blue-200">
                          {action}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-green-400">What You Have</div>
                        <div className="mt-1 space-y-1">
                          {dir.strengths.length > 0 ? dir.strengths.map((item: string) => (
                            <div key={item} className="text-xs text-gray-300">{item}</div>
                          )) : (
                            <div className="text-xs text-gray-500">No clear structural advantage yet.</div>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-orange-400">What To Watch</div>
                        <div className="mt-1 space-y-1">
                          {dir.concerns.length > 0 ? dir.concerns.map((item: string) => (
                            <div key={item} className="text-xs text-gray-300">{item}</div>
                          )) : (
                            <div className="text-xs text-gray-500">No major red flags from the current profile.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })()}
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
  {YEARS.map((year) => {
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

    {YEARS.map((year) => {
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

            {/* ── League Mates ── */}
            {leagueHubTab === "LEAGUE_MATES" && (() => {
              if (!selectedLeague || !rosters.length) {
                return <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view league-mate intelligence.</p>;
              }

              const bestPartnerRosterId = selectedLeagueMateProfilesView[0]?.rosterId;

              return (
                <div className="space-y-4">
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">League-Mate Intelligence</div>
                        <div className="mt-1 text-sm text-gray-200">
                          Static roster profiles, recent trade behavior, and trade-partner fit for <strong className="text-gray-100">{selectedLeague.name}</strong>.
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {loadingLeagueMateIntel || loadingCrossLeagueMateIntel ? "Refreshing trade behavior and all-league tendencies..." : supabaseUser ? "Supabase cache enabled" : "Browser-only until you log in"}
                      </div>
                    </div>
                  </div>

                  {selectedLeagueMateProfilesView.length === 0 ? (
                    <p className="text-sm text-gray-500">No league-mate profiles available yet.</p>
                  ) : (
                    selectedLeagueMateProfilesView.map((mate: any) => {
                      const mateSimRow = selectedLeagueSimulation?.rowByRosterId?.get(Number(mate.rosterId));
                      const matePlayoffOdds = mateSimRow?.playoffOdds ?? 0;
                      const mateAdjBucket = getAdjustedDirectionBucket(
                        mate.directionProfile?.bucket,
                        mate.directionProfile,
                        matePlayoffOdds,
                        !!mateSimRow
                      );
                      const mateAdjColor = getBucketColor(mateAdjBucket);
                      return (
                      <div key={mate.rosterId} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-base font-semibold text-white">{mate.ownerName}</div>
                              {Number(mate.rosterId) === Number(bestPartnerRosterId) && (
                                <span className="rounded-full border border-green-700 bg-green-950/50 px-2 py-0.5 text-[10px] font-semibold text-green-300">
                                  Best Trade Partner
                                </span>
                              )}
                              <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${mateAdjColor}`}>
                                {mateAdjBucket}
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                mate.fitScore >= 24 ? "border-blue-700 bg-blue-950/40 text-blue-300" :
                                mate.fitScore >= 10 ? "border-cyan-700 bg-cyan-950/40 text-cyan-300" :
                                "border-gray-700 bg-gray-950/60 text-gray-400"
                              }`}>
                                {mate.fitLabel}
                              </span>
                            </div>
                            <div className="mt-2 text-sm text-gray-300">{mate.motivation}</div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => loadUserExposure(mate.ownerId)}
                              className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white transition hover:border-blue-500"
                            >
                              Most Owned Players
                            </button>
                            <button
                              onClick={() => loadUserTrades(mate.ownerId)}
                              className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white transition hover:border-blue-500"
                            >
                              Recent Trades
                            </button>
                            <button
                              onClick={() => { setCalcOpponentRosterId(Number(mate.rosterId)); setMainTab("TRADE_HUB"); setTradeHubSection("FINDER"); }}
                              className="rounded-xl border border-blue-700 bg-blue-950/40 px-3 py-2 text-sm text-blue-200 transition hover:border-blue-500"
                            >
                              Open In Trade Finder
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-gray-500">Build</div>
                            <div className="mt-1 text-sm font-semibold text-white">{mate.buildBiasLabel}</div>
                            <div className="mt-1 text-xs text-gray-500">Top groups: {mate.strongestPos} / {mate.secondPos}</div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-gray-500">Draft Capital</div>
                            <div className="mt-1 text-sm font-semibold text-white">{mate.directionProfile.firstRounders} firsts</div>
                            <div className="mt-1 text-xs text-gray-500">{mate.directionProfile.futureFirsts} future firsts • {Math.round(mate.directionProfile.pickTotal || 0).toLocaleString()} pick value</div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-gray-500">Roster Age</div>
                            <div className="mt-1 text-sm font-semibold text-white">{mate.directionProfile.coreAge || "-"}</div>
                            <div className="mt-1 text-xs text-gray-500">{mate.directionProfile.summary}</div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-gray-500">Recent Behavior</div>
                            <div className="mt-1 text-sm font-semibold text-white">{mate.tradeCount30d} trades in 30d</div>
                            <div className="mt-1 text-xs text-gray-500">{mate.recentBuyLabel} • picks {mate.picksIn30d}-{mate.picksOut30d}</div>
                          </div>
                        </div>

                        <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <div className="text-[10px] uppercase tracking-wide text-violet-400">Across All Leagues</div>
                            <div className="text-[11px] text-gray-500">
                              {mate.totalDynastyLeagues > 0 ? `${mate.totalDynastyLeagues} dynasty leagues tracked` : "Loading broader tendencies"}
                            </div>
                          </div>
                          <div className="mt-2 text-sm text-gray-300">{mate.crossLeagueSummary}</div>
                          <div className="mt-2 text-sm text-gray-400">{mate.crossLeagueTradeSummary}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-full border border-violet-800 bg-violet-950/30 px-3 py-1 text-[11px] text-violet-200">
                              {mate.preferenceLabel}
                            </span>
                            <span className="rounded-full border border-amber-800 bg-amber-950/30 px-3 py-1 text-[11px] text-amber-200">
                              {mate.tradePreferenceLabel}
                            </span>
                            {mate.preferredPositions?.map((pos: string) => (
                              <span key={pos} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-[11px] text-gray-300">
                                Prefers {pos}
                              </span>
                            ))}
                            {mate.tradePreferredPositions?.map((pos: string) => (
                              <span key={`trade-${pos}`} className="rounded-full border border-amber-800 bg-amber-950/20 px-3 py-1 text-[11px] text-amber-200">
                                Trades For {pos}
                              </span>
                            ))}
                            {mate.repeatedPlayers?.slice(0, 3).map((player: any) => (
                              <span key={player.playerId} className="rounded-full border border-cyan-800 bg-cyan-950/30 px-3 py-1 text-[11px] text-cyan-200">
                                Likes {player.name}
                              </span>
                            ))}
                            {mate.acquiredPlayers?.slice(0, 2).map((player: any) => (
                              <span key={`acquired-${player.playerId}`} className="rounded-full border border-emerald-800 bg-emerald-950/30 px-3 py-1 text-[11px] text-emerald-200">
                                Recently Bought {player.name}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-green-400">Why They Fit</div>
                            <div className="mt-2 space-y-1">
                              {mate.fitReasons?.length > 0 ? mate.fitReasons.map((reason: string) => (
                                <div key={reason} className="text-xs text-gray-300">{reason}</div>
                              )) : (
                                <div className="text-xs text-gray-500">No major structural trade edge right now.</div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-orange-400">Likely Motivations</div>
                            <div className="mt-2 space-y-1">
                              {mate.directionProfile.actions?.slice(0, 3).map((action: string) => (
                                <div key={action} className="text-xs text-gray-300">{action}</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      );
                    })
                  )}
                </div>
              );
            })()}

            {/* ── Opponent Rosters ── */}
            {leagueHubTab === "OPP_ROSTERS" && (() => {
              if (!selectedLeague || !rosters.length) return (
                <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view opponent rosters.</p>
              );

              const oppRolePriority: any = { starter: 0, bench: 1, taxi: 2 };

              // Build opponent roster from selected owner
              const oppRoster = rosters.find((r: any) => r.owner_id === oppRosterOwnerId);
              const oppPlayerIds: string[] = oppRoster?.players || [];
              const oppTaxiIds = new Set<string>(oppRoster?.taxi || []);
              const oppStarterIds = new Set<string>(oppRoster?.starters || []);

              const getOppRole = (id: string) => {
                if (oppStarterIds.has(id)) return "starter";
                if (oppTaxiIds.has(id)) return "taxi";
                return "bench";
              };

              const oppGrouped: Record<string, any[]> = { QB: [], RB: [], WR: [], TE: [] };
              oppPlayerIds.forEach((id) => {
                const p = players[id];
                if (!p || !oppGrouped[p.position]) return;
                oppGrouped[p.position].push({ ...p, role: getOppRole(id) });
              });
              Object.keys(oppGrouped).forEach((pos) => {
                oppGrouped[pos].sort((a: any, b: any) => {
                  const rd = oppRolePriority[a.role] - oppRolePriority[b.role];
                  return rd !== 0 ? rd : (b.value || 0) - (a.value || 0);
                });
              });

              const oppFilteredPlayers = (["QB","RB","WR","TE"].includes(oppRosterTab) ? oppGrouped[oppRosterTab] : [])
                ?.filter((p: any) => p.full_name?.toLowerCase().includes(oppRosterSearch.toLowerCase()));

              const oppPicksForOwner = allPicks.filter((p: any) => p.owner_id === oppRoster?.roster_id);

              const roleColors: Record<string, string> = {
                starter: "bg-green-800/60",
                bench: "bg-blue-800/40",
                taxi: "bg-purple-800/60",
              };

              return (
                <div>
                  {/* League name + owner dropdown */}
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <span className="text-sm text-gray-400">{selectedLeague.name}</span>
                    <select
                      value={oppRosterOwnerId}
                      onChange={(e) => { setOppRosterOwnerId(e.target.value); setOppRosterTab("QB"); setOppRosterSearch(""); }}
                      className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                    >
                      <option value="">— select an owner —</option>
                      {rosters
                        .filter((r: any) => r.owner_id && r.owner_id !== user?.user_id)
                        .map((r: any) => (
                          <option key={r.roster_id} value={r.owner_id}>
                            {users[r.owner_id] || r.owner_id}
                          </option>
                        ))}
                    </select>
                  </div>

                  {oppRosterOwnerId && !oppRoster && (
                    <p className="text-sm text-gray-500">Roster not found.</p>
                  )}

                  {oppRoster && (
                    <>
                      {/* Tabs + search */}
                      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-4">
                        <div className="flex flex-wrap gap-2 mb-3">
                          {["ROSTER","QB","RB","WR","TE","PICKS"].map((pos) => (
                            <button
                              key={pos}
                              onClick={() => setOppRosterTab(pos)}
                              className={`px-3 py-1 rounded text-sm ${oppRosterTab === pos ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"}`}
                            >
                              {pos}
                            </button>
                          ))}
                        </div>
                        {["QB","RB","WR","TE"].includes(oppRosterTab) && (
                          <input
                            className="w-full p-2.5 rounded bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Search players..."
                            value={oppRosterSearch}
                            onChange={(e) => setOppRosterSearch(e.target.value)}
                          />
                        )}
                      </div>

                      {/* Position view */}
                      {["QB","RB","WR","TE"].includes(oppRosterTab) && (
                        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
                          <div className="text-sm font-semibold mb-3 text-gray-300">{oppRosterTab}</div>
                          {oppFilteredPlayers?.map((p: any) => (
                            <div key={p.player_id} className={`flex items-center justify-between px-3 py-1.5 mb-1 rounded text-sm ${roleColors[p.role]}`}>
                              <div className="flex items-center gap-2 truncate">
                                <span className="font-medium">{p.full_name}</span>
                                <span className="text-xs text-gray-400">{p.team}</span>
                                <span className="text-xs text-gray-500">{p.role.toUpperCase()}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                                <span className="text-gray-400">Age {p.age || "—"}</span>
                                <span className="text-blue-400 font-semibold">{p.value || 0}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Full roster grid */}
                      {oppRosterTab === "ROSTER" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {["QB","RB","WR","TE"].map((pos) => {
                            const posPlayers = oppGrouped[pos];
                            const starters = posPlayers.filter((p: any) => p.role === "starter");
                            const bench = posPlayers.filter((p: any) => p.role === "bench");
                            const totalVal = posPlayers.reduce((s: number, p: any) => s + (p.value || 0), 0);
                            return (
                              <div key={pos} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                                <div className="flex justify-between mb-3">
                                  <div className="font-semibold text-sm">{pos} {posPlayers.length} TOTAL</div>
                                  <div className="text-xs text-gray-400">TOTAL {pos} VAL {totalVal}</div>
                                </div>
                                {starters.map((p: any, i: number) => (
                                  <div key={`s-${i}`} className="flex justify-between items-center bg-green-900/30 border border-green-700 rounded p-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs px-2 py-1 rounded bg-green-700">STARTER</div>
                                      <div>{p.full_name}</div>
                                    </div>
                                    <div className="text-xs text-gray-300">VAL {p.value || 0}</div>
                                  </div>
                                ))}
                                {bench.map((p: any, i: number) => (
                                  <div key={`b-${i}`} className="flex justify-between items-center bg-blue-900/30 border border-blue-700 rounded p-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs px-2 py-1 rounded bg-blue-700">{pos}{starters.length + i + 1}</div>
                                      <div>{p.full_name}</div>
                                    </div>
                                    <div className="text-xs text-gray-300">VAL {p.value || 0}</div>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                          {/* Taxi */}
                          {oppTaxiIds.size > 0 && (
                            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                              <div className="font-semibold text-sm text-purple-400 mb-3">TAXI {oppTaxiIds.size} TOTAL</div>
                              {[...oppTaxiIds].map((id, i) => {
                                const p = players[id];
                                if (!p) return null;
                                return (
                                  <div key={i} className="flex justify-between items-center bg-purple-900/30 border border-purple-700 rounded p-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs px-2 py-1 rounded bg-purple-700">TX{i+1}</div>
                                      <div>{p.full_name}</div>
                                    </div>
                                    <div className="text-xs text-gray-400">VAL {p.value || 0}</div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Picks */}
                      {oppRosterTab === "PICKS" && (
                        <div className="mt-2">
                          {YEARS.map((year) => {
                            const yearPicks = oppPicksForOwner
                              .filter((p: any) => p.season === year)
                              .sort((a: any, b: any) => a.round !== b.round ? a.round - b.round : (a.pick_no || 0) - (b.pick_no || 0));
                            if (!yearPicks.length) return null;
                            return (
                              <div key={year} className="mb-4 bg-gray-900 border border-gray-700 rounded-lg p-4">
                                <div className="font-semibold text-sm mb-2">{year} Picks — {yearPicks.length} TOTAL</div>
                                <div className="flex flex-wrap gap-2">
                                  {yearPicks.map((pick: any, i: number) => {
                                    const label = pick.season === CURRENT_YEAR ? pick.slot : `${pick.round}${["th","st","nd","rd"][pick.round] || "th"}`;
                                    const originalOwner = users[pick.roster_id] || "";
                                    return (
                                      <div key={i} className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1 ${
                                        pick.round === 1 ? "bg-yellow-900/40 border-yellow-600 text-yellow-300"
                                        : pick.round === 2 ? "bg-green-900/40 border-green-600 text-green-300"
                                        : pick.round === 3 ? "bg-blue-900/40 border-blue-600 text-blue-300"
                                        : "bg-orange-900/40 border-orange-600 text-orange-300"
                                      }`}>
                                        <span className="font-semibold">{label}</span>
                                        {originalOwner && pick.roster_id !== oppRoster.roster_id && (
                                          <span className="text-[10px] text-gray-300">via {originalOwner}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

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
              const projectionBySleeperId = new Map(
                projectionData.map((row: any) => [String(row.sleeperId), row])
              );
              const hasKickoffData = projectionData.some((row: any) => getProjectionKickoffAt(row));

              // Score function: uses projections if in-season, redraft values otherwise
              const playerScore = (id: string) => {
                if (isInSeason) {
                  const proj = projectionBySleeperId.get(String(id));
                  return proj?.fpts ?? 0;
                }
                return redraftValues[id] ?? 0;
              };

              const playerKickoffAt = (id: string) => {
                if (!isInSeason) return null;
                const proj = projectionBySleeperId.get(String(id));
                return getProjectionKickoffAt(proj);
              };

              const positions: string[] = selectedLeague.roster_positions?.filter((p: string) => !["BN","IR","TAXI"].includes(p)) ?? [];
              const myPlayerIds: string[] = roster.players ?? [];
              const taxiIds = new Set<string>((roster.taxi ?? []).map((id: any) => String(id)));
              const used = new Set<string>();
              const initialLineup: Array<{ slot: string; player: any; score: number; kickoffAt: number | null }> = [];
              const currentStarterRows = positions.map((slot: string, index: number) => {
                const starterId = String(roster?.starters?.[index] || "");
                const starterPlayer = starterId ? (players as any)[starterId] : null;
                return {
                  slot,
                  player: starterPlayer,
                  score: starterPlayer ? playerScore(starterPlayer.player_id) : 0,
                  kickoffAt: starterPlayer ? playerKickoffAt(starterPlayer.player_id) : null,
                };
              });

              // Fill each slot greedily with highest-scoring eligible player
              for (const slot of positions) {
                const eligible = getLineupSlotEligiblePositions(slot);
                const best = myPlayerIds
                  .filter(id => !used.has(id))
                  .map(id => ({ id, p: (players as any)[id] }))
                  .filter(({ p }) => p && eligible.includes(p.position))
                  .sort((a, b) => playerScore(b.id) - playerScore(a.id))[0];
                if (best) {
                  used.add(best.id);
                  initialLineup.push({ slot, player: best.p, score: playerScore(best.id), kickoffAt: playerKickoffAt(best.id) });
                } else {
                  initialLineup.push({ slot, player: null, score: 0, kickoffAt: null });
                }
              }

              const lineup = rebalanceLineupForKickoffWindows(initialLineup, isInSeason && hasKickoffData);

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

              const lineupCoachNotes = lineup
                .map(({ slot, player, score }, index) => {
                  if (!player?.player_id) return null;
                  const currentRow = currentStarterRows[index];
                  const currentPlayer = currentRow?.player;
                  if (currentPlayer?.player_id === player.player_id) return null;
                  const delta = score - (currentRow?.score || 0);
                  const reasonParts = [
                    delta > 0
                      ? `${isInSeason ? "Projection" : "Redraft score"} improves by ${delta.toFixed(1)}`
                      : `${isInSeason ? "Projection" : "Redraft score"} is safer for this slot`,
                    currentPlayer?.status && /out|doubtful|inactive|suspended/i.test(String(currentPlayer.status))
                      ? `${currentPlayer.full_name} is ${String(currentPlayer.status).toLowerCase()}`
                      : null,
                    slot === "FLEX" || slot === "SUPER_FLEX"
                      ? `${player.full_name} is the strongest remaining ${slot === "SUPER_FLEX" ? "flex-eligible" : "flex"} fit`
                      : `${player.full_name} grades best at ${slot.replace("_", " ")}`,
                    isInSeason &&
                    hasKickoffData &&
                    currentRow?.slot !== slot &&
                    currentPlayer?.position === player.position
                      ? `${player.full_name} gets the earlier locked slot so later-game flexibility stays in ${currentRow.slot.replace("_", " ")}`
                      : null,
                  ].filter(Boolean);

                  return {
                    slot,
                    suggested: player,
                    current: currentPlayer,
                    delta,
                    reason: reasonParts.join(" • "),
                  };
                })
                .filter(Boolean) as Array<{
                  slot: string;
                  suggested: any;
                  current: any;
                  delta: number;
                  reason: string;
                }>;

              const currentLineupScore = currentStarterRows.reduce((sum: number, row) => sum + (row.score || 0), 0);
              const suggestedLineupScore = lineup.reduce((sum: number, row) => sum + (row.score || 0), 0);
              const lineupDelta = suggestedLineupScore - currentLineupScore;

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
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Lineup Coach</div>
                        <div className="mt-1 text-sm text-gray-200">
                          {lineupCoachNotes.length === 0
                            ? "Your current lineup already matches the coach recommendation."
                            : `The coach would make ${lineupCoachNotes.length} swap${lineupCoachNotes.length === 1 ? "" : "s"}${lineupDelta > 0 ? ` for roughly +${lineupDelta.toFixed(1)}` : ""}.`}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center md:min-w-[220px]">
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">Current</div>
                          <div className="mt-1 text-sm font-semibold text-white">{currentLineupScore.toFixed(1)}</div>
                        </div>
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">Suggested</div>
                          <div className={`mt-1 text-sm font-semibold ${lineupDelta > 0 ? "text-green-300" : "text-white"}`}>
                            {suggestedLineupScore.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </div>
                    {lineupCoachNotes.length > 0 && (
                      <div className="mt-4 grid gap-2">
                        {lineupCoachNotes.map((note) => (
                          <div key={`${note.slot}-${note.suggested.player_id}-${note.current?.player_id || "empty"}`} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="rounded-full border border-blue-800 bg-blue-950/40 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                                {note.slot.replace("_", " ")}
                              </span>
                              <span className="text-white">{note.current?.full_name || "Empty slot"}</span>
                              <span className="text-gray-500">→</span>
                              <span className="font-semibold text-green-300">{note.suggested.full_name}</span>
                              <span className={`text-xs font-mono ${note.delta > 0 ? "text-green-300" : "text-gray-400"}`}>
                                {note.delta > 0 ? "+" : ""}{note.delta.toFixed(1)}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-gray-400">{note.reason}</div>
                          </div>
                        ))}
                      </div>
                    )}
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
                  <p className="text-[10px] text-gray-600">{supabaseUser ? "Notes sync across your devices." : "Notes save to this browser only."}</p>
                </div>
              );
            })()}

            {/* ── Power Rankings ── */}
            {leagueHubTab === "POWER_RANKINGS" && (() => {
              if (!selectedLeague || !rosters.length) return (
                <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view Power Rankings.</p>
              );
              if (loadingCalcValues) return <p className="text-sm text-blue-400">Loading player values…</p>;

              const calcVal = (id: string) => calcFcValues[id] ?? (players as any)[id]?.value ?? 0;

              // Build all rosters with per-position dynasty totals + picks
              const prRows = rosters.map((r: any) => {
                const ownerId = r.owner_id;
                const ownerName = (users as any)[ownerId] || `Team ${r.roster_id}`;
                const playerList = (r.players || []).map((id: string) => {
                  const p = (players as any)[id];
                  return p ? { ...p, dynVal: calcVal(id), redVal: redraftValues[id] || 0 } : null;
                }).filter(Boolean);

                const pickVal = (allPicks as any[])
                  .filter((p: any) => p.owner_id === r.roster_id)
                  .reduce((s: number, p: any) => s + getStoredPickValue(pickFcValues, p), 0);

                const dynTotal = playerList.reduce((s: number, p: any) => s + p.dynVal, 0) + pickVal;
                const redTotal = playerList.reduce((s: number, p: any) => s + p.redVal, 0);
                const qbTotal  = playerList.filter((p: any) => p.position === "QB").reduce((s: number, p: any) => s + p.dynVal, 0);
                const rbTotal  = playerList.filter((p: any) => p.position === "RB").reduce((s: number, p: any) => s + p.dynVal, 0);
                const wrTotal  = playerList.filter((p: any) => p.position === "WR").reduce((s: number, p: any) => s + p.dynVal, 0);
                const teTotal  = playerList.filter((p: any) => p.position === "TE").reduce((s: number, p: any) => s + p.dynVal, 0);

                return { roster_id: r.roster_id, ownerId, ownerName, playerList, dynTotal, redTotal, qbTotal, rbTotal, wrTotal, teTotal };
              });

              const rankMap = (key: "dynTotal"|"redTotal"|"qbTotal"|"rbTotal"|"wrTotal"|"teTotal") => {
                const sorted = [...prRows].sort((a, b) => b[key] - a[key]);
                return Object.fromEntries(sorted.map((row, i) => [row.roster_id, i + 1]));
              };

              const dynRanks = rankMap("dynTotal");
              const redRanks = rankMap("redTotal");
              const qbRanks  = rankMap("qbTotal");
              const rbRanks  = rankMap("rbTotal");
              const wrRanks  = rankMap("wrTotal");
              const teRanks  = rankMap("teTotal");

              const n = prRows.length;
              const ordinal = (r: number) => r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : `${r}th`;
              const pillColor = (r: number) => {
                const top3rd = Math.ceil(n / 3);
                const bot3rd = n - Math.floor(n / 3) + 1;
                if (r <= top3rd) return "bg-green-900/40 text-green-400 border-green-700";
                if (r >= bot3rd) return "bg-red-900/40 text-red-400 border-red-700";
                return "bg-gray-800/60 text-gray-400 border-gray-700";
              };

              const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;

              const sortedRows = [...prRows].sort((a, b) => {
                const diff = b[prSortKey] - a[prSortKey];
                return prSortAsc ? -diff : diff;
              });

              const SortTh = ({ col, label }: { col: typeof prSortKey; label: string }) => {
                const active = prSortKey === col;
                return (
                  <th
                    className="text-center pb-2 px-2 cursor-pointer select-none hover:text-white transition"
                    onClick={() => { if (active) setPrSortAsc(v => !v); else { setPrSortKey(col); setPrSortAsc(false); } }}
                  >
                    {label}{active ? (prSortAsc ? " ↑" : " ↓") : ""}
                  </th>
                );
              };

              const RankPill = ({ r, rosterId, col }: { r: number; rosterId: number; col: "dyn"|"red"|"QB"|"RB"|"WR"|"TE" }) => (
                <button
                  onClick={() => setPrPopup({ rosterId, col })}
                  className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border transition hover:opacity-80 cursor-pointer ${pillColor(r)}`}
                >
                  {ordinal(r)}
                </button>
              );

              // Popup content
              let popupContent: React.ReactNode = null;
              if (prPopup) {
                const popRow = prRows.find(r => r.roster_id === prPopup.rosterId);
                if (popRow) {
                  const col = prPopup.col;
                  let popPlayers: any[] = [];
                  if (col === "dyn" || col === "red") {
                    popPlayers = [...popRow.playerList].sort((a, b) =>
                      col === "dyn" ? b.dynVal - a.dynVal : b.redVal - a.redVal
                    );
                  } else {
                    popPlayers = popRow.playerList.filter((p: any) => p.position === col)
                      .sort((a: any, b: any) => b.dynVal - a.dynVal);
                  }
                  const colLabel = col === "dyn" ? "Dynasty" : col === "red" ? "Redraft" : col;
                  popupContent = (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setPrPopup(null)}>
                      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-80 max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wider">{colLabel} Roster</p>
                            <p className="text-sm font-semibold text-white">{popRow.ownerName}</p>
                          </div>
                          <button onClick={() => setPrPopup(null)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
                        </div>
                        <div className="space-y-1">
                          {popPlayers.map((p: any) => (
                            <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <button onClick={() => { setPrPopup(null); setPlayerProfileId(p.player_id); }} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                                <span className="text-[10px] text-gray-500 shrink-0">{p.position}</span>
                              </div>
                              <span className="text-xs text-gray-400 font-mono shrink-0 ml-2">
                                {col === "red" ? (p.redVal || 0).toLocaleString() : (p.dynVal || 0).toLocaleString()}
                              </span>
                            </div>
                          ))}
                          {(col === "dyn") && (allPicks as any[]).filter((p: any) => p.owner_id === prPopup.rosterId).length > 0 && (
                            <>
                              <p className="text-[10px] text-gray-600 uppercase tracking-wider pt-1 pb-0.5 pl-1">Picks</p>
                              {(allPicks as any[]).filter((p: any) => p.owner_id === prPopup.rosterId).map((p: any, i: number) => {
                                const via = p.roster_id !== p.owner_id ? ` (via Team ${p.roster_id})` : "";
                                const label = p.slot && String(p.slot).includes(".") ? `${p.season} ${p.slot}` : `${p.season} Rd ${p.round}`;
                                const val = getStoredPickValue(pickFcValues, p);
                                return (
                                  <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                                    <span className="text-xs text-white truncate">{label}{via}</span>
                                    <span className="text-xs text-gray-400 font-mono shrink-0 ml-2">{val.toLocaleString()}</span>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
              }

              return (
                <>
                  {popupContent}
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">Power rankings for <strong className="text-gray-300">{selectedLeague.name}</strong>. Dynasty rank includes picks. Click any pill to see that team's roster. Click column headers to sort.</p>
                    <div className="overflow-x-auto pb-1">
                      <table className="min-w-full text-sm border-separate border-spacing-y-1">
                        <thead>
                          <tr className="text-[10px] font-bold uppercase tracking-widest text-gray-600">
                            <th className="text-left pl-3 pb-2 pr-2">Owner</th>
                            <SortTh col="dynTotal" label="Dynasty" />
                            <SortTh col="redTotal" label="Redraft" />
                            <SortTh col="qbTotal" label="QB" />
                            <SortTh col="rbTotal" label="RB" />
                            <SortTh col="wrTotal" label="WR" />
                            <SortTh col="teTotal" label="TE" />
                          </tr>
                        </thead>
                        <tbody>
                          {sortedRows.map((row) => {
                            const isMe = row.roster_id === myRosterId;
                            return (
                              <tr key={row.roster_id} className={`${isMe ? "bg-blue-900/20" : "bg-gray-900"}`}>
                                <td className={`pl-3 pr-2 py-2.5 rounded-l-xl text-sm font-medium ${isMe ? "text-blue-300" : "text-white"}`}>
                                  {row.ownerName}{isMe && <span className="ml-1.5 text-[10px] text-blue-500">(you)</span>}
                                </td>
                                <td className="text-center px-2 py-2.5"><RankPill r={dynRanks[row.roster_id]} rosterId={row.roster_id} col="dyn" /></td>
                                <td className="text-center px-2 py-2.5"><RankPill r={redRanks[row.roster_id]} rosterId={row.roster_id} col="red" /></td>
                                <td className="text-center px-2 py-2.5"><RankPill r={qbRanks[row.roster_id]} rosterId={row.roster_id} col="QB" /></td>
                                <td className="text-center px-2 py-2.5"><RankPill r={rbRanks[row.roster_id]} rosterId={row.roster_id} col="RB" /></td>
                                <td className="text-center px-2 py-2.5"><RankPill r={wrRanks[row.roster_id]} rosterId={row.roster_id} col="WR" /></td>
                                <td className="text-center px-2 py-2.5 rounded-r-xl"><RankPill r={teRanks[row.roster_id]} rosterId={row.roster_id} col="TE" /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* ── Draft Board ── */}
            {leagueHubTab === "DRAFT_BOARD" && (() => {
              if (!selectedLeague) return (
                <p className="text-sm text-gray-500">Select a league first to view the draft board.</p>
              );

              const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;
              const mySlots = (allPicks as any[]).filter((p: any) => Number(p.roster_id ?? p.owner_id ?? 0) === Number(myRosterId) && p.slot).map((p: any) => p.slot as string);

              // Post-draft projection: players user has selected + predictions for remaining my slots
              const projectedMyPicks: string[] = [];
              mySlots.forEach(slot => {
                const pid = myDraftSlotPicks[slot] || predictedDraftPicks[slot]?.player_id;
                if (pid) projectedMyPicks.push(pid);
              });

              return (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-white">{ROOKIE_YEAR} Rookie Draft Board</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {mySlots.length > 0 ? `Your picks: ${mySlots.join(", ")}` : "Loading your draft slots…"}
                        {" · "}Ghost picks = AI prediction based on your big board + team needs
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {Object.keys(myDraftSlotPicks).length > 0 && (
                        <button
                          onClick={() => {
                            setMyDraftSlotPicks({});
                            if (selectedLeague?.league_id) {
                              localStorage.removeItem(`draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`);
                              if (supabaseUser) {
                                supabase
                                  .from("draft_board_picks")
                                  .delete()
                                  .eq("user_id", supabaseUser.id)
                                  .eq("league_id", selectedLeague.league_id)
                                  .eq("season", ROOKIE_YEAR)
                                  .then(() => {});
                              }
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white rounded-lg transition"
                        >
                          ✕ Reset Picks
                        </button>
                      )}
                      <button
                        onClick={refreshDraftBoard}
                        disabled={loadingDraftRefresh}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition"
                      >
                        {loadingDraftRefresh ? "Refreshing…" : "↻ Refresh"}
                      </button>
                    </div>
                  </div>

                  {!draftSettings ? (
                    <div className="text-gray-400 text-sm">
                      No draft found for this league. The draft board will appear once Sleeper creates the {ROOKIE_YEAR} draft.
                    </div>
                  ) : (
                    <>
                      {/* Draft grid */}
                      {draftHubSection === "BOARD" && draftSettings && (() => {
                        const slotOwnerMap: Record<string, number> = {};
                        (allPicks as any[]).forEach((p: any) => { if (p.slot) slotOwnerMap[p.slot] = Number(p.owner_id ?? p.roster_id ?? 0); });
                        const posColor: Record<string, string> = { QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400" };
                        // roster_id → display name map for cell owner rows
                        const rosterToName: Record<number, string> = {};
                        (rosters as any[]).forEach((r: any) => {
                          rosterToName[Number(r.roster_id)] = (users as any)[r.owner_id] || `Team ${r.roster_id}`;
                        });
                        return (
                          <div className="overflow-x-auto">
                            <div className="flex items-center gap-4 mb-3 text-[10px] text-gray-500">
                              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-900 border border-blue-600"/>My Slots (click to set)</span>
                              <span className="flex items-center gap-1 italic text-gray-600">Italic = predicted</span>
                              <span className="flex items-center gap-1"><span className="text-orange-400 font-bold">REACH</span> = &gt;8 ahead of ADP</span>
                              <span className="flex items-center gap-1"><span className="text-green-400 font-bold">VALUE</span> = &gt;5 after ADP</span>
                            </div>
                            <div
                              className="inline-grid min-w-max gap-y-1.5 gap-x-1.5"
                              style={{ gridTemplateColumns: `repeat(${rosters.length}, minmax(9rem, 1fr))` }}
                            >
                              {Array.from({ length: rosters.length }, (_, i) => i + 1).map((slot) => {
                                const userId = Object.keys(draftOrder).find((uid) => draftOrder[uid] === slot);
                                const slotRosterId = slotOwnerMap[`1.${String(slot).padStart(2,"0")}`] || null;
                                const isMe = slotRosterId === Number(myRosterId);
                                const teamName = (userId && users[userId]) || `Team ${slot}`;
                                return (
                                  <button key={slot} onClick={() => userId && loadDraftScout(userId)}
                                    className={`min-w-0 min-h-[2.5rem] px-2 text-center text-xs cursor-pointer whitespace-normal break-words leading-tight ${isMe ? "text-blue-300 font-bold" : "text-blue-400 hover:text-blue-300"}`}>
                                    {teamName}{isMe ? " ★" : ""}
                                  </button>
                                );
                              })}
                              {ROUNDS.flatMap((round) =>
                                Array.from({ length: rosters.length }, (_, i) => i + 1).map((slotNum) => {
                                  const slotStr = `${round}.${String(slotNum).padStart(2, "0")}`;
                                  const slotOwner = slotOwnerMap[slotStr];
                                  const isMySlot = slotOwner === Number(myRosterId);
                                  const playerPick = draftPicks.find((dp: any) => dp.round === round && Number(dp.roster_id ?? dp.picked_by) === slotOwner);
                                  const actualPlayer = playerPick ? (players as any)[playerPick.player_id] : null;
                                  const userOverrideId = myDraftSlotPicks[slotStr];
                                  const userOverride = userOverrideId ? rookies.find((r: any) => r.player_id === userOverrideId || r.name === userOverrideId) : null;
                                  const prediction = !actualPlayer && !userOverrideId ? predictedDraftPicks[slotStr] : null;
                                  const overallPick = (round - 1) * rosters.length + slotNum;
                                  const isReach = userOverride && typeof userOverride.adp === "number" && overallPick < userOverride.adp - 8;
                                  // REACH/VALUE for AI-predicted user slots — compare pick position to player's consensus pool rank
                                  const predReach = isMySlot && prediction && prediction.poolRank > 0 && overallPick < (prediction.poolRank ?? 999) - 7;
                                  const predValue = isMySlot && prediction && prediction.poolRank > 0 && overallPick > (prediction.poolRank ?? 0) + 4;
                                  const isEditing = draftSlotEditing === slotStr;
                                  return (
                                    <div key={slotStr}
                                      className={`relative min-w-0 h-20 rounded-md flex flex-col justify-center items-center text-xs px-2 gap-0.5 transition
                                        ${isMySlot ? "border-2 border-blue-600 bg-blue-950/40" : "border border-gray-700 bg-gray-800"}
                                        ${isMySlot && !actualPlayer ? "cursor-pointer hover:bg-blue-900/40" : ""}
                                      `}
                                      onClick={() => { if (!isMySlot || actualPlayer) return; setDraftSlotEditing(isEditing ? null : slotStr); setDraftSlotSearchQuery(""); }}
                                    >
                                      {actualPlayer ? (
                                        <>
                                          <div className="text-center w-full text-white font-medium whitespace-normal break-words leading-tight text-[10px]">{actualPlayer.full_name}</div>
                                          <div className={`text-[9px] ${posColor[actualPlayer.position] || "text-gray-400"}`}>{actualPlayer.position} · {actualPlayer.team}</div>
                                          <div className="text-[9px] text-gray-400 truncate w-full text-center">{rosterToName[slotOwner] || slotStr}</div>
                                        </>
                                      ) : userOverride ? (
                                        <>
                                          {isReach && <span className="absolute top-0.5 right-1 text-[8px] font-bold text-orange-400">REACH</span>}
                                          <div className="text-center w-full text-white font-semibold whitespace-normal break-words leading-tight text-[10px]">{userOverride.name}</div>
                                          <div className={`text-[9px] ${posColor[userOverride.position] || "text-gray-400"}`}>{userOverride.position}</div>
                                          <div className="text-[9px] text-blue-300 truncate w-full text-center">{rosterToName[slotOwner] || "You"}</div>
                                          <button className="absolute bottom-0.5 right-1 text-[8px] text-gray-500 hover:text-red-400" onClick={(e) => { e.stopPropagation(); const n = {...myDraftSlotPicks}; delete n[slotStr]; setMyDraftSlotPicks(n); }}>✕</button>
                                        </>
                                      ) : prediction ? (
                                        <>
                                          {predReach && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-orange-400">REACH</span>}
                                          {predValue && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-green-400">VALUE</span>}
                                          <div className="text-center w-full text-gray-400 italic whitespace-normal break-words leading-tight text-[10px]">{prediction.name}</div>
                                          <div className={`text-[9px] ${posColor[prediction.position] || "text-gray-500"} opacity-70`}>{prediction.position}</div>
                                          <div className="text-[9px] text-gray-500 italic truncate w-full text-center">{rosterToName[slotOwner] || slotStr}</div>
                                          {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                                        </>
                                      ) : (
                                        <>
                                          <div className="text-gray-600 font-semibold text-[10px]">{slotStr}</div>
                                          <div className="text-[9px] text-gray-600 truncate w-full text-center">{rosterToName[slotOwner] || ""}</div>
                                          {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                                        </>
                                      )}
                                      {isEditing && (
                                        <div className="absolute top-full left-0 z-50 w-64 bg-gray-900 border border-blue-600 rounded-xl shadow-2xl p-2 mt-1" onClick={(e) => e.stopPropagation()}>
                                          <input autoFocus className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1 mb-2 border border-gray-700 focus:outline-none focus:border-blue-500" placeholder="Search rookie…" value={draftSlotSearchQuery} onChange={(e) => setDraftSlotSearchQuery(e.target.value)} />
                                          <div className="max-h-44 overflow-y-auto space-y-0.5">
                                            {rookies.map((r: any, idx: number) => ({...r, boardRank: idx + 1}))
                                              .filter((r: any) => r.name && (!draftSlotSearchQuery || r.name.toLowerCase().includes(draftSlotSearchQuery.toLowerCase())))
                                              .filter((r: any) => !Array.from(draftedPlayerIds).includes(String(r.player_id)) && !Object.entries(myDraftSlotPicks).some(([s, pid]) => s !== slotStr && (pid === r.player_id || pid === r.name)))
                                              .slice(0, 15)
                                              .map((r: any) => {
                                                const pickNum = (round - 1) * rosters.length + slotNum;
                                                const reachAmt = typeof r.adp === "number" ? Math.round(pickNum - r.adp) : null;
                                                return (
                                                  <button key={`${r.boardRank}-${r.player_id || r.name}`} className="w-full text-left px-2 py-1 rounded hover:bg-gray-800 flex items-center justify-between gap-1"
                                                    onClick={() => { setMyDraftSlotPicks(prev => ({...prev, [slotStr]: r.player_id || r.name})); setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}>
                                                    <span className="text-white text-[10px] truncate">#{r.boardRank} {r.name}</span>
                                                    <span className="flex items-center gap-1 shrink-0">
                                                      <span className={`text-[9px] ${posColor[r.position] || "text-gray-400"}`}>{r.position}</span>
                                                      {reachAmt !== null && reachAmt < -8 && <span className="text-[8px] text-orange-400 font-bold">REACH</span>}
                                                      {reachAmt !== null && reachAmt > 5 && <span className="text-[8px] text-green-400">VALUE</span>}
                                                    </span>
                                                  </button>
                                                );
                                              })}
                                          </div>
                                          <button className="mt-1 w-full text-[9px] text-gray-600 hover:text-gray-400" onClick={() => { setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}>cancel</button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Post-draft projection */}
                      {projectedMyPicks.length > 0 && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                          <h3 className="text-sm font-semibold text-white mb-2">Projected Rookie Haul</h3>
                          <p className="text-[10px] text-gray-500 mb-3">Based on your set picks + AI predictions for remaining slots. Save to Supabase automatically.</p>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {projectedMyPicks.map((pid) => {
                              const r = rookies.find((rk: any) => rk.player_id === pid);
                              if (!r) return null;
                              const idx = rookies.indexOf(r);
                              const posColor: Record<string, string> = { QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400" };
                              return (
                                <div key={pid} className="bg-gray-800 rounded-lg px-3 py-2 flex items-center justify-between">
                                  <div>
                                    <div className="text-xs text-white font-medium">{r.name}</div>
                                    <div className={`text-[10px] ${posColor[r.position] || "text-gray-400"}`}>{r.position} · {r.team || "FA"}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-xs text-gray-400">#{idx + 1}</div>
                                    <div className="text-[9px] text-gray-600">ADP {Math.round(r.adp ?? 99)}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── Activity Feed ── */}
            {leagueHubTab === "ACTIVITY" && (() => {
              if (!selectedLeague) return (
                <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view the activity feed.</p>
              );
              if (loadingActivity) return <p className="text-sm text-blue-400">Loading transactions…</p>;

              const rosterToUser: Record<number, string> = {};
              rosters.forEach((r: any) => { rosterToUser[r.roster_id] = r.owner_id; });
              const ownerName = (rosterId: number) => {
                const uid = rosterToUser[rosterId];
                return (users as any)[uid] || `Team ${rosterId}`;
              };

              const fmtTs = (ts: number) => {
                if (!ts) return "";
                const d = new Date(ts);
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              };

              const txns = activityTransactions.filter((t: any) => {
                const hasPlayers = Object.keys(t.adds || {}).length > 0 || Object.keys(t.drops || {}).length > 0;
                const hasTradeParts = (t.draft_picks || []).length > 0 || Object.keys(t.adds || {}).length > 0;
                return hasPlayers || hasTradeParts;
              });

              if (!txns.length) return (
                <div className="text-center py-10 text-gray-500 text-sm">
                  No transactions found for {selectedLeague.name}. Activity appears here as the season progresses.
                </div>
              );

              return (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 mb-3">
                    Recent transactions for <strong className="text-gray-300">{selectedLeague.name}</strong>. Click any player name to view their profile.
                  </p>
                  {txns.map((t: any, idx: number) => {
                    const isWaiver = t.type === "waiver";
                    const isFreeAgent = t.type === "free_agent";
                    const isTrade = t.type === "trade";
                    const adds = Object.entries(t.adds || {}) as [string, number][];
                    const drops = Object.entries(t.drops || {}) as [string, number][];
                    const picks = (t.draft_picks || []) as any[];

                    const typeLabel = isTrade ? "Trade" : isWaiver ? "Waiver" : "Free Agent";
                    const typeColor = isTrade
                      ? "bg-purple-900/40 text-purple-300 border-purple-700"
                      : isWaiver
                      ? "bg-blue-900/40 text-blue-300 border-blue-700"
                      : "bg-green-900/40 text-green-300 border-green-700";

                    if (isTrade) {
                      // Group adds/drops by roster (each roster's perspective)
                      const rosterIds = Array.from(new Set([
                        ...adds.map(([, rid]) => rid),
                        ...drops.map(([, rid]) => rid),
                        ...(t.roster_ids || []),
                      ])) as number[];

                      return (
                        <div key={t.transaction_id || idx} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeColor}`}>{typeLabel}</span>
                              <span className="text-xs text-gray-500">{fmtTs(t.status_updated || t.created)}</span>
                            </div>
                          </div>
                          <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${Math.min(rosterIds.length, 3)}, 1fr)` }}>
                            {rosterIds.map((rid) => {
                              const got = adds.filter(([, r]) => r === rid).map(([pid]) => pid);
                              const gave = drops.filter(([, r]) => r === rid).map(([pid]) => pid);
                              const gotPicks = picks.filter((p: any) => p.owner_id === rid);
                              const gavePicks = picks.filter((p: any) => p.previous_owner_id === rid);
                              return (
                                <div key={rid}>
                                  <p className="text-xs font-semibold text-blue-300 mb-1">{ownerName(rid)}</p>
                                  {got.length > 0 && (
                                    <div className="mb-1">
                                      <p className="text-[10px] text-green-500 uppercase font-bold mb-0.5">Received</p>
                                      {got.map(pid => {
                                        const p = (players as any)[pid];
                                        return p ? (
                                          <button key={pid} onClick={() => setPlayerProfileId(pid)} className="block text-xs text-white hover:text-blue-400 transition text-left">
                                            {p.full_name} <span className="text-gray-500">{p.position}</span>
                                          </button>
                                        ) : null;
                                      })}
                                      {gotPicks.map((pk: any, i: number) => (
                                        <p key={i} className="text-xs text-gray-400">{pk.season} Rd {pk.round}</p>
                                      ))}
                                    </div>
                                  )}
                                  {gave.length > 0 && (
                                    <div>
                                      <p className="text-[10px] text-red-400 uppercase font-bold mb-0.5">Gave</p>
                                      {gave.map(pid => {
                                        const p = (players as any)[pid];
                                        return p ? (
                                          <button key={pid} onClick={() => setPlayerProfileId(pid)} className="block text-xs text-gray-400 hover:text-blue-400 transition text-left line-through">
                                            {p.full_name} <span className="text-gray-600">{p.position}</span>
                                          </button>
                                        ) : null;
                                      })}
                                      {gavePicks.map((pk: any, i: number) => (
                                        <p key={i} className="text-xs text-gray-600 line-through">{pk.season} Rd {pk.round}</p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    // Add / Drop / Waiver
                    return (
                      <div key={t.transaction_id || idx} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-start gap-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 mt-0.5 ${typeColor}`}>{typeLabel}</span>
                        <div className="min-w-0 flex-1">
                          {adds.map(([pid, rid]) => {
                            const p = (players as any)[pid];
                            return p ? (
                              <div key={pid} className="flex items-center gap-1.5 text-xs">
                                <span className="text-green-400 font-bold">+</span>
                                <button onClick={() => setPlayerProfileId(pid)} className="text-white hover:text-blue-400 transition font-medium">
                                  {p.full_name}
                                </button>
                                <span className="text-gray-500">{p.position} · {p.team}</span>
                                <span className="text-gray-600">→ {ownerName(rid)}</span>
                              </div>
                            ) : null;
                          })}
                          {drops.map(([pid, rid]) => {
                            const p = (players as any)[pid];
                            return p ? (
                              <div key={pid} className="flex items-center gap-1.5 text-xs">
                                <span className="text-red-400 font-bold">−</span>
                                <button onClick={() => setPlayerProfileId(pid)} className="text-gray-400 hover:text-blue-400 transition line-through">
                                  {p.full_name}
                                </button>
                                <span className="text-gray-600">{p.position} · {p.team} dropped by {ownerName(rid)}</span>
                              </div>
                            ) : null;
                          })}
                        </div>
                        <span className="text-[10px] text-gray-600 shrink-0 mt-0.5">{fmtTs(t.status_updated || t.created)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

          </>
          </div>
        )}

        {mainTab === "GAMEDAY_HUB" && (() => {
          const starterSlots = (selectedLeague?.roster_positions || []).filter(
            (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
          );
          const selectedMatchup = selectedGamedayMatchup;
          const teamA = selectedMatchup?.teams?.[0] || null;
          const teamB = selectedMatchup?.teams?.[1] || null;
          const renderPlayerCell = (row: any, side: "left" | "right") => {
            if (!row?.player) {
              return (
                <div className={`text-xs text-gray-600 ${side === "right" ? "text-right" : ""}`}>
                  Open slot
                </div>
              );
            }

            return (
              <div className={`min-w-0 ${side === "right" ? "text-right" : ""}`}>
                <button
                  onClick={() => setPlayerProfileId(row.player.player_id)}
                  className="block w-full truncate text-sm font-medium text-white hover:text-blue-400 transition"
                >
                  {row.player.full_name}
                </button>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
                  <span className={`${side === "right" ? "ml-auto" : ""}`}>
                    {row.player.position} • {row.player.team || "-"}
                  </span>
                  <span className={`rounded-full border px-1.5 py-0.5 ${getKickoffStateClasses(row.gameState)}`}>
                    {row.gameState}
                  </span>
                  <span>{row.kickoffLabel}</span>
                </div>
                <div className="mt-1 text-xs text-gray-300">
                  {row.actualPoints.toFixed(1)} pts now • {row.remainingProjection.toFixed(1)} left
                </div>
              </div>
            );
          };

          return (
            <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Gameday Hub</div>
                    <div className="mt-1 text-sm text-gray-200">
                      Official Sleeper matchup totals for the current week, with projected remaining points layered on from your existing player projection system.
                    </div>
                    <div className="mt-2 text-[11px] text-gray-500">
                      Player status badges use kickoff windows: upcoming before kickoff, live for roughly six hours after kickoff, then final.
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={selectedLeague?.league_id || ""}
                      onChange={(e) => {
                        const nextLeague = leagues.find((league: any) => league.league_id === e.target.value);
                        if (nextLeague) loadRoster(nextLeague);
                      }}
                      className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Select a league</option>
                      {leagues.map((league: any) => (
                        <option key={league.league_id} value={league.league_id}>
                          {league.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (selectedLeague?.league_id && gamedayWeek) loadGamedayMatchups(selectedLeague.league_id, gamedayWeek);
                        if (gamedayWeek) {
                          setProjectionWeek(gamedayWeek);
                          setProjectionLoaded(false);
                          loadProjections(gamedayWeek);
                        }
                      }}
                      disabled={!selectedLeague?.league_id || !gamedayWeek}
                      className={`rounded-xl border px-3 py-2 text-sm transition ${
                        selectedLeague?.league_id && gamedayWeek
                          ? "border-blue-700 text-blue-300 hover:bg-blue-500/10"
                          : "border-gray-800 text-gray-600 cursor-not-allowed"
                      }`}
                    >
                      Refresh Snapshot
                    </button>
                  </div>
                </div>
              </div>

              {!selectedLeague && (
                <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
                  Pick a league above to load its current-week matchups.
                </div>
              )}

              {selectedLeague && !gamedayWeek && (
                <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
                  Gameday Hub only turns on during the regular season once Sleeper posts an active NFL week.
                </div>
              )}

              {selectedLeague && gamedayWeek > 0 && (
                <>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{selectedLeague.name} • Week {gamedayWeek}</span>
                    <span>{loadingGamedayMatchups ? "Refreshing matchup totals..." : `${gamedayMatchupCards.length} matchup${gamedayMatchupCards.length === 1 ? "" : "s"}`}</span>
                  </div>

                  {loadingGamedayMatchups && gamedayMatchupCards.length === 0 ? (
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-blue-400">
                      Loading current-week matchup totals...
                    </div>
                  ) : gamedayMatchupCards.length === 0 ? (
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
                      No matchup data returned yet for this league and week.
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 lg:grid-cols-2">
                        {gamedayMatchupCards.map((card: any) => (
                          <button
                            key={card.matchupId}
                            onClick={() => setSelectedGamedayMatchupId(card.matchupId)}
                            className={`rounded-2xl border p-4 text-left transition ${
                              selectedMatchup?.matchupId === card.matchupId
                                ? "border-blue-500 bg-blue-500/10"
                                : "border-gray-800 bg-gray-900/60 hover:border-gray-700"
                            }`}
                          >
                            <div className="mb-3 flex items-center justify-between">
                              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Matchup {card.matchupId}
                              </div>
                              <div className="text-[11px] text-gray-600">
                                {card.teams.reduce((total: number, team: any) => total + team.liveStarters, 0) > 0 ? "Games in progress" : "Snapshot"}
                              </div>
                            </div>
                            <div className="space-y-3">
                              {card.teams.map((team: any) => (
                                <div key={team.rosterId} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2.5">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold text-white">{team.ownerName}</div>
                                      <div className="mt-1 text-[11px] text-gray-500">
                                        {team.finishedStarters} final • {team.liveStarters} live • {team.upcomingStarters} upcoming
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-lg font-semibold text-white">{team.actualPoints.toFixed(1)}</div>
                                      <div className="text-[11px] text-gray-500">+{team.remainingProjection.toFixed(1)} left</div>
                                    </div>
                                  </div>
                                  <div className="mt-2 text-xs text-gray-400">
                                    Projected final: <span className="text-gray-200">{team.projectedFinal.toFixed(1)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </button>
                        ))}
                      </div>

                      {selectedMatchup && teamA && teamB && (
                        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                          <div className="flex flex-col gap-3 border-b border-gray-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Detailed Matchup View</div>
                              <div className="mt-1 text-lg font-semibold text-white">
                                {teamA.ownerName} vs {teamB.ownerName}
                              </div>
                              <div className="mt-1 text-sm text-gray-400">
                                Week {gamedayWeek} • official matchup totals + projected remaining lineup points
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-right">
                              {[teamA, teamB].map((team: any) => (
                                <div key={team.rosterId} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                                  <div className="text-xs text-gray-500">{team.ownerName}</div>
                                  <div className="mt-1 text-xl font-semibold text-white">{team.actualPoints.toFixed(1)}</div>
                                  <div className="text-[11px] text-gray-500">{team.remainingProjection.toFixed(1)} left • {team.projectedFinal.toFixed(1)} final</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="mt-4 space-y-2">
                            <div className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_78px] gap-3 px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                              <span>{teamA.ownerName}</span>
                              <span className="text-center">Slot</span>
                              <span className="text-right">{teamB.ownerName}</span>
                              <span className="text-right">Delta</span>
                            </div>
                            {starterSlots.map((slot: string, index: number) => {
                              const leftRow = teamA.starterRows[index];
                              const rightRow = teamB.starterRows[index];
                              const delta = (leftRow?.actualPoints || 0) - (rightRow?.actualPoints || 0);

                              return (
                                <div key={`${selectedMatchup.matchupId}-${slot}-${index}`} className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)_78px] gap-3 items-center rounded-xl border border-gray-800 bg-gray-950/50 px-3 py-3">
                                  {renderPlayerCell(leftRow, "left")}
                                  <div className="text-center">
                                    <div className="text-[11px] font-semibold text-gray-300">{slot.replace("_", " ")}</div>
                                    <div className="mt-1 text-[10px] text-gray-600">
                                      {(leftRow?.actualPoints || 0).toFixed(1)} - {(rightRow?.actualPoints || 0).toFixed(1)}
                                    </div>
                                  </div>
                                  {renderPlayerCell(rightRow, "right")}
                                  <div className={`text-right text-sm font-semibold ${delta > 0.05 ? "text-green-400" : delta < -0.05 ? "text-red-400" : "text-gray-400"}`}>
                                    {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="mt-4 grid gap-3 lg:grid-cols-2">
                            {[teamA, teamB].map((team: any) => (
                              <div key={`${selectedMatchup.matchupId}-${team.rosterId}`} className="rounded-xl border border-gray-800 bg-gray-950/50 p-3">
                                <div className="text-sm font-semibold text-white">{team.ownerName} bench + taxi</div>
                                <details className="mt-3 group" open={false}>
                                  <summary className="cursor-pointer list-none text-xs font-semibold text-blue-300 group-open:text-blue-200">
                                    Bench ({team.benchRows.length})
                                  </summary>
                                  <div className="mt-2 space-y-2">
                                    {team.benchRows.length === 0 ? (
                                      <div className="text-xs text-gray-600">No bench players loaded.</div>
                                    ) : team.benchRows.map((row: any) => (
                                      <div key={`${team.rosterId}-bench-${row.playerId}`} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
                                        <button onClick={() => setPlayerProfileId(row.playerId)} className="min-w-0 truncate text-xs font-medium text-white hover:text-blue-400 transition">
                                          {row.player.full_name}
                                        </button>
                                        <div className="shrink-0 text-right text-[11px] text-gray-500">
                                          {row.actualPoints.toFixed(1)} now • {row.remainingProjection.toFixed(1)} left
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                                <details className="mt-3 group">
                                  <summary className="cursor-pointer list-none text-xs font-semibold text-blue-300 group-open:text-blue-200">
                                    Taxi ({team.taxiRows.length})
                                  </summary>
                                  <div className="mt-2 space-y-2">
                                    {team.taxiRows.length === 0 ? (
                                      <div className="text-xs text-gray-600">No taxi players loaded.</div>
                                    ) : team.taxiRows.map((row: any) => (
                                      <div key={`${team.rosterId}-taxi-${row.playerId}`} className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
                                        <button onClick={() => setPlayerProfileId(row.playerId)} className="min-w-0 truncate text-xs font-medium text-white hover:text-blue-400 transition">
                                          {row.player.full_name}
                                        </button>
                                        <div className="shrink-0 text-right text-[11px] text-gray-500">
                                          {row.actualPoints.toFixed(1)} now • {row.remainingProjection.toFixed(1)} left
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* DATA HUB TAB */}
        {mainTab === "DATA_HUB" && (
          <>
            {/* Sub-tab nav */}
            <div className="flex justify-center border-b border-gray-800 mb-6 overflow-x-auto">
              <div className="flex justify-center gap-6 text-center">
              {(["OWNERSHIP", "DYNASTY", "REDRAFT", "PROJECTIONS", "PICK_VALUES", "LEAGUEMATES"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDataHubTab(tab)}
                  className={`pb-2 px-1 text-sm font-semibold transition ${
                    dataHubTab === tab
                      ? "border-b-2 border-blue-400 text-blue-400"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {tab === "OWNERSHIP" ? "Player Ownership" : tab === "DYNASTY" ? "Dynasty Rankings" : tab === "REDRAFT" ? "Redraft Rankings" : tab === "PROJECTIONS" ? "Player Projections" : tab === "PICK_VALUES" ? "Pick Values" : "League Mate Stats"}
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
              const sellColor = (v: string) =>
                v === "Trade at All Costs" ? "text-green-400" :
                v === "Lower than Market" ? "text-green-600" :
                v === "Not Willing to Trade" ? "text-red-400" :
                v === "Will Trade but Higher than Market" ? "text-yellow-400" : "text-gray-500";
              const buyColor = (v: string) =>
                v === "Buy Over Market" ? "text-green-400" :
                v === "Buy at Market" ? "text-green-600" :
                v === "Zero Interest" ? "text-red-400" :
                v === "Buy Low" ? "text-yellow-400" : "text-gray-500";

              return (
                <>
                  {loadingCalcValues && (
                    <p className="text-sm text-blue-400 mb-4">Loading values…</p>
                  )}
                  <div className="flex gap-2 mb-3">
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
                  {/* Column headers */}
                  <div className="flex items-center gap-2 px-2 mb-1">
                    <span className="w-5 shrink-0" />
                    <span className="w-6 shrink-0" />
                    <span className="flex-1 text-[10px] text-gray-600 uppercase tracking-wider">Player</span>
                    <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Value</span>
                    <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Away</span>
                    <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">For</span>
                    <span className="w-4 shrink-0" />
                  </div>
                  <div className="space-y-0.5">
                    {ranked.map((p: any, idx: number) => {
                      const disp = playerDispositions[p.player_id] ?? { sell: "Neutral", buy: "Neutral" };
                      return (
                        <div key={p.player_id} className="flex items-center gap-2 bg-gray-800/70 hover:bg-gray-800 rounded-lg px-2 py-1.5 transition">
                          <span className="text-[10px] text-gray-600 w-5 text-right shrink-0">{idx + 1}</span>
                          <span className={`text-[10px] font-bold w-6 shrink-0 ${posColor[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                          <span className="text-xs text-white flex-1 truncate min-w-0">{p.full_name}</span>
                          <span className="text-[10px] text-gray-400 font-mono w-14 text-right shrink-0">{fcVal(p.player_id).toLocaleString()}</span>
                          <select
                            value={disp.sell}
                            onChange={(e) => savePlayerDisposition(p.player_id, e.target.value, disp.buy)}
                            className={`w-20 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] shrink-0 focus:outline-none focus:border-blue-500 ${sellColor(disp.sell)}`}
                          >
                            <option value="Not Willing to Trade">No Trade</option>
                            <option value="Will Trade but Higher than Market">↑ Price</option>
                            <option value="Neutral">Neutral</option>
                            <option value="Lower than Market">↓ Price</option>
                            <option value="Trade at All Costs">Must Go</option>
                          </select>
                          <select
                            value={disp.buy}
                            onChange={(e) => savePlayerDisposition(p.player_id, disp.sell, e.target.value)}
                            className={`w-20 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] shrink-0 focus:outline-none focus:border-blue-500 ${buyColor(disp.buy)}`}
                          >
                            <option value="Buy Over Market">Pay Up</option>
                            <option value="Buy at Market">At Mkt</option>
                            <option value="Neutral">Neutral</option>
                            <option value="Buy Low">Buy Low</option>
                            <option value="Zero Interest">Skip</option>
                          </select>
                          <button onClick={() => setPlayerProfileId(p.player_id)} className="text-gray-600 hover:text-blue-400 text-xs transition shrink-0 w-4" title="View profile">ⓘ</button>
                        </div>
                      );
                    })}
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
              const sellColor = (v: string) =>
                v === "Trade at All Costs" ? "text-green-400" :
                v === "Lower than Market" ? "text-green-600" :
                v === "Not Willing to Trade" ? "text-red-400" :
                v === "Will Trade but Higher than Market" ? "text-yellow-400" : "text-gray-500";
              const buyColor = (v: string) =>
                v === "Buy Over Market" ? "text-green-400" :
                v === "Buy at Market" ? "text-green-600" :
                v === "Zero Interest" ? "text-red-400" :
                v === "Buy Low" ? "text-yellow-400" : "text-gray-500";

              return (
                <>
                  {loadingRedraft && <p className="text-sm text-blue-400 mb-4">Loading values…</p>}
                  <div className="flex gap-2 mb-3">
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
                  {/* Column headers */}
                  <div className="flex items-center gap-2 px-2 mb-1">
                    <span className="w-5 shrink-0" />
                    <span className="w-6 shrink-0" />
                    <span className="flex-1 text-[10px] text-gray-600 uppercase tracking-wider">Player</span>
                    <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Value</span>
                    <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Away</span>
                    <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">For</span>
                    <span className="w-4 shrink-0" />
                  </div>
                  <div className="space-y-0.5">
                    {ranked.map((p: any, idx: number) => {
                      const disp = playerDispositions[p.player_id] ?? { sell: "Neutral", buy: "Neutral" };
                      return (
                        <div key={p.player_id} className="flex items-center gap-2 bg-gray-800/70 hover:bg-gray-800 rounded-lg px-2 py-1.5 transition">
                          <span className="text-[10px] text-gray-600 w-5 text-right shrink-0">{idx + 1}</span>
                          <span className={`text-[10px] font-bold w-6 shrink-0 ${posColor[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                          <span className="text-xs text-white flex-1 truncate min-w-0">{p.full_name}</span>
                          <span className="text-[10px] text-gray-400 font-mono w-14 text-right shrink-0">{(redraftValues[p.player_id] ?? 0).toLocaleString()}</span>
                          <select
                            value={disp.sell}
                            onChange={(e) => savePlayerDisposition(p.player_id, e.target.value, disp.buy)}
                            className={`w-20 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] shrink-0 focus:outline-none focus:border-blue-500 ${sellColor(disp.sell)}`}
                          >
                            <option value="Not Willing to Trade">No Trade</option>
                            <option value="Will Trade but Higher than Market">↑ Price</option>
                            <option value="Neutral">Neutral</option>
                            <option value="Lower than Market">↓ Price</option>
                            <option value="Trade at All Costs">Must Go</option>
                          </select>
                          <select
                            value={disp.buy}
                            onChange={(e) => savePlayerDisposition(p.player_id, disp.sell, e.target.value)}
                            className={`w-20 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] shrink-0 focus:outline-none focus:border-blue-500 ${buyColor(disp.buy)}`}
                          >
                            <option value="Buy Over Market">Pay Up</option>
                            <option value="Buy at Market">At Mkt</option>
                            <option value="Neutral">Neutral</option>
                            <option value="Buy Low">Buy Low</option>
                            <option value="Zero Interest">Skip</option>
                          </select>
                          <button onClick={() => setPlayerProfileId(p.player_id)} className="text-gray-600 hover:text-blue-400 text-xs transition shrink-0 w-4" title="View profile">ⓘ</button>
                        </div>
                      );
                    })}
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

            {/* ── Pick Values ── */}
            {dataHubTab === "PICK_VALUES" && (() => {
              if (!selectedLeague || !rosters.length) {
                return <p className="text-sm text-gray-500">Select a league first so pick value ranges can be tied to projected finish.</p>;
              }

              const pickRows = (allPicks as any[])
                .map((pick: any) => {
                  const key = `${pick.season}-${pick.round}-${pick.roster_id}`;
                  const dynamic = selectedLeagueDynamicPickValues[key];
                  const ownerName = users[pick.owner_id] || `Team ${pick.owner_id}`;
                  const issuerName = users[pick.roster_id] || `Team ${pick.roster_id}`;
                  const pickLabel = pick.slot && String(pick.slot).includes(".")
                    ? `${pick.season} ${pick.slot}`
                    : `${pick.season} Rd ${pick.round}`;
                  return {
                    ...pick,
                    key,
                    ownerName,
                    issuerName,
                    pickLabel,
                    dynamic,
                  };
                })
                .sort((a: any, b: any) => (b.dynamic?.expectedValue ?? 0) - (a.dynamic?.expectedValue ?? 0));

              return (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Dynamic Pick Valuation</div>
                    <div className="mt-1 text-sm text-gray-200">
                      Each pick now uses simulated finish distributions, expected slot outcomes, and team-specific playoff odds instead of one flat round value.
                    </div>
                  </div>

                  <div className="space-y-2">
                    {pickRows.map((pick: any) => {
                      const dynamic = pick.dynamic;
                      if (!dynamic) return null;
                      return (
                        <div key={pick.key} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-white">{pick.pickLabel}</span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  dynamic.bucket === "early" ? "border-red-700 bg-red-950/40 text-red-300" :
                                  dynamic.bucket === "late" ? "border-green-700 bg-green-950/40 text-green-300" :
                                  "border-yellow-700 bg-yellow-950/40 text-yellow-300"
                                }`}>
                                  {dynamic.label}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                Owned by {pick.ownerName} • tied to {pick.issuerName}'s finish
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-blue-300">{(dynamic.expectedValue || 0).toLocaleString()}</div>
                              <div className="text-[11px] text-gray-500">Range {dynamic.floorValue?.toLocaleString()} - {dynamic.ceilingValue?.toLocaleString()}</div>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-3">
                            <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-wide text-gray-500">Expected Slot</div>
                              <div className="mt-1 text-sm font-semibold text-white">
                                {typeof dynamic.expectedSlot === "number" ? dynamic.expectedSlot.toFixed(1) : "-"}
                              </div>
                              <div className="text-[11px] text-gray-500">Finish band {dynamic.finishRange || "-"}</div>
                            </div>
                            <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-wide text-gray-500">Issuer Outlook</div>
                              <div className="mt-1 text-sm font-semibold text-white">{Math.round(dynamic.issuerPlayoffOdds || 0)}%</div>
                              <div className="text-[11px] text-gray-500">Playoff odds for {dynamic.issuerName || pick.issuerName}</div>
                            </div>
                            <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                              <div className="text-[10px] uppercase tracking-wide text-gray-500">Most Likely Slots</div>
                              <div className="mt-1 text-xs text-gray-300">
                                {(dynamic.likelySlots || []).length > 0
                                  ? dynamic.likelySlots.map((slotRow: any) => `${slotRow.slot} (${Math.round((slotRow.probability || 0) * 100)}%)`).join(" | ")
                                  : "No slot spread"}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-3">
                            {(["early", "mid", "late"] as const).map((bucket) => (
                              <div key={bucket} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-gray-500">{bucket}</div>
                                <div className="mt-1 text-sm font-semibold text-white">
                                  {Math.round((dynamic.probabilities?.[bucket] || 0) * 100)}%
                                </div>
                                <div className="text-[11px] text-gray-500">
                                  {(dynamic.bandValues?.[bucket] ?? dynamic.expectedValue ?? 0).toLocaleString()}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── League Mate Stats ── */}
            {dataHubTab === "LEAGUEMATES" && (() => {
              const loadLeagueMateStats = async () => {
                if (!user || !leagues.length) return;
                setLoadingLeagueMateStats(true);
                try {
                  // Step 1: Fetch rosters + users for each of my leagues to get display names
                  // and build the shared-leagues count.
                  const myLeagueData = await Promise.all(
                    leagues.map(async (league: any) => {
                      const [rostersRes, leagueUsersRes] = await Promise.all([
                        fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then(r => r.json()).catch(() => []),
                        fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`).then(r => r.json()).catch(() => []),
                      ]);
                      return { league, rosters: rostersRes, leagueUsers: leagueUsersRes };
                    })
                  );

                  // Step 2: Build display name map and collect unique owner IDs + shared league counts
                  const displayNameMap: Record<string, string> = {};
                  const sharedLeaguesCount: Record<string, number> = {};
                  const allOwnerIds = new Set<string>();

                  myLeagueData.forEach(({ rosters, leagueUsers }) => {
                    (leagueUsers as any[]).forEach((u: any) => {
                      if (u?.user_id && u?.display_name) displayNameMap[u.user_id] = u.display_name;
                    });
                    (rosters as any[]).forEach((r: any) => {
                      if (!r.owner_id || r.owner_id === user.user_id) return;
                      allOwnerIds.add(r.owner_id);
                      sharedLeaguesCount[r.owner_id] = (sharedLeaguesCount[r.owner_id] || 0) + 1;
                    });
                  });

                  // Step 3: For each unique owner, fetch their total 2026 Sleeper league count.
                  const ownerStats = await Promise.all([...allOwnerIds].map(async (ownerId) => {
                    const theirLeagues: any[] = await fetch(`https://api.sleeper.app/v1/user/${ownerId}/leagues/nfl/${CURRENT_YEAR}`)
                      .then(r => r.json())
                      .then(d => Array.isArray(d) ? d : [])
                      .catch(() => []);

                    return {
                      userId: ownerId,
                      displayName: displayNameMap[ownerId] || users[ownerId] || ownerId,
                      totalLeagues: theirLeagues.filter((l: any) => (l.settings?.best_ball ?? 0) === 0).length,
                      bestBallLeagues: theirLeagues.filter((l: any) => (l.settings?.best_ball ?? 0) !== 0).length,
                      sharedLeagues: sharedLeaguesCount[ownerId] || 0,
                    };
                  }));

                  setLeagueMateStats(ownerStats);
                  setLeagueMateStatsLoaded(true);
                } finally {
                  setLoadingLeagueMateStats(false);
                }
              };

              const filtered = leagueMateStats.filter((o) =>
                o.displayName.toLowerCase().includes(leagueMateSearch.toLowerCase())
              );

              const sorted = [...filtered].sort((a, b) => {
                if (leagueMateSort === "total")  return b.totalLeagues  - a.totalLeagues  || a.displayName.localeCompare(b.displayName);
                if (leagueMateSort === "bestball") return b.bestBallLeagues - a.bestBallLeagues || a.displayName.localeCompare(b.displayName);
                if (leagueMateSort === "shared") return b.sharedLeagues - a.sharedLeagues || a.displayName.localeCompare(b.displayName);
                return a.displayName.localeCompare(b.displayName);
              });

              const thSort = (col: typeof leagueMateSort, label: string) => (
                <button
                  onClick={() => setLeagueMateSort(col)}
                  className={`flex items-center gap-1 whitespace-nowrap ${leagueMateSort === col ? "text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
                >
                  {label}
                  <span className="text-[10px]">{leagueMateSort === col ? "▼" : "↕"}</span>
                </button>
              );

              return (
                <div className="max-w-3xl mx-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-semibold text-white">League Mate Stats</h2>
                    {!leagueMateStatsLoaded && (
                      <button
                        onClick={loadLeagueMateStats}
                        disabled={loadingLeagueMateStats}
                        className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded transition"
                      >
                        {loadingLeagueMateStats ? "Loading…" : "Load Stats"}
                      </button>
                    )}
                    {leagueMateStatsLoaded && (
                      <button
                        onClick={loadLeagueMateStats}
                        disabled={loadingLeagueMateStats}
                        className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded transition"
                      >
                        {loadingLeagueMateStats ? "Refreshing…" : "Refresh"}
                      </button>
                    )}
                  </div>

                  {!leagueMateStatsLoaded && !loadingLeagueMateStats && (
                    <p className="text-sm text-gray-500">Click Load Stats to fetch data across all your leagues.</p>
                  )}
                  {loadingLeagueMateStats && (
                    <p className="text-sm text-blue-400">Loading league mate data…</p>
                  )}

                  {leagueMateStatsLoaded && (
                    <>
                      <input
                        className="w-full mb-4 p-2.5 rounded bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                        placeholder="Search owner name…"
                        value={leagueMateSearch}
                        onChange={(e) => setLeagueMateSearch(e.target.value)}
                      />
                      {sorted.length === 0 ? (
                        <p className="text-sm text-gray-500">No owners match your search.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="border-b border-gray-700">
                                <th className="text-left py-2 px-3">{thSort("name", "Owner")}</th>
                                <th className="text-center py-2 px-3">{thSort("total", "Total Leagues")}</th>
                                <th className="text-center py-2 px-3">{thSort("bestball", "Best Ball")}</th>
                                <th className="text-center py-2 px-3">{thSort("shared", "Shared Leagues")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sorted.map((owner, i) => (
                                <tr key={owner.userId} className={i % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                                  <td className="py-2 px-3 text-white font-medium">{owner.displayName}</td>
                                  <td className="py-2 px-3 text-center text-gray-300">{owner.totalLeagues}</td>
                                  <td className="py-2 px-3 text-center text-gray-300">{owner.bestBallLeagues}</td>
                                  <td className="py-2 px-3 text-center">
                                    <span className="text-blue-400 font-semibold">{owner.sharedLeagues}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="text-xs text-gray-600 mt-3">Total Leagues = {CURRENT_YEAR} non-best-ball NFL leagues for that owner on Sleeper.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
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
      <div className="flex justify-end gap-2 mb-3">
        {Object.keys(myDraftSlotPicks).length > 0 && (
          <button
            onClick={() => {
              setMyDraftSlotPicks({});
              if (selectedLeague?.league_id) {
                localStorage.removeItem(`draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`);
                if (supabaseUser) {
                  supabase
                    .from("draft_board_picks")
                    .delete()
                    .eq("user_id", supabaseUser.id)
                    .eq("league_id", selectedLeague.league_id)
                    .eq("season", ROOKIE_YEAR)
                    .then(() => {});
                }
              }
            }}
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white rounded-lg transition"
          >
            ✕ Reset Picks
          </button>
        )}
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

    {draftHubSection === "BOARD" && draftSettings && (() => {
      const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;
      const posColor: Record<string, string> = { QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400" };
      const rosterToName: Record<number, string> = {};
      (rosters as any[]).forEach((r: any) => {
        rosterToName[Number(r.roster_id)] = (users as any)[r.owner_id] || `Team ${r.roster_id}`;
      });

      return (
        <div className="overflow-x-auto">
          <div className="flex items-center gap-4 mb-3 text-[10px] text-gray-500 flex-wrap">
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-900 border border-blue-600"/>My Slots (click to set)</span>
            <span className="flex items-center gap-1 italic text-gray-600">Italic gray = AI prediction</span>
            <span className="text-orange-400 font-bold">REACH</span><span>&gt;8 ahead of ADP</span>
            <span className="text-green-400 font-bold">VALUE</span><span>&gt;5 after ADP</span>
          </div>
          <div
            className="inline-grid min-w-max gap-y-2"
            style={{ gridTemplateColumns: `repeat(${rosters.length}, minmax(9rem, 1fr))` }}
          >
            {/* TEAM HEADER — original logic, preserves traded-pick column ownership */}
            {Array.from({ length: rosters.length }, (_, i) => i + 1).map((slot) => {
              const userId = Object.keys(draftOrder).find((uid) => draftOrder[uid] === slot);
              const teamName = (userId && users[userId]) || `Team ${slot}`;
              // Check if my roster owns the 1.xx slot for this column
              const r1slot = `1.${String(slot).padStart(2, "0")}`;
              const r1pick = allPicks.find((p: any) => p.slot === r1slot);
              const isMe = r1pick && String(r1pick.owner_id) === String(myRosterId);
              return (
                <button
                  key={slot}
                  onClick={() => userId && loadDraftScout(userId)}
                  className={`min-w-0 min-h-[2.75rem] px-2 text-center text-xs cursor-pointer whitespace-normal break-words leading-tight ${isMe ? "text-blue-300 font-bold" : "text-blue-400 hover:text-blue-300"}`}
                  title={`View ${teamName}'s ${ROOKIE_YEAR} draft picks`}
                >
                  {teamName}{isMe ? " ★" : ""}
                </button>
              );
            })}

            {ROUNDS.flatMap((round) => {
              // Original: build round picks using allPicks.find by slot — correctly reflects trades
              const roundPicks = Array.from({ length: rosters.length }, (_, i) => {
                const slot = `${round}.${String(i + 1).padStart(2, "0")}`;
                const pick = allPicks.find((p: any) => p.slot === slot);
                return pick || { slot, owner_id: null, roster_id: null };
              });

              return roundPicks.map((pick: any, i: number) => {
                const slotStr = pick.slot as string;
                // Original: match actual draft pick by round + owner_id (handles traded picks correctly)
                const playerPick = draftPicks.find(
                  (dp: any) => dp.round === round && dp.roster_id === pick.owner_id
                );
                const actualPlayer = playerPick ? (players as any)[playerPick.player_id] : null;
                const isMySlot = pick.owner_id && String(pick.owner_id) === String(myRosterId);

                // New: user override + AI prediction for unfilled cells
                const userOverrideId = myDraftSlotPicks[slotStr];
                const userOverride = userOverrideId ? rookies.find((r: any) => r.player_id === userOverrideId || r.name === userOverrideId) : null;
                const prediction = !actualPlayer && !userOverrideId ? predictedDraftPicks[slotStr] : null;
                const overallPick = (round - 1) * rosters.length + (i + 1);
                const isReach = userOverride && typeof userOverride.adp === "number" && overallPick < userOverride.adp - 8;
                const predReach = isMySlot && prediction && (prediction.poolRank ?? 0) > 0 && overallPick < (prediction.poolRank ?? 999) - 7;
                const predValue = isMySlot && prediction && (prediction.poolRank ?? 0) > 0 && overallPick > (prediction.poolRank ?? 0) + 4;
                const isEditing = draftSlotEditing === slotStr;

                return (
                  <div
                    key={`${round}-${i}`}
                    className={`relative min-w-0 h-20 rounded-md flex flex-col justify-center items-center text-xs px-2 gap-0.5 transition
                      ${isMySlot && !actualPlayer ? "border-2 border-blue-600 bg-blue-950/40 cursor-pointer hover:bg-blue-900/40" : "border border-gray-700 bg-gray-800"}
                    `}
                    onClick={() => {
                      if (!isMySlot || actualPlayer) return;
                      setDraftSlotEditing(isEditing ? null : slotStr);
                      setDraftSlotSearchQuery("");
                    }}
                  >
                    {actualPlayer ? (
                      // Actual pick — name, position, owner
                      <>
                        <div className="text-center w-full text-white font-medium whitespace-normal break-words leading-tight text-[10px]">{actualPlayer.full_name}</div>
                        <div className={`text-[9px] ${posColor[actualPlayer.position] || "text-gray-400"}`}>{actualPlayer.position} · {actualPlayer.team}</div>
                        <div className="text-[9px] text-gray-400 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || slotStr}</div>
                      </>
                    ) : userOverride ? (
                      // User's manually set pick — name, position, owner
                      <>
                        {isReach && <span className="absolute top-0.5 right-1 text-[8px] font-bold text-orange-400">REACH</span>}
                        <div className="text-center w-full text-white font-semibold whitespace-normal break-words leading-tight text-[10px]">{userOverride.name}</div>
                        <div className={`text-[9px] ${posColor[userOverride.position] || "text-gray-400"}`}>{userOverride.position}</div>
                        <div className="text-[9px] text-blue-300 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || "You"}</div>
                        <button className="absolute bottom-0.5 right-1 text-[8px] text-gray-500 hover:text-red-400"
                          onClick={(e) => { e.stopPropagation(); const n = {...myDraftSlotPicks}; delete n[slotStr]; setMyDraftSlotPicks(n); }}>✕</button>
                      </>
                    ) : prediction ? (
                      // AI prediction (ghost pick) — name, position, owner, reach/value for my slots
                      <>
                        {predReach && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-orange-400">REACH</span>}
                        {predValue && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-green-400">VALUE</span>}
                        <div className="text-center w-full text-gray-400 italic whitespace-normal break-words leading-tight text-[10px]">{prediction.name}</div>
                        <div className={`text-[9px] ${posColor[prediction.position] || "text-gray-500"} opacity-70`}>{prediction.position}</div>
                        <div className="text-[9px] text-gray-500 italic truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || slotStr}</div>
                        {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                      </>
                    ) : (
                      // Empty slot — slot label, owner, tap to set
                      <>
                        <div className="text-gray-600 font-semibold text-[10px]">{pick.slot}</div>
                        <div className="text-[9px] text-gray-600 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || ""}</div>
                        {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                      </>
                    )}

                    {/* Inline player picker for my unfilled slots */}
                    {isEditing && (
                      <div className="absolute top-full left-0 z-50 w-64 bg-gray-900 border border-blue-600 rounded-xl shadow-2xl p-2 mt-1" onClick={(e) => e.stopPropagation()}>
                        <input autoFocus className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1 mb-2 border border-gray-700 focus:outline-none focus:border-blue-500"
                          placeholder="Search rookie…" value={draftSlotSearchQuery} onChange={(e) => setDraftSlotSearchQuery(e.target.value)} />
                        <div className="max-h-44 overflow-y-auto space-y-0.5">
                          {rookies
                            .map((r: any, idx: number) => ({...r, boardRank: idx + 1}))
                            .filter((r: any) => r.name && (!draftSlotSearchQuery || r.name.toLowerCase().includes(draftSlotSearchQuery.toLowerCase())))
                            .filter((r: any) => !draftedPlayerIds.has(String(r.player_id)) && !Object.entries(myDraftSlotPicks).some(([s, pid]) => s !== slotStr && pid === r.player_id))
                            .slice(0, 15)
                            .map((r: any) => {
                              const reachAmt = typeof r.adp === "number" ? Math.round(overallPick - r.adp) : null;
                              return (
                                <button key={`${r.boardRank}-${r.player_id || r.name}`} className="w-full text-left px-2 py-1 rounded hover:bg-gray-800 flex items-center justify-between gap-1"
                                  onClick={() => { setMyDraftSlotPicks(prev => ({...prev, [slotStr]: r.player_id || r.name})); setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}>
                                  <span className="text-white text-[10px] truncate">#{r.boardRank} {r.name}</span>
                                  <span className="flex items-center gap-1 shrink-0">
                                    <span className={`text-[9px] ${posColor[r.position] || "text-gray-400"}`}>{r.position}</span>
                                    {reachAmt !== null && reachAmt < -8 && <span className="text-[8px] text-orange-400 font-bold">REACH</span>}
                                    {reachAmt !== null && reachAmt > 5 && <span className="text-[8px] text-green-400">VALUE</span>}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                        <button className="mt-1 w-full text-[9px] text-gray-600 hover:text-gray-400" onClick={() => { setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}>cancel</button>
                      </div>
                    )}
                  </div>
                );
              });
            })}
          </div>
        </div>
      );
    })()}

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
                key={player.player_id || `${normalizeRookieName(player.name)}-${player.boardRank}`}
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
      <div className="max-w-3xl mx-auto">
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
      <button
        onClick={() => setTradeHubSection("RECOMMENDATIONS")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "RECOMMENDATIONS"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Recommendations
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
      const pickInsight = (pick: any) => selectedLeagueDynamicPickValues[pickKey(pick)];

      const getPickValue = (key: string) => {
        const pick = (allPicks as any[]).find((p: any) => pickKey(p) === key);
        if (!pick) return 0;
        return pickInsight(pick)?.expectedValue ?? getStoredPickValue(pickFcValues, pick);
      };
      const pickLabel = (p: any) => {
        const origOwnerUserId = rosterToUser[p.roster_id];
        const origName = (users as any)[origOwnerUserId] || `Team ${p.roster_id}`;
        const via = p.roster_id !== p.owner_id ? ` (via ${origName})` : "";
        const dynamic = pickInsight(p);
        // For current year, slot is "1.04" format; for future years slot is just the round number
        const slotLabel = p.slot && p.slot.includes(".")
          ? `${p.season} ${p.slot}`
          : `${p.season} Rd ${p.round}`;
        return `${slotLabel}${via}${dynamic ? ` • ${dynamic.label}` : ""}`;
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

      // Asset row component (inline) — playerId optional to enable profile panel
      const assetRow = (label: string, value: number, onAdd: () => void, playerId?: string) => (
        <div
          key={label}
          className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
        >
          <button onClick={onAdd} className="flex-1 text-sm truncate text-left">{label}</button>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-xs text-blue-300 font-mono">{value > 0 ? value.toLocaleString() : "—"}</span>
            {playerId && (
              <button
                onClick={(e) => { e.stopPropagation(); setPlayerProfileId(playerId); }}
                className="text-gray-600 hover:text-blue-400 text-xs transition"
                title="View profile"
              >ⓘ</button>
            )}
          </div>
        </div>
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
                      playerId: p.player_id as string | undefined,
                      onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...myAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                      playerId: undefined as string | undefined,
                      onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })),
                  ].sort((a, b) => b.value - a.value);
                  if (items.length === 0) return <p className="text-xs text-gray-600">No assets available</p>;
                  return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
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
                    }, p.player_id)
                  );
                })() : (() => {
                    const items = [
                      ...filterPlayers(theirAvailPlayers, calcSearchB).map((p: any) => ({
                        label: `${p.full_name} (${p.position} · ${p.team})`,
                        value: calcVal(p.player_id),
                        playerId: p.player_id as string | undefined,
                        onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                      })),
                      ...theirAvailPicks.map((p: any) => ({
                        label: pickLabel(p),
                        value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                        playerId: undefined as string | undefined,
                        onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                      })),
                    ].sort((a, b) => b.value - a.value);
                    if (items.length === 0) return <p className="text-xs text-gray-600">No assets available</p>;
                    return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
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
                      value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
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
                      value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
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
        const isSlotted = p.slot && String(p.slot).includes(".");
        const slotLabel = isSlotted
          ? `${p.season} ${p.slot}`
          : `${p.season} Rd ${p.round}`;
        const expectedSlot = !isSlotted
          ? (selectedLeagueDynamicPickValues[`${p.season}-${p.round}-${p.roster_id}`]?.expectedSlot ?? null)
          : null;
        const expectedSuffix = expectedSlot != null ? ` · Predicted Slot ${expectedSlot}` : "";
        return `${slotLabel}${expectedSuffix}${via}`;
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
      const isBlockedSellDisposition = (playerId?: string | null) =>
        !!playerId && playerDispositions[playerId]?.sell === "Not Willing to Trade";
      const isBlockedBuyDisposition = (playerId?: string | null) =>
        !!playerId && ["Zero Interest", "Skip"].includes(playerDispositions[playerId]?.buy || "");
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
      // Single source of truth: use the fully adjusted profile (dynasty + redraft + sim + age).
      // This is the same profile shown in the League Hub — no divergence possible.
      const finderDirectionProfile = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
      const finderDirection = finderDirectionProfile?.bucket || getLeagueDirectionBucket(dynRank, redRank).bucket;
      const myFinderPlayoffOdds = (finderDirectionProfile as any)?.playoffOdds ??
        (selectedLeagueSimulation?.rowByRosterId?.get(Number(myRoster?.roster_id))?.playoffOdds ?? 0);
      // Below 50% playoff odds = tanking. Filling weak positions wins games you don't want to win —
      // it slides your 1.02 to 1.05 with zero championship upside.
      // iAmTankingFinder ALWAYS overrides the asset-based bucket in all scoring logic.
      const iAmTankingFinder = myFinderPlayoffOdds < 50;
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
      const numTeams = rosters.length;
      const myFinderPicks = (allPicks as any[])
        .filter((p: any) => p.owner_id === myRoster?.roster_id)
        .map((p: any) => ({ ...p, value: getStoredPickValue(pickFcValues, p) }))
        .filter((p: any) => p.value > 0)
        .sort((a: any, b: any) => {
          const yearDiff = (draftYearPriority[a.season] ?? 999) - (draftYearPriority[b.season] ?? 999);
          if (yearDiff !== 0) return yearDiff;
          if (a.round !== b.round) return a.round - b.round;
          return b.value - a.value;
        })
        .slice(0, 6);
      const ageCutoffByPos: Record<string, number> = { QB: 30, RB: 26, WR: 29, TE: 29 };
      const weakPositions = new Set(
        (finderDirectionProfile?.positionRanks || [])
          .filter((entry: any) => entry.rank >= Math.max(4, numTeams - 2))
          .map((entry: any) => entry.pos)
      );
      const strongPositions = new Set(
        (finderDirectionProfile?.positionRanks || [])
          .filter((entry: any) => entry.rank <= Math.max(2, Math.ceil(numTeams / 3)))
          .map((entry: any) => entry.pos)
      );
      const isAgingAsset = (player: any) =>
        Number(player?.age || 0) >= (ageCutoffByPos[player?.position] || 29);
      const isOldProducerBuy = (player: any) => {
        const age = Number(player?.age || 0);
        if (player?.position === "RB") return age >= 25;
        if (player?.position === "QB") return age >= 31;
        if (player?.position === "WR" || player?.position === "TE") return age >= 29;
        return age >= 29;
      };
      const isYoungBuildingBlock = (player: any) =>
        ["QB", "WR"].includes(player?.position) && Number(player?.age || 99) <= 24;
      const isFutureInsulationAsset = (player: any) =>
        (["QB", "WR"].includes(player?.position) && Number(player?.age || 99) <= 25) ||
        (player?.position === "TE" && Number(player?.age || 99) <= 25) ||
        (player?.position === "RB" && Number(player?.age || 99) <= 23);
      const isPremiumCurrentPick = (pick: any) =>
        String(pick?.season) === CURRENT_YEAR && String(pick?.slot || "").match(/^1\.(0[1-6]|[1-6])$/);
      const getDirectionTradeScore = (trade: TradeResult) => {
        const outgoingPlayers = trade.give || [];
        const incomingPlayers = trade.receive || [];
        const outgoingPicks = trade.givePicks || [];
        const incomingPicks = trade.receivePicks || [];
        const outgoingRedraft = outgoingPlayers.reduce((sum: number, p: any) => sum + (redraftValues[p.player_id] || 0), 0);
        const incomingRedraft = incomingPlayers.reduce((sum: number, p: any) => sum + (redraftValues[p.player_id] || 0), 0);
        const outgoingDynasty = outgoingPlayers.reduce((sum: number, p: any) => sum + p.value, 0);
        const incomingDynasty = incomingPlayers.reduce((sum: number, p: any) => sum + p.value, 0);
        const weakPosAdds = incomingPlayers.filter((p: any) => weakPositions.has(p.position)).length;
        const weakPosLosses = outgoingPlayers.filter((p: any) => weakPositions.has(p.position)).length;
        const strongPosSells = outgoingPlayers.filter((p: any) => strongPositions.has(p.position)).length;
        const agingSells = outgoingPlayers.filter((p: any) => isAgingAsset(p)).length;
        const youngCoreBuys = incomingPlayers.filter((p: any) => isYoungBuildingBlock(p)).length;
        const picksIn = incomingPicks.reduce((sum: number, p: any) => sum + p.value, 0);
        const picksOut = outgoingPicks.reduce((sum: number, p: any) => sum + p.value, 0);
        const premiumCurrentPicksOut = outgoingPicks.filter((p: any) => isPremiumCurrentPick(p)).length;
        const futureFirstsIn = incomingPicks.filter((p: any) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
        const oldProducerBuys = incomingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const oldProducerSells = outgoingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const insulationBuys = incomingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const insulationSells = outgoingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const currentPlayerCapitalOut = outgoingPlayers.reduce((sum: number, p: any) => {
          const age = Number(p.age || 0);
          const position = p.position;
          const olderProducer =
            (position === "RB" && age >= 25) ||
            (position === "QB" && age >= 28) ||
            ((position === "WR" || position === "TE") && age >= 27);
          return sum + (olderProducer ? 1 : 0);
        }, 0);
        const assetConsolidation =
          outgoingPlayers.length + outgoingPicks.length - incomingPlayers.length - incomingPicks.length;

        let score = 0;

        // iAmTankingFinder ALWAYS takes priority over the asset-based bucket.
        // A team at 0% playoff odds is NOT a True Contender — buying points is actively harmful
        // regardless of how good the assets look on paper.
        if (iAmTankingFinder) {
          // Tank mode: below 50% playoff odds. Only valid moves are selling floor production,
          // stacking picks, and targeting young upside shots.
          score += oldProducerSells * 10;
          score += agingSells * 8;
          score += insulationBuys * 9;
          score += youngCoreBuys * 8;
          score += futureFirstsIn * 14;
          score += picksIn / 150;
          // Every pick traded away is a lost future draft slot — penalize heavily
          score -= outgoingPicks.length * 10;
          score -= picksOut / 150;
          score -= premiumCurrentPicksOut * 18;
          score -= oldProducerBuys * 18;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 25).length * 8;
          // Counter the posScore reward for filling weak positions — that wins games you don't want
          score -= incomingRedraft / 160;
          score -= weakPosAdds * 10;
          score += strongPosSells * 3;
        } else if (["Elite", "True Contender", "Almost There"].includes(finderDirection)) {
          score += (incomingRedraft - outgoingRedraft) / 160;
          score += weakPosAdds * 8;
          score -= weakPosLosses * 10;
          score += assetConsolidation > 0 ? assetConsolidation * 4 : assetConsolidation * 1.5;
          score += currentPlayerCapitalOut * 3;
          score -= outgoingPicks.length * 3;
          score -= premiumCurrentPicksOut * 10;
          score -= incomingPicks.length * 2;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 28).length * 4;
          // RBs injure most often and are hardest to replace off waivers.
          // Contending teams should value RB depth even when RB is already a "strong" position.
          score += incomingPlayers.filter((p: any) =>
            p.position === "RB" && Number(p.age || 0) >= 22 && Number(p.age || 0) <= 26
          ).length * 4;
        } else if (["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection)) {
          score += agingSells * 9;
          score += oldProducerSells * 8;
          score += youngCoreBuys * 8;
          score += insulationBuys * 10;
          score -= insulationSells * 10;
          score += futureFirstsIn * 12;
          score += picksIn / 180;
          score -= picksOut / 180;
          score -= premiumCurrentPicksOut * 12;
          score -= oldProducerBuys * 18;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 25).length * 7;
          score -= incomingRedraft / 160;
          score += strongPosSells * 3;
        } else {
          // True middle — has a realistic playoff path, balanced approach
          score += weakPosAdds * 6;
          score -= weakPosLosses * 7;
          score += assetConsolidation > 0 ? assetConsolidation * 5 : assetConsolidation * 1.5;
          score += agingSells * 4;
          score += youngCoreBuys * 4;
          score += futureFirstsIn * 6;
          score -= outgoingPicks.length * 4;
          score -= premiumCurrentPicksOut * 9;
          score += currentPlayerCapitalOut * 2;
          score += (incomingDynasty - outgoingDynasty) / 250;
        }

        if (outgoingPicks.length > 0 && currentPlayerCapitalOut === 0 && !iAmTankingFinder) score -= 6;
        if (incomingPicks.length > 0 && outgoingPlayers.length === 0 && !draftCapitalMode && !iAmTankingFinder) score -= 4;
        // Don't penalize draft capital trades for tanking or rebuild teams
        if (trade.draftCapital && !["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection) && !iAmTankingFinder) score -= 3;

        return score;
      };
      const getTradeIntent = (trade: TradeResult) => {
        const outgoingPlayers = trade.give || [];
        const incomingPlayers = trade.receive || [];
        const outgoingPicks = trade.givePicks || [];
        const incomingPicks = trade.receivePicks || [];
        const outgoingOldProducers = outgoingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const incomingOldProducers = incomingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const incomingInsulation = incomingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const outgoingInsulation = outgoingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const weakPosAdds = incomingPlayers.filter((p: any) => weakPositions.has(p.position)).length;
        const strongPosSells = outgoingPlayers.filter((p: any) => strongPositions.has(p.position)).length;
        const futureFirstsIn = incomingPicks.filter((p: any) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
        const playerCountDelta =
          outgoingPlayers.length + outgoingPicks.length - incomingPlayers.length - incomingPicks.length;
        const incomingBest = [...incomingPlayers].sort((a: any, b: any) => b.value - a.value)[0];
        const outgoingBest = [...outgoingPlayers].sort((a: any, b: any) => b.value - a.value)[0];

        if (incomingPicks.length > 0 && incomingPlayers.length === 0) {
          return {
            label: "Pick Accumulation",
            detail: "Turning player value into future insulation and draft capital.",
          };
        }
        if (outgoingPicks.length > 0 && incomingPlayers.length > 0 && weakPosAdds > 0) {
          return {
            label: "Pick-For-Points",
            detail: "Using picks to patch a lineup need with immediate player help.",
          };
        }
        // iAmTankingFinder takes priority — even a "True Contender" bucket team at 0% is a seller
        if (iAmTankingFinder && outgoingOldProducers > 0 && (incomingPicks.length > 0 || incomingInsulation > 0)) {
          return {
            label: "Tank Sell",
            detail: `At ${Math.round(myFinderPlayoffOdds)}% playoff odds, converting floor production into draft capital maximizes future pick position without sacrificing cornerstone pieces.`,
          };
        }
        if (!iAmTankingFinder && ["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection) && outgoingOldProducers > 0 && (futureFirstsIn > 0 || incomingInsulation > 0)) {
          return {
            label: "Rebuild Sell",
            detail: "Selling present points for youth, insulation, or future firsts.",
          };
        }
        if (!iAmTankingFinder && ["Elite", "True Contender", "Almost There"].includes(finderDirection) && incomingOldProducers > 0 && weakPosAdds > 0) {
          return {
            label: "Win-Now Patch",
            detail: "Buying immediate production where your current lineup needs help.",
          };
        }
        if (
          incomingBest &&
          outgoingBest &&
          incomingBest.value > outgoingBest.value &&
          playerCountDelta > 0
        ) {
          return {
            label: "Tier-Up",
            detail: "Condensing depth into one stronger difference-maker.",
          };
        }
        if (incomingInsulation > outgoingInsulation && incomingOldProducers === 0) {
          return {
            label: "Insulation Buy",
            detail: "Shifting value into younger assets that better fit a long-term build.",
          };
        }
        if (strongPosSells > 0 && weakPosAdds > 0) {
          return {
            label: "Strength-For-Need",
            detail: "Using excess at a strong position to solve a weaker room.",
          };
        }
        if (playerCountDelta > 0 && incomingPlayers.length > 0) {
          return {
            label: "Consolidation",
            detail: "Shrinking asset count to clean up your lineup and bench shape.",
          };
        }
        if (playerCountDelta < 0 && incomingPlayers.length > 1) {
          return {
            label: "Depth Split",
            detail: "Breaking one concentrated asset into multiple usable pieces.",
          };
        }
        if (incomingInsulation > 0 && outgoingOldProducers > 0) {
          return {
            label: "Age-Down Bet",
            detail: "Moving from older production into a younger value window.",
          };
        }
        return {
          label: "Value Rebalance",
          detail: "A balanced value move that changes roster shape more than headline value.",
        };
      };
      const failsDirectionGuardrail = (trade: TradeResult) => {
        const outgoingPlayers = trade.give || [];
        const incomingPlayers = trade.receive || [];
        const incomingPicks = trade.receivePicks || [];
        const futureFirstsIn = incomingPicks.filter((p: any) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
        const oldProducerBuys = incomingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const insulationBuys = incomingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const outgoingOldProducers = outgoingPlayers.filter((p: any) => isOldProducerBuy(p)).length;

        // iAmTankingFinder covers ALL seller/rebuild cases regardless of bucket label.
        // A team at 0% playoff odds is a seller even if their assets say "True Contender."
        const isEffectiveSeller = iAmTankingFinder || ["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection);
        const isEffectiveContender = !iAmTankingFinder && ["Elite", "True Contender", "Almost There"].includes(finderDirection);

        if (isEffectiveSeller) {
          // Never load up on aging producers without future compensation
          if (oldProducerBuys > 0 && futureFirstsIn === 0 && insulationBuys === 0 && !trade.receivePicks.length) {
            return true;
          }
          if (
            incomingPlayers.length > 0 &&
            incomingPlayers.every((p: any) => isOldProducerBuy(p)) &&
            futureFirstsIn === 0 &&
            insulationBuys === 0
          ) {
            return true;
          }
          if (oldProducerBuys > outgoingOldProducers && futureFirstsIn === 0 && insulationBuys === 0) {
            return true;
          }
          // Block Pick-For-Points: never give picks to fill lineup holes.
          // Valid pick trades only:
          //   1. Tier-up to a true cornerstone prospect (ALL incoming players are young building blocks)
          //   2. Excess pick relief (8+ picks owned — can't realistically roster them all)
          const outgoingPicksGuard = trade.givePicks || [];
          if (outgoingPicksGuard.length > 0 && incomingPlayers.length > 0) {
            const incomingAllYoung = incomingPlayers.every((p: any) => isFutureInsulationAsset(p));
            const myTotalPickCount = (allPicks as any[]).filter(
              (p: any) => Number(p.owner_id) === Number(myRoster?.roster_id)
            ).length;
            const hasExcessPicks = myTotalPickCount >= 8;
            if (!incomingAllYoung && !hasExcessPicks) return true;
          }
        }

        if (isEffectiveContender) {
          if (incomingPlayers.length === 0 && incomingPicks.length > 0) return true;
        }

        return false;
      };
      // When a player is pinned, ensure they're always in the give pool even if outside top 10
      const myTopBase = myPlayers
        .filter((p: any) => !isBlockedSellDisposition(p.player_id))
        .slice(0, 10);
      const myPinnedPlayer = finderPinnedPlayerId && !isBlockedSellDisposition(finderPinnedPlayerId)
        ? myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId)
        : null;
      const myTop = myPinnedPlayer && !myTopBase.some((p: any) => p.player_id === myPinnedPlayer.player_id)
        ? [...myTopBase.slice(0, 9), myPinnedPlayer].filter(Boolean)
        : myTopBase;
      // When either give or receive player is pinned, relax loop caps so rarer combos surface
      const pinnedActive = !!(finderPinnedPlayerId || finderTargetPlayerId);


      // League-wide positional totals for every team (used for ranking)
      const allTeamPosTotals = rosters.map((r: any) => posTotals(rosterPlayers(r)));

      // Rank user (1 = best) at a given position given their total at that position
      const leagueRank = (pos: string, total: number) => {
        const sorted = allTeamPosTotals.map((t) => t[pos] || 0).sort((a, b) => b - a);
        let rank = 1;
        for (const t of sorted) { if (total >= t) break; rank++; }
        return Math.min(rank, numTeams);
      };

      // Positional fit score using post-trade league rankings.
      // Rewards improving weak positions, penalizes destroying strong ones.
      // Heavy drops now hurt instead of hard-blocking the trade so rebuild paths
      // and value-insulation deals can still surface.
      const posScore = (givePL: any[], receivePL: any[]) => {
        const postT: Record<string, number> = { ...myT };
        givePL.forEach((p: any) => { postT[p.position] = (postT[p.position] || 0) - p.value; });
        receivePL.forEach((p: any) => { postT[p.position] = (postT[p.position] || 0) + p.value; });

        let score = 0;
        for (const pos of ["QB", "RB", "WR", "TE"]) {
          const beforeRank = leagueRank(pos, myT[pos] || 0);
          const afterRank  = leagueRank(pos, postT[pos] || 0);
          const rankDelta  = beforeRank - afterRank; // positive = moved up (improved)

          // Scale reward/penalty by rank change; improving a weak spot is worth more
          const wasWeak = beforeRank > Math.floor(numTeams / 2);
          score += rankDelta * (wasWeak && rankDelta > 0 ? 3 : 2);

          const drop = afterRank - beforeRank;
          if (drop >= 3) score -= drop * 2.5;
          if (afterRank >= Math.max(8, numTeams - 2)) score -= 4;
          if (afterRank === numTeams) score -= 5;
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
        ? myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId && !isBlockedSellDisposition(p.player_id)) ?? null
        : null;

      // Opponent roster(s) for target player search
      const finderOppRostersFiltered = rosters.filter((r: any) =>
        r.owner_id !== user?.user_id &&
        (finderTargetOppRosterId === null || r.roster_id === finderTargetOppRosterId)
      );
      const allOppPlayers = finderOppRostersFiltered.flatMap((r: any) => rosterPlayers(r));
      const targetSearchMatches = finderTargetPlayerSearch.trim().length >= 2
        ? allOppPlayers.filter((p: any) =>
            p.full_name.toLowerCase().includes(finderTargetPlayerSearch.toLowerCase())
          ).slice(0, 6)
        : [];
      const targetPinnedPlayer = finderTargetPlayerId
        ? allOppPlayers.find((p: any) => p.player_id === finderTargetPlayerId) ?? null
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

      const starterSlots = (selectedLeague?.roster_positions || []).filter(
        (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
      );
      const starterCounts = starterSlots.reduce((acc: Record<string, number>, slot: string) => {
        acc[slot] = (acc[slot] || 0) + 1;
        return acc;
      }, {});
      const hasSuperFlex = (starterCounts.SUPER_FLEX || 0) > 0;
      const hasFlex = (starterCounts.FLEX || 0) > 0;
      const rosterById = new Map(
        rosters.map((r: any) => [Number(r.roster_id), r])
      );
      const playerTradeScore = (player: any) =>
        (redraftValues[player?.player_id] ?? 0) * 2 + (player?.value ?? 0);

      const buildPostTradePlayers = (baseRoster: any, givePlayers: any[], receivePlayers: any[]) => {
        const giveIds = new Set(givePlayers.map((p: any) => p.player_id));
        return [
          ...(baseRoster?.players || [])
            .map((id: string) => (players as any)[id])
            .filter((p: any) => p && !giveIds.has(p.player_id)),
          ...receivePlayers,
        ].filter((p: any) => p && ["QB", "RB", "WR", "TE"].includes(p.position));
      };

      const evaluateLineupSafety = (rosterPlayersList: any[], relaxed = false) => {
        const available = [...rosterPlayersList].sort(
          (a: any, b: any) => playerTradeScore(b) - playerTradeScore(a)
        );
        const usedIds = new Set<string>();
        const lineup: Array<{ slot: string; player: any; score: number }> = [];

        const claimBest = (eligiblePositions: string[], slot: string) => {
          const idx = available.findIndex(
            (player: any) =>
              !usedIds.has(player.player_id) &&
              eligiblePositions.includes(player.position)
          );
          if (idx === -1) {
            lineup.push({ slot, player: null, score: 0 });
            return;
          }
          const player = available[idx];
          usedIds.add(player.player_id);
          lineup.push({ slot, player, score: playerTradeScore(player) });
        };

        starterSlots.forEach((slot: string) => {
          if (slot === "FLEX") return claimBest(["RB", "WR", "TE"], slot);
          if (slot === "SUPER_FLEX") return claimBest(["QB", "RB", "WR", "TE"], slot);
          return claimBest([slot], slot);
        });

        const bench = available.filter((player: any) => !usedIds.has(player.player_id));
        const benchCounts = bench.reduce((acc: Record<string, number>, player: any) => {
          acc[player.position] = (acc[player.position] || 0) + 1;
          return acc;
        }, {});

        const emptySlots = lineup.filter((slot) => !slot.player).length;
        const lineupScore = lineup.reduce((sum, slot) => sum + slot.score, 0);
        const reserveFlex = bench.filter((p: any) => ["RB", "WR", "TE"].includes(p.position)).length;
        const reserveQb = benchCounts.QB || 0;
        const reserveTe = benchCounts.TE || 0;
        const reserveRb = benchCounts.RB || 0;
        const reserveWr = benchCounts.WR || 0;
        const reserveTotal = bench.length;

        const minReserveQb = hasSuperFlex ? (relaxed ? 0 : 1) : starterCounts.QB ? (relaxed ? 0 : 1) : 0;
        const minReserveTe = starterCounts.TE ? (relaxed ? 0 : 1) : 0;
        const minReserveFlex = hasFlex || hasSuperFlex ? (relaxed ? 1 : 2) : (relaxed ? 0 : 1);
        const minReserveRb = starterCounts.RB >= 2 ? (relaxed ? 0 : 1) : 0;
        const minReserveWr = starterCounts.WR >= 2 ? (relaxed ? 0 : 1) : 0;
        const minReserveTotal = relaxed ? 2 : 4;

        const shortages = [
          emptySlots > 0 ? `empty-${emptySlots}` : null,
          reserveQb < minReserveQb ? "qb" : null,
          reserveTe < minReserveTe ? "te" : null,
          reserveFlex < minReserveFlex ? "flex" : null,
          reserveRb < minReserveRb ? "rb" : null,
          reserveWr < minReserveWr ? "wr" : null,
          reserveTotal < minReserveTotal ? "total" : null,
        ].filter(Boolean);

        return {
          valid: emptySlots === 0,
          shortages,
          emptySlots,
          lineupScore,
          reserveQb,
          reserveTe,
          reserveFlex,
          reserveRb,
          reserveWr,
          reserveTotal,
        };
      };

      const getTradeLineupSafety = (trade: TradeResult) => {
        const myAfterPlayers = buildPostTradePlayers(myRoster, trade.give, trade.receive);
        const oppRoster = rosterById.get(Number(trade.oppRosterId));
        const oppBeforePlayers = rosterPlayers(oppRoster);
        const oppAfterPlayers = buildPostTradePlayers(oppRoster, trade.receive, trade.give);
        const myBefore = evaluateLineupSafety(myPlayers, false);
        const myAfter = evaluateLineupSafety(myAfterPlayers, false);
        const oppBefore = evaluateLineupSafety(oppBeforePlayers, true);
        const oppAfter = evaluateLineupSafety(oppAfterPlayers, true);
        const myShortagePenalty =
          myAfter.emptySlots * 14 +
          Math.max(0, (starterCounts.QB || 0 ? 1 : 0) - myAfter.reserveQb) * (hasSuperFlex ? 7 : 4) +
          Math.max(0, (starterCounts.TE || 0 ? 1 : 0) - myAfter.reserveTe) * 3 +
          Math.max(0, (hasFlex || hasSuperFlex ? 1 : 0) - myAfter.reserveFlex) * 2.5 +
          Math.max(0, 2 - myAfter.reserveTotal) * 2;
        const oppShortagePenalty =
          oppAfter.emptySlots * 10 +
          Math.max(0, (starterCounts.QB || 0 ? 1 : 0) - oppAfter.reserveQb) * (hasSuperFlex ? 5 : 3) +
          Math.max(0, (starterCounts.TE || 0 ? 1 : 0) - oppAfter.reserveTe) * 2 +
          Math.max(0, (hasFlex || hasSuperFlex ? 1 : 0) - oppAfter.reserveFlex) * 1.5;

        const myDelta =
          (myAfter.lineupScore - myBefore.lineupScore) / 150 +
          (myAfter.reserveFlex - myBefore.reserveFlex) * 2 +
          (myAfter.reserveQb - myBefore.reserveQb) * (hasSuperFlex ? 3 : 1.5) +
          (myAfter.reserveTotal - myBefore.reserveTotal) * 1.25;
        const oppDelta =
          (oppAfter.lineupScore - oppBefore.lineupScore) / 175 +
          (oppAfter.reserveFlex - oppBefore.reserveFlex) * 1.5 +
          (oppAfter.reserveQb - oppBefore.reserveQb) * (hasSuperFlex ? 2 : 1) +
          (oppAfter.reserveTotal - oppBefore.reserveTotal);

        const contenderBuckets = new Set(["Elite", "True Contender", "Almost There", "Fading Contender"]);
        const isContenderish = contenderBuckets.has(finderDirection);
        const reserveTotalDrop = myBefore.reserveTotal - myAfter.reserveTotal;
        const reserveFlexDrop = myBefore.reserveFlex - myAfter.reserveFlex;
        const reserveQbDrop = myBefore.reserveQb - myAfter.reserveQb;
        const reserveTeDrop = myBefore.reserveTe - myAfter.reserveTe;
        const severeDepthLoss =
          reserveTotalDrop >= 2 ||
          reserveFlexDrop >= 2 ||
          (hasSuperFlex && reserveQbDrop >= 1) ||
          (!hasSuperFlex && starterCounts.QB > 0 && myAfter.reserveQb < 1 && myBefore.reserveQb >= 1) ||
          (starterCounts.TE > 0 && myAfter.reserveTe < 1 && myBefore.reserveTe >= 1);
        const thinBenchForContender =
          isContenderish && (
            myAfter.reserveTotal < Math.max(4, Math.min(myBefore.reserveTotal, 5)) ||
            myAfter.reserveFlex < (hasFlex || hasSuperFlex ? Math.max(2, Math.min(myBefore.reserveFlex, 3)) : 1) ||
            (starterCounts.QB > 0 && myAfter.reserveQb < 1 && myBefore.reserveQb >= 1) ||
            (starterCounts.TE > 0 && myAfter.reserveTe < 1 && myBefore.reserveTe >= 1)
          );
        const lineupGain = myAfter.lineupScore - myBefore.lineupScore;
        const depthCollapsePenalty =
          Math.max(0, reserveTotalDrop) * 3.5 +
          Math.max(0, reserveFlexDrop) * 4 +
          Math.max(0, reserveQbDrop) * (hasSuperFlex ? 6 : 3) +
          Math.max(0, reserveTeDrop) * 2.5;
        const blocksForDepth =
          (isContenderish && severeDepthLoss && lineupGain < 90) ||
          thinBenchForContender;

        return {
          myBefore,
          myAfter,
          oppBefore,
          oppAfter,
          myValid: myAfter.valid,
          oppValid: oppAfter.valid,
          valid: myAfter.emptySlots === 0 && oppAfter.emptySlots === 0 && !blocksForDepth,
          blocksForDepth,
          reserveTotalDrop,
          reserveFlexDrop,
          reserveQbDrop,
          reserveTeDrop,
          score: myDelta + oppDelta * 0.7 - myShortagePenalty - oppShortagePenalty * 0.7 - depthCollapsePenalty,
        };
      };

      const results: TradeResult[] = [];

      for (const oppRoster of rosters.filter((r: any) => r.owner_id !== user?.user_id && (finderTargetOppRosterId === null || r.roster_id === finderTargetOppRosterId))) {
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

        // Ensure target player (if on this roster) is always in the pool even if ranked 11+
        // Also exclude "Zero Interest" buy-disposition players unless explicitly targeted
        const oppTopBase = oppPlayers
          .filter((p: any) => !isBlockedBuyDisposition(p.player_id))
          .slice(0, 10);
        const targetPinnedOppPlayer = finderTargetPlayerId && !isBlockedBuyDisposition(finderTargetPlayerId)
          ? oppPlayers.find((p: any) => p.player_id === finderTargetPlayerId)
          : null;
        const oppTop = targetPinnedOppPlayer && !oppTopBase.some((p: any) => p.player_id === targetPinnedOppPlayer.player_id)
          ? [...oppTopBase.slice(0, 9), targetPinnedOppPlayer].filter(Boolean)
          : oppTopBase;
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

        const myCap = (base: number) => pinnedActive ? myTop.length : Math.min(myTop.length, base);
        const oppCap = (base: number) => pinnedActive ? oppTop.length : Math.min(oppTop.length, base);

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
          for (let i = 0; i < oppCap(9); i++) {
            for (let j = i + 1; j < oppCap(9); j++) {
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
                net: op1.value + op2.value - mp.value - adj, format: "1 for 2",
              });
            }
          }
        }

        // 1v3
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(8); i++) {
            for (let j = i + 1; j < oppCap(8); j++) {
              for (let k = j + 1; k < oppCap(8); k++) {
                const op1 = oppTop[i], op2 = oppTop[j], op3 = oppTop[k];
                if (!isBalanced([mp.value], [op1.value, op2.value, op3.value])) continue;
                if (!packageOk([op1, op2, op3])) continue;
                if (!qbSafe([mp])) continue;
                if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                if (!oppReceiveOk(oppPlayers, [mp], [op1, op2, op3])) continue;
                const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value, op3.value]);
                results.push({
                  give: [mp], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp], [op1, op2, op3]),
                  net: op1.value + op2.value + op3.value - mp.value - adj, format: "1 for 3",
                });
              }
            }
          }
        }

        // 1v4
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(7); i++) {
            for (let j = i + 1; j < oppCap(7); j++) {
              for (let k = j + 1; k < oppCap(7); k++) {
                for (let l = k + 1; l < oppCap(7); l++) {
                  const op1 = oppTop[i], op2 = oppTop[j], op3 = oppTop[k], op4 = oppTop[l];
                  if (!isBalanced([mp.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                  if (!packageOk([op1, op2, op3, op4])) continue;
                  if (!qbSafe([mp])) continue;
                  if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                  if (!oppReceiveOk(oppPlayers, [mp], [op1, op2, op3, op4])) continue;
                  const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value, op3.value, op4.value]);
                  results.push({
                    give: [mp], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                    score: posScore([mp], [op1, op2, op3, op4]),
                    net: op1.value + op2.value + op3.value + op4.value - mp.value - adj, format: "1 for 4",
                  });
                }
              }
            }
          }
        }

        // 2v1
        for (let i = 0; i < myCap(9); i++) {
          for (let j = i + 1; j < myCap(9); j++) {
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
        for (let i = 0; i < myCap(8); i++) {
          for (let j = i + 1; j < myCap(8); j++) {
            for (let k = 0; k < oppCap(8); k++) {
              for (let l = k + 1; l < oppCap(8); l++) {
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
        for (let i = 0; i < myCap(7); i++) {
          for (let j = i + 1; j < myCap(7); j++) {
            for (let k = 0; k < oppCap(7); k++) {
              for (let l = k + 1; l < oppCap(7); l++) {
                for (let m = l + 1; m < oppCap(7); m++) {
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
                    net: op1.value + op2.value + op3.value - mp1.value - mp2.value - adj, format: "2 for 3",
                  });
                }
              }
            }
          }
        }

        // 2v4
        for (let i = 0; i < myCap(7); i++) {
          for (let j = i + 1; j < myCap(7); j++) {
            for (let k = 0; k < oppCap(7); k++) {
              for (let l = k + 1; l < oppCap(7); l++) {
                for (let m = l + 1; m < oppCap(7); m++) {
                  for (let n = m + 1; n < oppCap(7); n++) {
                    const mp1 = myTop[i], mp2 = myTop[j];
                    const op1 = oppTop[k], op2 = oppTop[l], op3 = oppTop[m], op4 = oppTop[n];
                    if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                    if (!packageOk([mp1, mp2])) continue;
                    if (!packageOk([op1, op2, op3, op4])) continue;
                    if (!qbSafe([mp1, mp2])) continue;
                    if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                    if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2, op3, op4])) continue;
                    const adj = tradeWaiverAdj([mp1.value, mp2.value], [op1.value, op2.value, op3.value, op4.value]);
                    results.push({
                      give: [mp1, mp2], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                      score: posScore([mp1, mp2], [op1, op2, op3, op4]),
                      net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - adj, format: "2 for 4",
                    });
                  }
                }
              }
            }
          }
        }

        // 3v3
        for (let i = 0; i < myCap(7); i++) {
          for (let j = i + 1; j < myCap(7); j++) {
            for (let k = j + 1; k < myCap(7); k++) {
              const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k];
              if (!packageOk([mp1, mp2, mp3])) continue;
              if (!qbSafe([mp1, mp2, mp3])) continue;
              for (let a = 0; a < oppCap(7); a++) {
                for (let b = a + 1; b < oppCap(7); b++) {
                  for (let c = b + 1; c < oppCap(7); c++) {
                    const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c];
                    if (!isBalanced([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value])) continue;
                    if (!packageOk([op1, op2, op3])) continue;
                    if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                    if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3], [op1, op2, op3])) continue;
                    results.push({
                      give: [mp1, mp2, mp3], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                      score: posScore([mp1, mp2, mp3], [op1, op2, op3]),
                      net: op1.value + op2.value + op3.value - mp1.value - mp2.value - mp3.value, format: "3 for 3",
                    });
                  }
                }
              }
            }
          }
        }

        // 3v4
        for (let i = 0; i < myCap(6); i++) {
          for (let j = i + 1; j < myCap(6); j++) {
            for (let k = j + 1; k < myCap(6); k++) {
              const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k];
              if (!packageOk([mp1, mp2, mp3])) continue;
              if (!qbSafe([mp1, mp2, mp3])) continue;
              for (let a = 0; a < oppCap(6); a++) {
                for (let b = a + 1; b < oppCap(6); b++) {
                  for (let c = b + 1; c < oppCap(6); c++) {
                    for (let d = c + 1; d < oppCap(6); d++) {
                      const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c], op4 = oppTop[d];
                      if (!isBalanced([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                      if (!packageOk([op1, op2, op3, op4])) continue;
                      if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                      if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3], [op1, op2, op3, op4])) continue;
                      const adj = tradeWaiverAdj([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value, op4.value]);
                      results.push({
                        give: [mp1, mp2, mp3], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                        score: posScore([mp1, mp2, mp3], [op1, op2, op3, op4]),
                        net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - mp3.value - adj, format: "3 for 4",
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // 4v4
        for (let i = 0; i < myCap(6); i++) {
          for (let j = i + 1; j < myCap(6); j++) {
            for (let k = j + 1; k < myCap(6); k++) {
              for (let l = k + 1; l < myCap(6); l++) {
                const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k], mp4 = myTop[l];
                if (!packageOk([mp1, mp2, mp3, mp4])) continue;
                if (!qbSafe([mp1, mp2, mp3, mp4])) continue;
                for (let a = 0; a < oppCap(6); a++) {
                  for (let b = a + 1; b < oppCap(6); b++) {
                    for (let c = b + 1; c < oppCap(6); c++) {
                      for (let d = c + 1; d < oppCap(6); d++) {
                        const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c], op4 = oppTop[d];
                        if (!isBalanced([mp1.value, mp2.value, mp3.value, mp4.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                        if (!packageOk([op1, op2, op3, op4])) continue;
                        if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                        if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3, mp4], [op1, op2, op3, op4])) continue;
                        results.push({
                          give: [mp1, mp2, mp3, mp4], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                          score: posScore([mp1, mp2, mp3, mp4], [op1, op2, op3, op4]),
                          net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - mp3.value - mp4.value, format: "4 for 4",
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }

        const myEqualizerPicks = myFinderPicks.slice(0, 4);
        const oppEqualizerPicks = oppPicks.slice(0, 4);

        // 1 + your pick for 1
        for (const mp of myTop) {
          for (const myPick of myEqualizerPicks) {
            for (const op of oppTop) {
              if (!isBalanced([mp.value, myPick.value], [op.value])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
              const adj = tradeWaiverAdj([mp.value, myPick.value], [op.value]);
              results.push({
                give: [mp], receive: [op], givePicks: [myPick], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op]),
                net: op.value + adj - mp.value - myPick.value, format: "1 + pick for 1",
              });
            }
          }
        }

        // 2 + your pick for 1
        for (let i = 0; i < Math.min(myTop.length, 7); i++) {
          for (let j = i + 1; j < Math.min(myTop.length, 7); j++) {
            const mp1 = myTop[i], mp2 = myTop[j];
            if (!packageOk([mp1, mp2])) continue;
            if (!qbSafe([mp1, mp2])) continue;
            for (const myPick of myEqualizerPicks) {
              for (const op of oppTop) {
                if (!isBalanced([mp1.value, mp2.value, myPick.value], [op.value])) continue;
                if (!oppQbSafe(oppPlayers, [op])) continue;
                if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op])) continue;
                const adj = tradeWaiverAdj([mp1.value, mp2.value, myPick.value], [op.value]);
                results.push({
                  give: [mp1, mp2], receive: [op], givePicks: [myPick], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp1, mp2], [op]),
                  net: op.value + adj - mp1.value - mp2.value - myPick.value, format: "2 + pick for 1",
                });
              }
            }
          }
        }

        // 1 for 1 + their pick
        for (const mp of myTop) {
          for (const op of oppTop) {
            for (const oppPick of oppEqualizerPicks) {
              if (!isBalanced([mp.value], [op.value, oppPick.value])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
              const adj = tradeWaiverAdj([mp.value], [op.value, oppPick.value]);
              results.push({
                give: [mp], receive: [op], givePicks: [], receivePicks: [oppPick], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op]),
                net: op.value + oppPick.value - mp.value - adj, format: "1 for 1 + pick",
              });
            }
          }
        }

        // 1 for 2 + their pick
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(8); i++) {
            for (let j = i + 1; j < oppCap(8); j++) {
              const op1 = oppTop[i], op2 = oppTop[j];
              if (!packageOk([op1, op2])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op1, op2])) continue;
              for (const oppPick of oppEqualizerPicks) {
                if (!isBalanced([mp.value], [op1.value, op2.value, oppPick.value])) continue;
                const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value, oppPick.value]);
                results.push({
                  give: [mp], receive: [op1, op2], givePicks: [], receivePicks: [oppPick], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp], [op1, op2]),
                  net: op1.value + op2.value + oppPick.value - mp.value - adj, format: "1 for 2 + pick",
                });
              }
            }
          }
        }

        // ── Lottery ticket trades for this opponent ───────────────────────────
        // Any player outside the top ~150 dynasty value (< 700) who is young enough
        // to have breakout upside, traded for one of my 3rd+ round picks.
        // Disposition guards: skip "Zero Interest" receives and "Not Willing to Trade" gives.
        const FINDER_LOTTERY_CEILING = 700;
        const myLotteryFinderPicks = myFinderPicks.filter((p: any) =>
          Number(p.round) >= 3
        );
        const oppLotteryPlayers = oppPlayers.filter((p: any) => {
          if (isBlockedBuyDisposition(p.player_id)) return false;
          const age = Number(p.age || 99);
          const val = Number(p.value || 0);
          if (val < 60 || val >= FINDER_LOTTERY_CEILING) return false;
          if (p.position === "RB" && age > 23) return false;
          if (p.position === "QB" && age > 26) return false;
          if (["WR", "TE"].includes(p.position) && age > 27) return false;
          return true;
        });
        for (const lp of oppLotteryPlayers) {
          for (const myPick of myLotteryFinderPicks) {
            if (playerDispositions[myPick.player_id]?.sell === "Not Willing to Trade") continue;
            const ratio = lp.value / Math.max(myPick.value, 1);
            if (ratio < 0.25 || ratio > 2.0) continue;
            results.push({
              give: [], receive: [lp], givePicks: [myPick], receivePicks: [],
              oppName, oppRosterId: oppRoster.roster_id,
              score: posScore([], [lp]) * 0.6, // softer posScore weight for lottery
              net: lp.value - myPick.value,
              format: "Lottery",
            });
          }
        }
      }

      const getSortedIds = (items: any[], getId: (item: any) => string) =>
        items.map(getId).filter(Boolean).sort();
      const sameIds = (a: string[], b: string[]) =>
        a.length === b.length && a.every((id, index) => id === b[index]);
      const overlapRatio = (a: string[], b: string[]) => {
        if (!a.length || !b.length) return 0;
        const bSet = new Set(b);
        const overlap = a.filter((id) => bSet.has(id)).length;
        return overlap / Math.min(a.length, b.length);
      };
      const getTradeSimilarityProfile = (trade: any) => {
        const givePlayers = getSortedIds(trade.give, (p: any) => String(p.player_id));
        const receivePlayers = getSortedIds(trade.receive, (p: any) => String(p.player_id));
        const givePicks = getSortedIds(trade.givePicks, (p: any) => finderPickKey(p));
        const receivePicks = getSortedIds(trade.receivePicks, (p: any) => finderPickKey(p));
        return {
          givePlayers,
          receivePlayers,
          givePicks,
          receivePicks,
          allAssets: [
            ...givePlayers.map((id) => `give-player-${id}`),
            ...receivePlayers.map((id) => `receive-player-${id}`),
            ...givePicks.map((id) => `give-pick-${id}`),
            ...receivePicks.map((id) => `receive-pick-${id}`),
          ].sort(),
        };
      };
      const areTradesTooSimilar = (a: any, b: any) => {
        if (String(a.oppRosterId) !== String(b.oppRosterId)) return false;

        const aProfile = getTradeSimilarityProfile(a);
        const bProfile = getTradeSimilarityProfile(b);
        const sameFormat = a.format === b.format;
        const sameReceivePlayers = sameIds(aProfile.receivePlayers, bProfile.receivePlayers);
        const sameGivePlayers = sameIds(aProfile.givePlayers, bProfile.givePlayers);
        const sameReceivePackage = sameReceivePlayers && sameIds(aProfile.receivePicks, bProfile.receivePicks);
        const sameGivePackage = sameGivePlayers && sameIds(aProfile.givePicks, bProfile.givePicks);
        const givePlayerOverlap = overlapRatio(aProfile.givePlayers, bProfile.givePlayers);
        const receivePlayerOverlap = overlapRatio(aProfile.receivePlayers, bProfile.receivePlayers);
        const fullAssetOverlap = overlapRatio(aProfile.allAssets, bProfile.allAssets);

        if (sameFormat && sameReceivePlayers && givePlayerOverlap >= 0.5) return true;
        if (sameFormat && sameGivePlayers && receivePlayerOverlap >= 0.5) return true;
        if (sameFormat && sameReceivePackage && givePlayerOverlap >= 0.5) return true;
        if (sameFormat && sameGivePackage && receivePlayerOverlap >= 0.5) return true;
        if (sameFormat && fullAssetOverlap >= 0.75) return true;
        return false;
      };

      // Deduplicate by player set, filter near-duplicate frameworks, enforce per-player and per-opponent appearance caps, take 15
      const seen = new Set<string>();
      const playerCount: Record<string, number> = {};
      const oppCount: Record<string, number> = {};
      // Seeded shuffle so Refresh button produces a new random set
      const shuffled = results
        .filter((r) => isFinite(r.score))
        .filter((r) => !r.give.some((p: any) => isBlockedSellDisposition(p.player_id)))
        .filter((r) => !r.receive.some((p: any) => isBlockedBuyDisposition(p.player_id)))
        .filter((r) => !pinnedPlayer || r.give.some((p: any) => p.player_id === pinnedPlayer.player_id))
        .filter((r) => !finderTargetPlayerId || r.receive.some((p: any) => p.player_id === finderTargetPlayerId))
        .filter((r) => !failsDirectionGuardrail(r))
        .map((r) => {
          const lineupSafety = getTradeLineupSafety(r);
          const partnerProfile = leagueMateProfileByRosterId.get(Number(r.oppRosterId));
          const bucketPriority = draftCapitalMode && r.receivePicks.length > 0
            ? Math.min(...r.receivePicks.map((p: any) => draftYearPriority[p.season] ?? 999))
            : 999;
          const partnerFitScore =
            (partnerProfile?.fitScore ?? 0) * 0.65 +
            Math.min(partnerProfile?.tradeCount30d ?? 0, 3) * 1.5 +
            Math.min(partnerProfile?.totalDynastyLeagues ?? 0, 8) * 0.35;
          // Disposition scoring: combines deal-probability weighting with direction-aware bonuses/penalties.
          // Example: "Will Trade but Higher than Market" (sell high) in give side + value-negative trade
          // gets a heavy penalty — the user wants a premium, not a discount.
          // "Buy Low" in receive side + value-negative trade = overpaying for something they wanted cheap.
          const sellScoreMap: Record<string, number> = {
            "Trade at All Costs": 4, "Lower than Market": 2, "Neutral": 1,
            "Will Trade but Higher than Market": -1,
          };
          const buyScoreMap: Record<string, number> = {
            "Buy Over Market": 4, "Buy at Market": 2, "Neutral": 1, "Buy Low": -1,
          };
          const dispositionScore = (() => {
            let ds = 0;
            // Base probability scores
            ds += r.give.reduce((s: number, gp: any) =>
              s + (sellScoreMap[playerDispositions[gp.player_id]?.sell ?? "Neutral"] ?? 0), 0);
            ds += r.receive.reduce((s: number, rp: any) =>
              s + (buyScoreMap[playerDispositions[rp.player_id]?.buy ?? "Neutral"] ?? 0), 0);
            // Direction-aware: disposition tags also mean "only do this deal in the RIGHT direction"
            // "Sell High" given away at a loss contradicts the tag — penalize hard
            const sellHighGiven = r.give.filter((gp: any) =>
              playerDispositions[gp.player_id]?.sell === "Will Trade but Higher than Market"
            ).length;
            if (sellHighGiven > 0 && r.net < -150) ds -= sellHighGiven * 8; // losing value, bad
            if (sellHighGiven > 0 && r.net >= 0)   ds += sellHighGiven * 4;  // gaining value, good
            // "Buy Low" received while overpaying contradicts the tag — penalize hard
            const buyLowReceived = r.receive.filter((rp: any) =>
              playerDispositions[rp.player_id]?.buy === "Buy Low"
            ).length;
            if (buyLowReceived > 0 && r.net < -150) ds -= buyLowReceived * 8; // overpaying, bad
            if (buyLowReceived > 0 && r.net >= 0)   ds += buyLowReceived * 5;  // getting them cheap, perfect
            return ds;
          })();
          const strategyScore = r.score + getDirectionTradeScore(r) + lineupSafety.score + partnerFitScore + dispositionScore;
          return {
            r,
            lineupSafety,
            partnerProfile,
            bucketPriority,
            strategyScore,
            sort: Math.abs(Math.sin(finderSeed * (results.indexOf(r) + 1)) * 10000) % 1,
          };
        })
        .filter(({ lineupSafety }) => lineupSafety.valid)
        .sort((a, b) => {
          if (a.bucketPriority !== b.bucketPriority) return a.bucketPriority - b.bucketPriority;
          if (b.strategyScore !== a.strategyScore) return b.strategyScore - a.strategyScore;
          return a.sort - b.sort;
        })
        .map(({ r }) => r);
      const top15 = shuffled.reduce((acc: any[], r) => {
          const allIds = [
            ...r.give.map((p: any) => `player-${p.player_id}`),
            ...r.receive.map((p: any) => `player-${p.player_id}`),
            ...r.givePicks.map((p: any) => `pick-${finderPickKey(p)}`),
            ...r.receivePicks.map((p: any) => `pick-${finderPickKey(p)}`),
          ];
          const key = [...allIds].sort().join(",");
          if (seen.has(key)) return acc;
          if (acc.some((existing: any) => areTradesTooSimilar(existing, r))) return acc;
          // Each player may appear in at most 4 shown trades (pinned player is exempt)
          if (allIds.some((pid) => pid !== `player-${finderPinnedPlayerId}` && (playerCount[pid] || 0) >= 4)) return acc;
          // Each opponent may appear in at most 4 shown trades
          const oppKey = String(r.oppRosterId);
          if ((oppCount[oppKey] || 0) >= 4) return acc;
          seen.add(key);
          allIds.forEach((pid) => { playerCount[pid] = (playerCount[pid] || 0) + 1; });
          oppCount[oppKey] = (oppCount[oppKey] || 0) + 1;
          acc.push(r);
          return acc.length >= 15 ? acc : acc;
        }, [])
        .slice(0, 15);

      return (
        <div className="space-y-4">
          {/* ── Player pin search ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
            {finderDirectionProfile && (
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Direction Engine</div>
                    <div className="mt-1 text-sm text-gray-200">{finderDirectionProfile.summary}</div>
                  </div>
                  <span className={`inline-flex text-[10px] font-semibold px-2 py-1 rounded-full border self-start ${finderDirectionProfile.bucketColor}`}>
                    {finderDirectionProfile.bucket}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {finderDirectionProfile.actions.map((action: string) => (
                    <span key={action} className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-1 text-[11px] text-blue-200">
                      {action}
                    </span>
                  ))}
                </div>
                {selectedLeagueMateProfilesView.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Best Partner Targets</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedLeagueMateProfilesView.slice(0, 3).map((mate: any) => (
                        <button
                          key={mate.rosterId}
                          onClick={() => setFinderTargetOppRosterId(Number(mate.rosterId))}
                          className="rounded-full border border-cyan-800 bg-cyan-950/30 px-3 py-1 text-[11px] text-cyan-200 transition hover:border-cyan-500"
                        >
                          {mate.ownerName} • {mate.fitLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Find trades involving a specific player</p>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/70 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-white">Draft Capital Mode</div>
                <div className="text-[11px] text-gray-400">
                  Current direction: <span className="text-gray-300">{finderDirection}</span>. {finderDirectionProfile?.shortAction || "When on, Finder can turn roster talent into picks while still respecting opponent fit rules."}
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

            {/* ── Owner filter dropdown ── */}
            <select
              value={finderTargetOppRosterId ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setFinderTargetOppRosterId(val);
                setFinderTargetPlayerId(null);
                setFinderTargetPlayerSearch("");
                setFinderSeed(Math.random());
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Trade with any owner…</option>
              {rosters
                .filter((r: any) => r.owner_id !== user?.user_id)
                .slice()
                .sort((a: any, b: any) =>
                  ((users as any)[a.owner_id] || "").localeCompare((users as any)[b.owner_id] || "")
                )
                .map((r: any) => (
                  <option key={r.roster_id} value={r.roster_id}>
                    {(users as any)[r.owner_id] || `Team ${r.roster_id}`}
                  </option>
                ))}
            </select>

            {/* ── Target player (want to receive) search ── */}
            {targetPinnedPlayer ? (
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Want to receive</span>
                  <span className="text-sm text-white font-medium">{targetPinnedPlayer.full_name}</span>
                  <span className="text-[10px] text-gray-500 uppercase">{targetPinnedPlayer.position}</span>
                  <span className="text-xs text-gray-500 font-mono">{targetPinnedPlayer.value.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => { setFinderTargetPlayerId(null); setFinderTargetPlayerSearch(""); setFinderSeed(Math.random()); }}
                  className="text-xs text-gray-500 hover:text-red-400 transition ml-3"
                >
                  ✕ Clear
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={finderTargetPlayerSearch}
                  onChange={(e) => { setFinderTargetPlayerSearch(e.target.value); setFinderTargetPlayerId(null); }}
                  placeholder={finderTargetOppRosterId ? "Search their roster for a player to receive…" : "Search league for a player you want to receive…"}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                {targetSearchMatches.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                    {targetSearchMatches.map((p: any) => (
                      <button
                        key={p.player_id}
                        onClick={() => { setFinderTargetPlayerId(p.player_id); setFinderTargetPlayerSearch(""); setFinderSeed(Math.random()); }}
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
            const partnerProfile = leagueMateProfileByRosterId.get(Number(trade.oppRosterId));
            const tradeIntent = getTradeIntent(trade);
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
                    <span className="rounded-full border border-violet-800 bg-violet-950/30 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                      {tradeIntent.label}
                    </span>
                    {partnerProfile?.fitLabel && (
                      <span className="rounded-full border border-cyan-800 bg-cyan-950/30 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                        {partnerProfile.fitLabel}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isEven ? "bg-yellow-900 text-yellow-300" : trade.net > 0 ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                    {isEven ? "EVEN" : trade.net > 0 ? `+${netDisplay.toLocaleString()}` : `-${netDisplay.toLocaleString()}`}
                  </span>
                </div>
                {partnerProfile?.fitReasons?.[0] && (
                  <div className="mb-3 text-xs text-gray-500">
                    {tradeIntent.detail} {partnerProfile.fitReasons[0] ? `• ${partnerProfile.fitReasons[0]}` : ""}
                  </div>
                )}
                {!partnerProfile?.fitReasons?.[0] && (
                  <div className="mb-3 text-xs text-gray-500">
                    {tradeIntent.detail}
                  </div>
                )}
                {(partnerProfile?.repeatedPlayers?.length > 0 || partnerProfile?.acquiredPlayers?.length > 0 || partnerProfile?.tradePreferenceLabel) && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {partnerProfile?.tradePreferenceLabel && (
                      <span className="rounded-full border border-amber-800 bg-amber-950/20 px-2 py-0.5 text-[10px] text-amber-200">
                        {partnerProfile.tradePreferenceLabel}
                      </span>
                    )}
                    {partnerProfile.repeatedPlayers.slice(0, 2).map((player: any) => (
                      <span key={player.playerId} className="rounded-full border border-cyan-800 bg-cyan-950/30 px-2 py-0.5 text-[10px] text-cyan-200">
                        Likes {player.name}
                      </span>
                    ))}
                    {partnerProfile?.acquiredPlayers?.slice(0, 1).map((player: any) => (
                      <span key={`recent-${player.playerId}`} className="rounded-full border border-emerald-800 bg-emerald-950/30 px-2 py-0.5 text-[10px] text-emerald-200">
                        Recently Bought {player.name}
                      </span>
                    ))}
                  </div>
                )}
                {/* Trade columns */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Give</div>
                    <div className="space-y-1">
                      {trade.give.map((p: any) => (
                        <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button onClick={() => setPlayerProfileId(p.player_id)} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
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
                            <button onClick={() => setPlayerProfileId(p.player_id)} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
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

    {tradeHubSection === "RECOMMENDATIONS" && (() => {
      if (!selectedLeague) return (
        <p className="text-gray-400 text-sm">Select a league from the dropdown above to view recommendations.</p>
      );
      if (tradeRecommendationCards.length === 0) return (
        <p className="text-gray-400 text-sm">Recommendations are still building. Load a league and values first, then come back here.</p>
      );

      const renderAsset = (asset: any) => {
        if (!asset) return null;
        if ("expectedValue" in asset && asset.season) {
          const isSlotted = asset.slot && String(asset.slot).includes(".");
          const pickTitle = isSlotted
            ? `${asset.season} ${asset.slot}`
            : `${asset.season} Rd ${asset.round}${asset.expectedSlot != null ? ` · Predicted Slot ${asset.expectedSlot}` : ""}`;
          return (
            <div key={`${asset.season}-${asset.round}-${asset.roster_id}`} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-white">{pickTitle}</div>
                <div className="text-[11px] text-gray-500">{asset.label}</div>
              </div>
              <div className="text-xs font-mono text-blue-300">{asset.expectedValue.toLocaleString()}</div>
            </div>
          );
        }
        return (
          <div key={asset.player_id} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{asset.full_name}</div>
              <div className="text-[11px] text-gray-500">{asset.position} • {asset.team || "FA"}</div>
            </div>
            <div className="text-xs font-mono text-gray-300">{(asset.dynValue ?? asset.value ?? 0).toLocaleString()}</div>
          </div>
        );
      };

      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Advanced Trade Recommendations</div>
            <div className="mt-1 text-sm text-gray-200">
              These recommendations now stack partner ranking, simulated team outlook, and pick-value distributions into concrete trade paths and opening angles.
            </div>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Partner Board</div>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {tradePartnerRankings.slice(0, 6).map((partner: any) => (
                <div key={partner.rosterId} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{partner.ownerName}</div>
                      <div className="text-[11px] text-gray-500">{partner.fitLabel} • {partner.bestApproach}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-blue-300">{partner.rankScore}</div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">Partner Score</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-300">
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5">Playoffs {Math.round(partner.playoffOdds || 0)}%</span>
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5">Title {Math.round(partner.titleOdds || 0)}%</span>
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5">Finish {partner.finishRange}</span>
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5">1.01 {Math.round(partner.oneOhOneOdds || 0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {tradeRecommendationCards.map((card: any) => (
            <div key={`${card.archetype}-${card.partnerName}`} className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{card.archetype}</span>
                    <span className="rounded-full border border-blue-700 bg-blue-950/40 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                      {card.partnerName}
                    </span>
                    <span className="rounded-full border border-gray-700 bg-gray-950/60 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                      {card.fitLabel}
                    </span>
                    <span className="rounded-full border border-emerald-700 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      Score {card.recommendationScore}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-gray-300">{card.summary}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center md:min-w-[220px]">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Partner Playoffs</div>
                    <div className="mt-1 text-sm font-semibold text-white">{Math.round(card.partnerPlayoffOdds || 0)}%</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Package Delta</div>
                    <div className={`mt-1 text-sm font-semibold ${card.packageDelta >= 0 ? "text-green-300" : "text-red-300"}`}>
                      {card.packageDelta > 0 ? "+" : ""}{card.packageDelta.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-red-400">You Give</div>
                  <div className="space-y-2">
                    {card.give.map((asset: any) => renderAsset(asset))}
                  </div>
                  <div className="mt-2 text-right text-[11px] text-gray-500">Total {card.giveTotal.toLocaleString()}</div>
                </div>
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-green-400">You Receive</div>
                  <div className="space-y-2">
                    {card.receive.map((asset: any) => renderAsset(asset))}
                  </div>
                  <div className="mt-2 text-right text-[11px] text-gray-500">Total {card.receiveTotal.toLocaleString()}</div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-blue-400">Why You Do It</div>
                  <div className="mt-1 text-xs text-gray-300">{card.whyYou}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-orange-400">Why They Might</div>
                  <div className="mt-1 text-xs text-gray-300">{card.whyThem}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-violet-400">Best Approach</div>
                  <div className="mt-1 text-xs text-gray-300">{card.bestApproach}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-cyan-400">Opening Offer</div>
                  <div className="mt-1 text-xs text-gray-300">{card.openingOffer}</div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Negotiation Notes</div>
                <div className="mt-2 space-y-1">
                  {(card.negotiationNotes || []).map((note: string) => (
                    <div key={note} className="text-xs text-gray-300">{note}</div>
                  ))}
                </div>
              </div>
            </div>
          ))}
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

{/* ── MANAGEMENT HUB TAB ──────────────────────────────────────────── */}
{mainTab === "MANAGEMENT_HUB" && (
  <div className="max-w-5xl mx-auto p-6">

    {/* Sub-tab nav */}
    <div className="flex justify-center border-b border-gray-700 mb-6 overflow-x-auto">
      <div className="flex justify-center gap-6 text-center">
        <button
          onClick={() => setMgmtHubTab("LEAGUE_MGMT")}
          className={`pb-2 px-1 text-sm font-semibold transition ${
            mgmtHubTab === "LEAGUE_MGMT"
              ? "border-b-2 border-blue-400 text-blue-400"
              : "text-gray-400 hover:text-white"
          }`}
        >
          League Management
        </button>
        <button
          onClick={() => setMgmtHubTab("COMMISSIONER_TOOLS")}
          className={`pb-2 px-1 text-sm font-semibold transition ${
            mgmtHubTab === "COMMISSIONER_TOOLS"
              ? "border-b-2 border-blue-400 text-blue-400"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Commissioner Tools
        </button>
      </div>
    </div>

    {/* ── LEAGUE MANAGEMENT ── */}
    {mgmtHubTab === "LEAGUE_MGMT" && (() => {
      const MGMT_COLS: { key: string; label: string }[] = [
        { key: "paid_2026", label: "2026" },
        { key: "paid_2027", label: "2027" },
        { key: "paid_2028", label: "2028" },
        { key: "paid_2029", label: "2029" },
        { key: "commissioner", label: "Commissioner" },
        { key: "year_in_advance", label: "Year in Advance" },
        { key: "picks_traded", label: "Picks Traded" },
      ];

      const toggleLeagueMgmt = async (leagueId: string, key: string) => {
        if (!supabaseUser) return;
        const current = leagueMgmtData[leagueId] || {};
        const newVal = !current[key];
        const updated = { ...current, [key]: newVal };
        setLeagueMgmtData((prev) => ({ ...prev, [leagueId]: updated }));
        await supabase.from("league_management").upsert(
          {
            user_id: supabaseUser.id,
            league_id: leagueId,
            paid_2026: updated.paid_2026 ?? false,
            paid_2027: updated.paid_2027 ?? false,
            paid_2028: updated.paid_2028 ?? false,
            paid_2029: updated.paid_2029 ?? false,
            commissioner: updated.commissioner ?? false,
            year_in_advance: updated.year_in_advance ?? false,
            picks_traded: updated.picks_traded ?? false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,league_id" }
        );
      };

      return (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">League Management</h2>
          {leagues.length === 0 ? (
            <p className="text-gray-400 text-sm">Connect your Sleeper account to see your leagues.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-gray-400 font-medium py-2 px-3 border-b border-gray-700 min-w-[140px]"></th>
                    <th colSpan={4} className="text-center text-blue-400 font-semibold py-2 px-3 border-b border-gray-700 border-l border-gray-700">Paid</th>
                    <th colSpan={3} className="text-center text-purple-400 font-semibold py-2 px-3 border-b border-gray-700 border-l border-gray-700">Tools</th>
                  </tr>
                  <tr>
                    <th className="text-left text-gray-400 font-medium py-2 px-3 border-b border-gray-700"></th>
                    {MGMT_COLS.map((col, ci) => (
                      <th
                        key={col.key}
                        className={`text-center text-gray-300 font-medium py-2 px-3 border-b border-gray-700 ${ci === 4 ? "border-l border-gray-700" : ""}`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leagues.map((league: any, idx: number) => {
                    const row = leagueMgmtData[league.league_id] || {};
                    return (
                      <tr key={league.league_id} className={idx % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                        <td className="py-2 px-3 text-white font-medium whitespace-nowrap border-r border-gray-800">
                          {league.name}
                        </td>
                        {MGMT_COLS.map((col, ci) => (
                          <td
                            key={col.key}
                            className={`text-center py-2 px-3 ${ci === 4 ? "border-l border-gray-700" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={!!row[col.key]}
                              onChange={() => toggleLeagueMgmt(league.league_id, col.key)}
                              className="w-4 h-4 accent-blue-500 cursor-pointer"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!supabaseUser && (
                <p className="text-xs text-gray-500 mt-3">Log in with a DynastyZeus account to save your settings.</p>
              )}
            </div>
          )}
        </div>
      );
    })()}

    {/* ── COMMISSIONER TOOLS ── */}
    {mgmtHubTab === "COMMISSIONER_TOOLS" && (() => {
      const commLeagues = leagues.filter((l: any) => !!leagueMgmtData[l.league_id]?.commissioner);
      const PAID_COLS = [
        { key: "paid_2026", label: "Paid 2026" },
        { key: "paid_2027", label: "Paid 2027" },
        { key: "paid_2028", label: "Paid 2028" },
        { key: "paid_2029", label: "Paid 2029" },
      ];

      const handleCommLeagueSelect = async (leagueId: string) => {
        setCommToolsLeagueId(leagueId);
        setCommToolsRosters([]);
        setCommToolsUsers({});
        if (!leagueId) return;
        setLoadingCommToolsRosters(true);
        try {
          const [rostersRes, usersRes] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
            fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`),
          ]);
          const rostersData = await rostersRes.json();
          const usersData = await usersRes.json();
          setCommToolsRosters(rostersData || []);
          const userMap: Record<string, any> = {};
          (usersData || []).forEach((u: any) => { userMap[u.user_id] = u; });
          setCommToolsUsers(userMap);
        } finally {
          setLoadingCommToolsRosters(false);
        }
      };

      const toggleCommPayment = async (leagueId: string, ownerId: string, key: string) => {
        if (!supabaseUser) return;
        const leaguePayments = commPaymentsData[leagueId] || {};
        const ownerPayments = leaguePayments[ownerId] || {};
        const newVal = !ownerPayments[key];
        const updated = { ...ownerPayments, [key]: newVal };
        setCommPaymentsData((prev) => ({
          ...prev,
          [leagueId]: { ...(prev[leagueId] || {}), [ownerId]: updated },
        }));
        await supabase.from("commissioner_payments").upsert(
          {
            user_id: supabaseUser.id,
            league_id: leagueId,
            owner_id: ownerId,
            paid_2026: updated.paid_2026 ?? false,
            paid_2027: updated.paid_2027 ?? false,
            paid_2028: updated.paid_2028 ?? false,
            paid_2029: updated.paid_2029 ?? false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,league_id,owner_id" }
        );
      };

      return (
        <div>
          <h2 className="text-lg font-semibold text-white mb-2">Commissioner Tools</h2>
          {commLeagues.length === 0 ? (
            <p className="text-gray-400 text-sm">
              No leagues marked as Commissioner in League Management. Check the <button onClick={() => setMgmtHubTab("LEAGUE_MGMT")} className="text-blue-400 underline">Commissioner</button> box for a league to use this tab.
            </p>
          ) : (
            <div>
              <div className="mb-5">
                <label className="text-sm text-gray-400 mr-3">Select League:</label>
                <select
                  value={commToolsLeagueId}
                  onChange={(e) => handleCommLeagueSelect(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                >
                  <option value="">— choose a league —</option>
                  {commLeagues.map((l: any) => (
                    <option key={l.league_id} value={l.league_id}>{l.name}</option>
                  ))}
                </select>
              </div>

              {commToolsLeagueId && (
                loadingCommToolsRosters ? (
                  <div className="text-sm text-gray-400">Loading owners...</div>
                ) : commToolsRosters.length === 0 ? (
                  <div className="text-sm text-gray-400">No roster data found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr>
                          <th className="text-left text-gray-400 font-medium py-2 px-3 border-b border-gray-700 min-w-[160px]">Owner</th>
                          {PAID_COLS.map((col) => (
                            <th key={col.key} className="text-center text-blue-400 font-medium py-2 px-3 border-b border-gray-700">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {commToolsRosters.map((roster: any, idx: number) => {
                          const ownerId = roster.owner_id;
                          if (!ownerId) return null;
                          const ownerUser = commToolsUsers[ownerId];
                          const displayName = ownerUser?.display_name || ownerUser?.username || ownerId;
                          const ownerPayments = (commPaymentsData[commToolsLeagueId] || {})[ownerId] || {};
                          return (
                            <tr key={ownerId} className={idx % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                              <td className="py-2 px-3 text-white font-medium whitespace-nowrap border-r border-gray-800">
                                {displayName}
                              </td>
                              {PAID_COLS.map((col) => (
                                <td key={col.key} className="text-center py-2 px-3">
                                  <input
                                    type="checkbox"
                                    checked={!!ownerPayments[col.key]}
                                    onChange={() => toggleCommPayment(commToolsLeagueId, ownerId, col.key)}
                                    className="w-4 h-4 accent-blue-500 cursor-pointer"
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!supabaseUser && (
                      <p className="text-xs text-gray-500 mt-3">Log in with a DynastyZeus account to save your settings.</p>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      );
    })()}

  </div>
)}

{/* DRAFT SCOUT MODAL */}
{draftScoutUserId && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
    <div className="bg-gray-900 p-6 rounded-xl w-[520px] max-h-[80vh] overflow-y-auto">

      <div className="text-lg font-bold mb-1">
        {users[draftScoutUserId]}'s {ROOKIE_YEAR} Rookie Drafts
      </div>
      <div className="text-xs text-gray-500 mb-4">
        All leagues — click a team name in the header to scout them
      </div>

      {loadingDraftScout ? (
        <div className="text-sm text-gray-400">Loading draft history...</div>
      ) : !draftScoutData?.length ? (
        <div className="text-sm text-gray-400">No {ROOKIE_YEAR} drafts started yet.</div>
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
      {/* ── Global Player Profile Panel ── */}
      {(() => {
        if (!playerProfileId) return null;
        const p = (players as any)[playerProfileId];
        if (!p) return null;
        const dynVal = calcFcValues[playerProfileId] ?? p.value ?? 0;
        const redVal = redraftValues[playerProfileId] ?? 0;
        const injuryStatus = p.injury_status || p.status;
        const injuryNote = [p.injury_body_part, p.injury_notes].filter(Boolean).join(" — ");
        const practiceDesc = p.practice_description || p.practice_participation || "";
        const injuryColor =
          injuryStatus === "IR" || injuryStatus === "PUP" ? "bg-red-900/50 text-red-300 border-red-700" :
          injuryStatus === "Out" ? "bg-red-900/40 text-red-400 border-red-800" :
          injuryStatus === "Doubtful" ? "bg-orange-900/40 text-orange-400 border-orange-700" :
          injuryStatus === "Questionable" ? "bg-yellow-900/40 text-yellow-400 border-yellow-700" :
          "bg-green-900/30 text-green-400 border-green-700";

        // Which leaguemates own this player
        const ownersInSelectedLeague = rosters
          .filter((r: any) => (r.players || []).includes(playerProfileId))
          .map((r: any) => (users as any)[r.owner_id] || `Team ${r.roster_id}`);

        // Cross-league ownership from overview data (uses per-league user map fetched during loadLeagueOverview)
        const crossLeagueOwners: { leagueName: string; owner: string }[] = [];
        Object.entries(leagueOverviewData).forEach(([lid, entry]: [string, any]) => {
          const lg = leagues.find((l: any) => l.league_id === lid);
          if (!lg) return;
          const leagueUserMap: Record<string, string> = entry.userMap || {};
          (entry.rosters || []).forEach((r: any) => {
            if ((r.players || []).includes(playerProfileId)) {
              const ownerName = leagueUserMap[r.owner_id] || (users as any)[r.owner_id] || `Team ${r.roster_id}`;
              crossLeagueOwners.push({ leagueName: lg.name, owner: ownerName });
            }
          });
        });

        const noteVal = playerNotes[playerProfileId] ?? "";
        const disp = playerDispositions[playerProfileId] ?? { sell: "Neutral", buy: "Neutral" };

        return (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setPlayerProfileId(null)}
            />
            {/* Panel */}
            <div className="fixed top-0 right-0 h-full w-full max-w-sm bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl overflow-y-auto">
              {/* Header */}
              <div className="flex items-start justify-between p-5 border-b border-gray-800">
                <div>
                  <h2 className="text-lg font-bold text-white">{p.full_name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">{p.position}</span>
                    {p.team && <span className="text-xs text-gray-500">· {p.team}</span>}
                    {p.age && <span className="text-xs text-gray-500">· Age {p.age}</span>}
                  </div>
                </div>
                <button onClick={() => setPlayerProfileId(null)} className="text-gray-500 hover:text-white text-xl leading-none mt-1">✕</button>
              </div>

              <div className="p-5 space-y-5 flex-1">
                {/* Values */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Dynasty Value</p>
                    <p className="text-xl font-bold text-white">{dynVal > 0 ? dynVal.toLocaleString() : "—"}</p>
                  </div>
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Redraft Value</p>
                    <p className="text-xl font-bold text-white">{redVal > 0 ? redVal.toLocaleString() : "—"}</p>
                  </div>
                </div>

                {/* Injury / Status */}
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Status</p>
                  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${injuryColor}`}>
                    {injuryStatus || "Active"}
                  </span>
                  {injuryNote && <p className="text-xs text-gray-400 mt-1.5">{injuryNote}</p>}
                  {practiceDesc && <p className="text-xs text-gray-500 mt-1">{practiceDesc}</p>}
                </div>

                {/* Ownership */}
                {ownersInSelectedLeague.length > 0 && (
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Owned in {selectedLeague?.name || "Selected League"}
                    </p>
                    {ownersInSelectedLeague.map((name, i) => (
                      <p key={i} className="text-sm text-white">{name}</p>
                    ))}
                  </div>
                )}

                {crossLeagueOwners.length > 0 && (
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Cross-League Ownership</p>
                    <div className="space-y-1">
                      {crossLeagueOwners.map((entry, i) => (
                        <div key={i} className="flex items-baseline justify-between text-xs">
                          <span className="text-white truncate mr-2">{entry.owner}</span>
                          <span className="text-gray-500 shrink-0">{entry.leagueName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ownersInSelectedLeague.length === 0 && crossLeagueOwners.length === 0 && (
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Ownership</p>
                    <p className="text-xs text-gray-600">Not on any loaded roster.</p>
                  </div>
                )}

                {/* Dispositions */}
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-800 space-y-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Trade Disposition</p>
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">Trading Away</p>
                    <select
                      value={disp.sell}
                      onChange={(e) => savePlayerDisposition(playerProfileId, e.target.value, disp.buy)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="Not Willing to Trade">Not Willing to Trade</option>
                      <option value="Will Trade but Higher than Market">Will Trade but Higher than Market</option>
                      <option value="Neutral">Neutral</option>
                      <option value="Lower than Market">Lower than Market</option>
                      <option value="Trade at All Costs">Trade at All Costs</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">Trading For</p>
                    <select
                      value={disp.buy}
                      onChange={(e) => savePlayerDisposition(playerProfileId, disp.sell, e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="Buy Over Market">Buy Over Market</option>
                      <option value="Buy at Market">Buy at Market</option>
                      <option value="Neutral">Neutral</option>
                      <option value="Buy Low">Buy Low</option>
                      <option value="Zero Interest">Zero Interest</option>
                    </select>
                  </div>
                  {(disp.sell !== "Neutral" || disp.buy !== "Neutral") && (
                    <p className="text-[10px] text-blue-400">Trade Finder will factor in these preferences.</p>
                  )}
                </div>

                {/* Notes */}
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Your Notes</p>
                  <textarea
                    value={noteVal}
                    onChange={(e) => savePlayerNote(playerProfileId, e.target.value)}
                    placeholder={`Jot down thoughts on ${p.first_name || p.full_name}…`}
                    className="w-full h-28 bg-gray-800 border border-gray-700 rounded-lg p-2.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
              </div>
            </div>
          </>
        );
      })()}

      </>
      </div>
    </main>
    </>
  );
}


