// ============================================================
// Pure helper functions shared across DynastyZeus hub components.
// All functions here are side-effect free — they take inputs and
// return computed values without touching React state.
// ============================================================

const BASE_YEAR = new Date().getFullYear();
export const CURRENT_YEAR = String(BASE_YEAR);
export const YEARS = Array.from({ length: 3 }, (_, i) => String(BASE_YEAR + i));
export const ROUNDS = [1, 2, 3, 4];

export const normalizeProjName = (n: string) =>
  n.toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, '')
    .replace(/[^a-z]/g, '');

// -------------------------
// PURE HELPER FUNCTIONS
// -------------------------
export const getLineupSettings = (league: any) => {
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

export const STANDARD_SCORING: any = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_first_down: 0,
  pass_cmp: 0, pass_inc: 0, pass_attempt: 0, pass_sack: 0,
  pass_sack_yd: 0, pass_pick_six: 0, bonus_pass_yd_40: 0,
  bonus_pass_td_40: 0, bonus_pass_td_50: 0, rush_yd: 0.1,
  rush_td: 6, rec: 0, rec_yd: 0.1, rec_td: 6,
  rec_2pt: 2, rush_2pt: 2, pass_2pt: 2,
};

export const getNonStandardRules = (scoring: any) => {
  const changes: any[] = [];
  Object.keys(scoring || {}).forEach((key) => {
    const value = scoring[key];
    const standard = STANDARD_SCORING[key];
    if (value === 0 || value === null) return;
    if (standard === undefined || value !== standard) changes.push({ key, value });
  });
  return changes;
};

export const formatRule = (key: string) => {
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

export const groupRules = (rules: any[]) => ({
  Passing: rules.filter((r) =>
    r.key.startsWith("pass") || r.key === "pass_int_td" ||
    r.key === "pass_cmp" || r.key === "pass_attempt" || r.key === "pass_sack"
  ),
  Rushing: rules.filter((r) => r.key.startsWith("rush")),
  Receiving: rules.filter((r) =>
    r.key === "rec" || r.key.startsWith("rec_") || r.key.startsWith("bonus_rec")
  ),
});

export const getPickValueKey = (pick: any) => {
  if (pick?.season === CURRENT_YEAR && pick?.slot && String(pick.slot).includes(".")) {
    return `${pick.season}-${pick.slot}`;
  }
  return `${pick?.season}-${pick?.round}`;
};

export const getStoredPickValue = (pickValues: Record<string, number>, pick: any) =>
  pickValues[getPickValueKey(pick)] ?? pickValues[`${pick?.season}-${pick?.round}`] ?? 0;

export const isSnakeDraft = (draft: any) => {
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

export const getDraftRoundSlot = (draft: any, round: number, baseSlot: number, totalTeams: number) => {
  if (!baseSlot || baseSlot < 1 || totalTeams < 2) return baseSlot;
  if (!isSnakeDraft(draft)) return baseSlot;
  return round % 2 === 0 ? (totalTeams - baseSlot + 1) : baseSlot;
};

export const getLeagueDirectionBucket = (dynRank: number, redRank: number) => {
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
export const getBucketColor = (bucket: string): string => {
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
export const computeWindowScore = (profile: any): number => {
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
export const getAdjustedDirectionBucket = (
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

export const ordinal = (rank: number) => {
  if (!rank) return "-";
  if (rank % 100 >= 11 && rank % 100 <= 13) return `${rank}th`;
  if (rank % 10 === 1) return `${rank}st`;
  if (rank % 10 === 2) return `${rank}nd`;
  if (rank % 10 === 3) return `${rank}rd`;
  return `${rank}th`;
};

export const average = (values: number[]) =>
  values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
export const logisticWinProb = (myScore: number, oppScore: number, scale = 180) =>
  clamp(1 / (1 + Math.exp((oppScore - myScore) / scale)), 0.05, 0.95);
export const createSeededRandom = (seed: number) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
export const randomNormal = (rng: () => number) => {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
export const buildRoundRobinSchedule = (rosterIds: number[], totalWeeks: number) => {
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
export const percentileFromCounts = (counts: number[], percentile: number) => {
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

export const rankAgainstLeague = (totals: number[], value: number) => {
  const sorted = [...totals].sort((a, b) => b - a);
  let rank = 1;
  for (const total of sorted) {
    if (value >= total) break;
    rank++;
  }
  return Math.min(rank, sorted.length || 1);
};

export const FLEX_ELIGIBLE_POSITIONS = ["RB", "WR", "TE"];
export const SUPER_FLEX_ELIGIBLE_POSITIONS = ["QB", "RB", "WR", "TE"];

export const getProjectionKickoffAt = (projection: any) => {
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

export const getKickoffState = (kickoffAt: number | null, now = Date.now()) => {
  if (!kickoffAt) return "Upcoming";
  if (now < kickoffAt) return "Upcoming";
  if (now - kickoffAt < 6 * 60 * 60 * 1000) return "Live";
  return "Final";
};

export const getKickoffStateClasses = (state: string) => {
  if (state === "Live") return "border-green-500/40 bg-green-500/10 text-green-300";
  if (state === "Final") return "border-gray-600 bg-gray-800 text-gray-300";
  return "border-blue-500/40 bg-blue-500/10 text-blue-300";
};

export const formatKickoffTime = (kickoffAt: number | null) => {
  if (!kickoffAt) return "--";
  try {
    return new Date(kickoffAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "--";
  }
};

export const getLineupSlotEligiblePositions = (slot: string) => {
  if (slot === "FLEX") return FLEX_ELIGIBLE_POSITIONS;
  if (slot === "SUPER_FLEX") return SUPER_FLEX_ELIGIBLE_POSITIONS;
  return [slot];
};

export const rebalanceLineupForKickoffWindows = (
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

export const getRosterDirectionProfile = ({
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

export const getProfilePosBuckets = (profile: any) => {
  const positions = profile?.positionRanks || [];
  const n = profile?.n || 12;
  const strongThreshold = Math.max(2, Math.ceil(n / 3));
  const weakThreshold = Math.max(strongThreshold + 1, n - 2);
  return {
    strong: positions.filter((entry: any) => entry.rank <= strongThreshold).map((entry: any) => entry.pos),
    weak: positions.filter((entry: any) => entry.rank >= weakThreshold).map((entry: any) => entry.pos),
  };
};

export const getLeagueMateMotivation = (profile: any, tradeCount30d: number) => {
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

export const getTradePartnerFitLabel = (fitScore: number) => {
  if (fitScore >= 34) return "Best Trade Partner";
  if (fitScore >= 24) return "Strong Fit";
  if (fitScore >= 14) return "Solid Fit";
  if (fitScore < 4) return "Tough Fit";
  return "Neutral Fit";
};

export const getTradePartnerFit = ({ myProfile, oppProfile, tradeCount30d }: any) => {
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

export const getCrossLeaguePreferenceFit = ({ myProfile, crossLeagueIntel }: any) => {
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

export const getCrossLeagueTradeBehaviorFit = ({ myProfile, crossLeagueIntel }: any) => {
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

export const fetchFantasyCalcValues = async (numQbs = 1): Promise<{ playerValues: Record<string, number>; pickValues: Record<string, number> }> => {
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

export const formatRelativeDate = (ts: number) => {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 21) return "2 weeks ago";
  if (days < 30) return "3 weeks ago";
  return "1 month ago";
};

export const normalizeRookieName = (name: string) =>
  (name || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/[^a-z]/g, "")
    .trim();

export const buildSleeperRookieBoard = (_playerMap: any) => [];