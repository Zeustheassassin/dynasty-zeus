"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import Dashboard from "../components/Dashboard";
import { supabase } from "../lib/supabaseclient";

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
type LeagueHubTab = "OVERVIEW" | "ROSTERS" | "LEAGUE_MATES" | "OPP_ROSTERS" | "STANDINGS" | "STARTERS" | "NOTES" | "POWER_RANKINGS";

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

const rankAgainstLeague = (totals: number[], value: number) => {
  const sorted = [...totals].sort((a, b) => b - a);
  let rank = 1;
  for (const total of sorted) {
    if (value >= total) break;
    rank++;
  }
  return Math.min(rank, sorted.length || 1);
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
const [tradeHubSection, setTradeHubSection] = useState<"CALCULATOR" | "FINDER">("CALCULATOR");
const [finderSeed, setFinderSeed] = useState(() => Math.random());
const [finderDraftCapitalMode, setFinderDraftCapitalMode] = useState(false);
const [leagueHubTab, setLeagueHubTab] = useState<LeagueHubTab>("OVERVIEW");
const [leagueOverviewData, setLeagueOverviewData] = useState<Record<string, any>>({});
const [loadingLeagueOverview, setLoadingLeagueOverview] = useState(false);
const [leagueOverviewLoaded, setLeagueOverviewLoaded] = useState(false);
const [leagueMateTradeIntel, setLeagueMateTradeIntel] = useState<Record<string, any>>({});
const [loadingLeagueMateIntel, setLoadingLeagueMateIntel] = useState(false);
const [crossLeagueMateIntel, setCrossLeagueMateIntel] = useState<Record<string, any>>({});
const [loadingCrossLeagueMateIntel, setLoadingCrossLeagueMateIntel] = useState(false);
const [leagueMateProfileCache, setLeagueMateProfileCache] = useState<Record<string, any[]>>({});
const [leagueNotes, setLeagueNotes] = useState<Record<string, string>>({});
const [nflState, setNflState] = useState<any>(null);
const [dataHubTab, setDataHubTab] = useState<"OWNERSHIP" | "DYNASTY" | "REDRAFT" | "PROJECTIONS" | "LEAGUEMATES">("OWNERSHIP");
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
  localStorage.removeItem(`rookieBoard_${ROOKIE_YEAR}`);
  localStorage.removeItem(ROOKIE_BOARD_RESET_KEY);
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

useEffect(() => {
  if (mainTab === "LEAGUES" && leagueHubTab === "POWER_RANKINGS" && selectedLeague?.league_id) {
    loadCalcValues(selectedLeague.league_id);
    loadRedraftValues();
  }
}, [mainTab, leagueHubTab, selectedLeague?.league_id]);

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

useEffect(() => {
  const shouldLoadCrossLeagueIntel =
    !!selectedLeague?.league_id &&
    !!rosters.length &&
    !!user?.user_id &&
    !!Object.keys(players || {}).length &&
    (
      (mainTab === "LEAGUES" && leagueHubTab === "LEAGUE_MATES") ||
      (mainTab === "TRADE_HUB" && tradeHubSection === "FINDER")
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
    localStorage.setItem(`rookieBoard_${ROOKIE_YEAR}`, JSON.stringify(rookies));
    const user = supabaseUserRef.current;
    if (user) {
      // Save just the ordered names — small payload, easy to apply to any canonical board
      const orderedNames = rookies.map((r: any) => r.name);
      supabase.from("rookie_board").upsert(
        { user_id: user.id, year: ROOKIE_YEAR, players: orderedNames, updated_at: new Date().toISOString() },
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
    // 1. Fetch fresh player data from sheet + ADP
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
      .sort((a, b) => (a.adp !== b.adp ? a.adp - b.adp : a.name.localeCompare(b.name)));

    // 2. Try Supabase for saved order (if logged in)
    if (supabaseUser) {
      const { data, error } = await supabase
        .from("rookie_board")
        .select("players")
        .eq("user_id", supabaseUser.id)
        .eq("year", ROOKIE_YEAR)
        .single();
      if (!error && data?.players && Array.isArray(data.players) && data.players.length > 0) {
        // data.players is an ordered array of player names
        const orderMap = new Map<string, number>(
          (data.players as string[]).map((name, i) => [normalizeRookieName(name), i])
        );
        const ordered = [...canonicalBoard].sort((a, b) => {
          const ia = orderMap.get(normalizeRookieName(a.name)) ?? 9999;
          const ib = orderMap.get(normalizeRookieName(b.name)) ?? 9999;
          return ia !== ib ? ia - ib : a.adp - b.adp;
        });
        localStorage.setItem(`rookieBoard_${ROOKIE_YEAR}`, JSON.stringify(ordered));
        setRookies(ordered);
        return;
      }
    }

    // 3. Fall back to localStorage order
    const saved = localStorage.getItem(`rookieBoard_${ROOKIE_YEAR}`);
    const hasReset = localStorage.getItem(ROOKIE_BOARD_RESET_KEY) === "true";

    if (!hasReset || !saved) {
      setRookies(canonicalBoard);
      localStorage.setItem(`rookieBoard_${ROOKIE_YEAR}`, JSON.stringify(canonicalBoard));
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
      return ia !== ib ? ia - ib : a.adp - b.adp;
    });

    localStorage.setItem(`rookieBoard_${ROOKIE_YEAR}`, JSON.stringify(merged));
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
        <div className="flex overflow-x-auto border-t border-gray-800 scrollbar-none">
          <div className="flex gap-5 px-3 pb-2 md:mx-auto">
          <button onClick={() => setMainTab("DASHBOARD")} className={`text-sm whitespace-nowrap py-1 ${mainTab === "DASHBOARD" ? "text-blue-400 font-semibold" : "text-gray-400"}`}>
            Dashboard
          </button>
          <button onClick={() => user && setMainTab("LEAGUES")} className={`text-sm whitespace-nowrap py-1 ${mainTab === "LEAGUES" ? "text-blue-400 font-semibold" : "text-gray-400"} ${!user ? "opacity-40 cursor-not-allowed" : ""}`}>
            League Hub
          </button>
          <button onClick={() => user && setMainTab("DATA_HUB")} className={`text-sm whitespace-nowrap py-1 ${mainTab === "DATA_HUB" ? "text-blue-400 font-semibold" : "text-gray-400"} ${!user ? "opacity-40 cursor-not-allowed" : ""}`}>
            Data Hub
          </button>
          <button onClick={() => user && setMainTab("DRAFT")} className={`text-sm whitespace-nowrap py-1 ${mainTab === "DRAFT" ? "text-blue-400 font-semibold" : "text-gray-400"} ${!user ? "opacity-40 cursor-not-allowed" : ""}`}>
            Draft Hub
          </button>
          <button onClick={() => user && setMainTab("TRADE_HUB")} className={`text-sm whitespace-nowrap py-1 ${mainTab === "TRADE_HUB" ? "text-blue-400 font-semibold" : "text-gray-400"} ${!user ? "opacity-40 cursor-not-allowed" : ""}`}>
            Trade Hub
          </button>
          <button onClick={() => user && setMainTab("MANAGEMENT_HUB")} className={`text-sm whitespace-nowrap py-1 ${mainTab === "MANAGEMENT_HUB" ? "text-blue-400 font-semibold" : "text-gray-400"} ${!user ? "opacity-40 cursor-not-allowed" : ""}`}>
            Management Hub
          </button>
          </div>
        </div>
      </div>

      <div className={mainTab === "DRAFT" || mainTab === "TRADE_HUB" || mainTab === "MANAGEMENT_HUB" || mainTab === "LEAGUES" ? "" : "max-w-3xl mx-auto p-6"}>
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
                if (!myRosterId) return null;
                const profile = getRosterDirectionProfile({
                  rosterId: myRosterId,
                  rosters: lr,
                  ownedPicks,
                  players,
                  pickValues: pickFcValues,
                  redraftValues,
                  dynastyValueForPlayer: (id: string) => (players as any)[id]?.value ?? 0,
                });
                if (!profile) return null;
                return { league, ...profile };
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
                      {/* Header */}
                      <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(150px,1fr)_72px_72px_72px_72px] gap-2 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                        <span>League</span>
                        <span>Direction</span>
                        <span className="text-center">Dyn</span>
                        <span className="text-center">Rdft</span>
                        <span className="text-center">Stnd</span>
                        <span className="text-center">MaxPF</span>
                      </div>
                      {leagueRows.map((row: any) => (
                        <div key={row.league.league_id} className="grid grid-cols-[minmax(220px,1.4fr)_minmax(190px,1.15fr)_72px_72px_72px_72px] gap-2 items-center bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5">
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
                {selectedLeagueDirection && (
                  <div className="mb-4 bg-gray-900 border border-gray-700 rounded-xl p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Roster Direction</div>
                        <div className="mt-1 text-sm text-gray-200">{selectedLeagueDirection.summary}</div>
                      </div>
                      <span className={`inline-flex text-[10px] font-semibold px-2 py-1 rounded-full border self-start ${selectedLeagueDirection.bucketColor}`}>
                        {selectedLeagueDirection.bucket}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Dynasty</div>
                        <div className="text-sm font-semibold text-white">{ordinal(selectedLeagueDirection.dynRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Redraft</div>
                        <div className="text-sm font-semibold text-white">{ordinal(selectedLeagueDirection.redRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Standings</div>
                        <div className="text-sm font-semibold text-white">{ordinal(selectedLeagueDirection.standRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Max PF</div>
                        <div className="text-sm font-semibold text-white">{ordinal(selectedLeagueDirection.maxPfRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Core Age</div>
                        <div className="text-sm font-semibold text-white">{selectedLeagueDirection.coreAge || "-"}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">1sts</div>
                        <div className="text-sm font-semibold text-white">{selectedLeagueDirection.firstRounders}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedLeagueDirection.actions.map((action: string) => (
                        <span key={action} className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-1 text-[11px] text-blue-200">
                          {action}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-green-400">What You Have</div>
                        <div className="mt-1 space-y-1">
                          {selectedLeagueDirection.strengths.length > 0 ? selectedLeagueDirection.strengths.map((item: string) => (
                            <div key={item} className="text-xs text-gray-300">{item}</div>
                          )) : (
                            <div className="text-xs text-gray-500">No clear structural advantage yet.</div>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-orange-400">What To Watch</div>
                        <div className="mt-1 space-y-1">
                          {selectedLeagueDirection.concerns.length > 0 ? selectedLeagueDirection.concerns.map((item: string) => (
                            <div key={item} className="text-xs text-gray-300">{item}</div>
                          )) : (
                            <div className="text-xs text-gray-500">No major red flags from the current profile.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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
                    selectedLeagueMateProfilesView.map((mate: any) => (
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
                              <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${mate.directionProfile.bucketColor}`}>
                                {mate.directionProfile.bucket}
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
                    ))
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
                          {["2026","2027","2028"].map((year) => {
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
                                <span className="text-xs text-white truncate">{p.full_name}</span>
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

          </>
          </div>
        )}

        {/* DATA HUB TAB */}
        {mainTab === "DATA_HUB" && (
          <>
            {/* Sub-tab nav */}
            <div className="flex justify-center border-b border-gray-800 mb-6 overflow-x-auto">
              <div className="flex justify-center gap-6 text-center">
              {(["OWNERSHIP", "DYNASTY", "REDRAFT", "PROJECTIONS", "LEAGUEMATES"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDataHubTab(tab)}
                  className={`pb-2 px-1 text-sm font-semibold transition ${
                    dataHubTab === tab
                      ? "border-b-2 border-blue-400 text-blue-400"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {tab === "OWNERSHIP" ? "Player Ownership" : tab === "DYNASTY" ? "Dynasty Rankings" : tab === "REDRAFT" ? "Redraft Rankings" : tab === "PROJECTIONS" ? "Player Projections" : "League Mate Stats"}
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
                          <p className="text-xs text-gray-600 mt-3">Total Leagues = 2026 non-best-ball NFL leagues for that owner on Sleeper.</p>
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
        <div
          className="inline-grid min-w-max gap-y-2"
          style={{ gridTemplateColumns: `repeat(${rosters.length}, minmax(9rem, 1fr))` }}
        >
          {/* TEAM HEADER — ordered by actual draft slot */}
          {Array.from({ length: rosters.length }, (_, i) => i + 1).map((slot) => {
            const userId = Object.keys(draftOrder).find(
              (uid) => draftOrder[uid] === slot
            );
            const teamName = (userId && users[userId]) || `Team ${slot}`;

            return (
              <button
                key={slot}
                onClick={() => userId && loadDraftScout(userId)}
                className="min-w-0 min-h-[2.75rem] px-2 text-center text-xs text-blue-400 hover:text-blue-300 cursor-pointer whitespace-normal break-words leading-tight"
                title={`View ${teamName}'s 2026 draft picks`}
              >
                {teamName}
              </button>
            );
          })}

          {ROUNDS.flatMap((round) => {
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

            return roundPicks.map((pick, i) => {
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
                  key={`${round}-${i}`}
                  className="min-w-0 h-16 bg-gray-800 rounded-md flex flex-col justify-center items-center text-xs border border-gray-700 px-2 gap-0.5"
                >
                  {player ? (
                    <>
                      <div className="text-center w-full text-white font-medium whitespace-normal break-words leading-tight">
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
                      <div className="text-blue-400 text-[10px] text-center w-full whitespace-normal break-words leading-tight">
                        {users[pick.owner_id] || ""}
                      </div>
                    </>
                  )}
                </div>
              );
            });
          })}
        </div>
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
      const finderDirectionProfile = myRoster ? getRosterDirectionProfile({
        rosterId: myRoster.roster_id,
        rosters,
        ownedPicks: allPicks,
        players,
        pickValues: pickFcValues,
        redraftValues,
        dynastyValueForPlayer: (id: string) => calcVal(id),
      }) : null;
      const finderDirection = finderDirectionProfile?.bucket || getLeagueDirectionBucket(dynRank, redRank).bucket;
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
      const isYoungBuildingBlock = (player: any) =>
        ["QB", "WR"].includes(player?.position) && Number(player?.age || 99) <= 24;
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

        if (["Elite", "True Contender", "Almost There"].includes(finderDirection)) {
          score += (incomingRedraft - outgoingRedraft) / 160;
          score += weakPosAdds * 8;
          score -= weakPosLosses * 10;
          score += assetConsolidation > 0 ? assetConsolidation * 4 : assetConsolidation * 1.5;
          score += currentPlayerCapitalOut * 3;
          score -= outgoingPicks.length * 3;
          score -= premiumCurrentPicksOut * 10;
          score -= incomingPicks.length * 2;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 28).length * 4;
        } else if (["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection)) {
          score += agingSells * 9;
          score += youngCoreBuys * 8;
          score += futureFirstsIn * 12;
          score += picksIn / 180;
          score -= picksOut / 180;
          score -= premiumCurrentPicksOut * 12;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 25).length * 7;
          score -= incomingRedraft / 220;
          score += strongPosSells * 3;
        } else {
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

        if (outgoingPicks.length > 0 && currentPlayerCapitalOut === 0) score -= 6;
        if (incomingPicks.length > 0 && outgoingPlayers.length === 0 && !draftCapitalMode) score -= 4;
        if (trade.draftCapital && !["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection)) score -= 3;

        return score;
      };
      // When a player is pinned, ensure they're always in the give pool even if outside top 10
      const myTop = finderPinnedPlayerId && !myPlayers.slice(0, 10).some((p: any) => p.player_id === finderPinnedPlayerId)
        ? [...myPlayers.slice(0, 9), myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId)].filter(Boolean)
        : myPlayers.slice(0, 10);
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
        ? myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId) ?? null
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

        return {
          myBefore,
          myAfter,
          oppBefore,
          oppAfter,
          myValid: myAfter.valid,
          oppValid: oppAfter.valid,
          valid: myAfter.emptySlots === 0 && oppAfter.emptySlots === 0,
          score: myDelta + oppDelta * 0.7 - myShortagePenalty - oppShortagePenalty * 0.7,
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
        const oppTopBase = oppPlayers.slice(0, 10);
        const oppTop = finderTargetPlayerId && !oppTopBase.some((p: any) => p.player_id === finderTargetPlayerId)
          ? [...oppTopBase.slice(0, 9), oppPlayers.find((p: any) => p.player_id === finderTargetPlayerId)].filter(Boolean)
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
        .filter((r) => !pinnedPlayer || r.give.some((p: any) => p.player_id === pinnedPlayer.player_id))
        .filter((r) => !finderTargetPlayerId || r.receive.some((p: any) => p.player_id === finderTargetPlayerId))
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
          const strategyScore = r.score + getDirectionTradeScore(r) + lineupSafety.score + partnerFitScore;
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
                    {partnerProfile.fitReasons[0]}
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
      </>
      </div>
    </main>
    </>
  );
}
