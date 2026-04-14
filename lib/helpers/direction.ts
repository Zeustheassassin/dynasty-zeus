// ============================================================
// Roster direction — strategic bucket classification, window
// scoring, trade fit analysis, and cross-league intel.
// ============================================================

import { CURRENT_YEAR } from "./season";
import { average, ordinal, rankAgainstLeague } from "./math";
import { getStoredPickValue } from "./picks";

// ── Bucket classification ─────────────────────────────────────

/**
 * Maps (dynasty rank, redraft rank, leagueSize) → a strategic bucket label + Tailwind color.
 *
 * Uses percentile-based thresholds so the grid scales correctly for 8-team
 * and 14-team leagues alike:
 *   top20 = top-20% = ceil(n × 0.20)   — "Elite" cut
 *   top33 = top-33% = ceil(n × 0.33)   — upper-tier cut
 *   bot33 = bottom-33% cut = ceil(n × 0.67)  (ranks > bot33 are bottom third)
 *
 * 3×3 grid:
 *
 *              │ redRank ≤ top33  │ top33 < red ≤ bot33 │ redRank > bot33
 * ─────────────┼──────────────────┼─────────────────────┼─────────────────
 * dyn ≤ top33  │ Elite / True Con │ Almost There        │ Rebuilder
 * mid dynasty  │ Fading Contender │ Purgatory           │ Stranded
 * dyn > bot33  │ Window Closing   │ Fading Out          │ Hopeless
 *
 * Elite is the sub-case where BOTH ranks land in the top-20%.
 */
export const getLeagueDirectionBucket = (dynRank: number, redRank: number, leagueSize = 12) => {
  const n     = leagueSize;
  const top20 = Math.ceil(n * 0.20);
  const top33 = Math.ceil(n * 0.33);
  const bot33 = Math.ceil(n * 0.67);

  // ── Top-third dynasty ─────────────────────────────────────
  if (dynRank <= top33) {
    if (redRank <= top33) {
      // Elite: both in top-20%
      if (dynRank <= top20 && redRank <= top20)
        return { bucket: "Elite",          bucketColor: "text-yellow-300 bg-yellow-900/40 border-yellow-600" };
      return   { bucket: "True Contender", bucketColor: "text-green-300 bg-green-900/40 border-green-600" };
    }
    if (redRank <= bot33)
      return   { bucket: "Almost There",   bucketColor: "text-cyan-300 bg-cyan-900/40 border-cyan-600" };
    return     { bucket: "Rebuilder",      bucketColor: "text-indigo-300 bg-indigo-900/40 border-indigo-600" };
  }

  // ── Middle-third dynasty ──────────────────────────────────
  if (dynRank <= bot33) {
    if (redRank <= top33)
      return { bucket: "Fading Contender", bucketColor: "text-blue-300 bg-blue-900/40 border-blue-600" };
    if (redRank <= bot33)
      return { bucket: "Purgatory",        bucketColor: "text-orange-300 bg-orange-900/40 border-orange-600" };
    return   { bucket: "Stranded",         bucketColor: "text-rose-300 bg-rose-900/40 border-rose-600" };
  }

  // ── Bottom-third dynasty ──────────────────────────────────
  if (redRank <= top33)
    return { bucket: "Window Closing", bucketColor: "text-amber-300 bg-amber-900/40 border-amber-600" };
  if (redRank <= bot33)
    return { bucket: "Fading Out",     bucketColor: "text-purple-300 bg-purple-900/40 border-purple-600" };
  return   { bucket: "Hopeless",       bucketColor: "text-red-300 bg-red-900/40 border-red-600" };
};

/** Detached color lookup — lets adjusted buckets get the right colour
 *  without needing to re-derive ranks. */
export const getBucketColor = (bucket: string): string => {
  const map: Record<string, string> = {
    "Elite":            "text-yellow-300 bg-yellow-900/40 border-yellow-600",
    "True Contender":   "text-green-300 bg-green-900/40 border-green-600",
    "Almost There":     "text-cyan-300 bg-cyan-900/40 border-cyan-600",
    "Rebuilder":        "text-indigo-300 bg-indigo-900/40 border-indigo-600",
    "Fading Contender": "text-blue-300 bg-blue-900/40 border-blue-600",
    "Window Closing":   "text-amber-300 bg-amber-900/40 border-amber-600",
    "Purgatory":        "text-orange-300 bg-orange-900/40 border-orange-600",
    "Stranded":         "text-rose-300 bg-rose-900/40 border-rose-600",
    "Fading Out":       "text-purple-300 bg-purple-900/40 border-purple-600",
    "Hopeless":         "text-red-300 bg-red-900/40 border-red-600",
  };
  return map[bucket] ?? "text-gray-300 bg-gray-800 border-gray-600";
};

// ── Window scoring ────────────────────────────────────────────

/** Composite window score: positive = window open/widening, negative = closing.
 *  Combines core age relative to dynasty prime, young builders, and aging vets. */
export const computeWindowScore = (profile: any): number => {
  const coreAge        = Number(profile?.coreAge        || 0);
  const youngCoreCount = Number(profile?.youngCoreCount || 0);
  const oldCoreCount   = Number(profile?.oldCoreCount   || 0);
  let score = 0;
  if (coreAge > 0) {
    score -= Math.max(0, coreAge - 26) * 0.55;
    score += Math.max(0, 26 - coreAge) * 0.25;
  }
  score += youngCoreCount * 0.85;
  score -= oldCoreCount   * 1.05;
  return score; // typically -5 to +5
};

/** Three-factor adjusted bucket: raw rank bucket + window score (age/youth)
 *  + playoff simulation pressure. Single source of truth for strategic label. */
export const getAdjustedDirectionBucket = (
  rawBucket: string,
  profile: any,
  playoffOdds: number,
  hasSimData = false
): string => {
  if (!rawBucket) return "Fading Out";

  const windowScore     = computeWindowScore(profile);
  const playoffPressure = hasSimData ? (playoffOdds - 50) / 12.5 : 0;
  const composite       = windowScore + playoffPressure;
  const youngCoreCount  = Number(profile?.youngCoreCount || 0);

  let result: string;
  switch (rawBucket) {
    case "Elite":
      if (composite < -4)       result = "Fading Contender";
      else if (composite < -2)  result = "True Contender";
      else                      result = "Elite";
      break;

    case "True Contender":
      if (composite > 2.5)       result = "Elite";
      else if (composite < -3.5) result = "Stranded";
      else if (composite < -1.5) result = "Fading Contender";
      else                       result = "True Contender";
      break;

    case "Almost There":
      if (composite > 2.5)       result = "True Contender";
      else if (composite < -3.5) result = "Stranded";
      else if (composite < -1.5) result = "Rebuilder";
      else                       result = "Almost There";
      break;

    case "Fading Contender":
      if (composite > 2.5 && youngCoreCount >= 2) result = "True Contender";
      else if (composite > 1.5)  result = "Almost There";
      else if (composite < -2.5) result = "Window Closing";
      else                       result = "Fading Contender";
      break;

    case "Purgatory":
      if (composite > 3)         result = "Almost There";
      else if (composite < -2.5) result = "Stranded";
      else                       result = "Purgatory";
      break;

    case "Rebuilder":
      if (composite > 3.5 && youngCoreCount >= 2) result = "Almost There";
      else if (composite < -3.5) result = "Hopeless";
      else                       result = "Rebuilder";
      break;

    case "Stranded":
      if (composite > 3.5 && youngCoreCount >= 3) result = "Rebuilder";
      else if (composite < -3)   result = "Hopeless";
      else                       result = "Stranded";
      break;

    case "Window Closing":
      if (composite > 2 && youngCoreCount >= 2) result = "Fading Contender";
      else if (composite < -3)   result = "Hopeless";
      else                       result = "Window Closing";
      break;

    case "Fading Out":
      if (composite > 3 && youngCoreCount >= 2) result = "Stranded";
      else if (composite < -2)   result = "Hopeless";
      else                       result = "Fading Out";
      break;

    case "Hopeless":
      if (composite > 4 && youngCoreCount >= 4) result = "Stranded";
      else                                      result = "Hopeless";
      break;

    default:
      result = rawBucket;
  }

  // Hard playoff-odds floors — sim data overrides gradient when not a contender.
  if (hasSimData) {
    const above = (...buckets: string[]) => buckets.includes(result);
    if (playoffOdds === 0) {
      if (above("Elite", "True Contender", "Almost There")) result = "Rebuilder";
      if (result === "Fading Contender") result = "Purgatory";
    } else if (playoffOdds < 15) {
      if (above("Elite", "True Contender", "Almost There")) result = "Rebuilder";
      if (result === "Fading Contender") result = "Purgatory";
    } else if (playoffOdds < 50) {
      if (above("Elite", "True Contender")) result = "Almost There";
    }
  }

  return result;
};

// ── Roster direction profile ──────────────────────────────────

/** Computes the full roster direction profile for one roster within a league. */
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
  const n         = rosters.length;
  const pickList  = (ownedPicks || []).filter((pick: any) => Number(pick.owner_id) === Number(rosterId));
  const firstRounders         = pickList.filter((pick: any) => Number(pick.round) === 1);
  const currentYearFirsts     = firstRounders.filter((pick: any) => String(pick.season) === CURRENT_YEAR);
  const premiumCurrentFirsts  = currentYearFirsts.filter((pick: any) => {
    const slot = String(pick.slot || "");
    if (!slot.includes(".")) return false;
    const [, rawPick] = slot.split(".");
    return Number(rawPick) > 0 && Number(rawPick) <= 6;
  });
  const futureFirsts = firstRounders.filter((pick: any) => String(pick.season) !== CURRENT_YEAR);
  const pickTotal    = pickList.reduce(
    (s: number, pick: any) => s + getStoredPickValue(pickValues, pick),
    0
  );

  const rosterPlayers = (targetRoster.players || [])
    .map((id: string) => {
      const player = players?.[id];
      return player
        ? { ...player, dynValue: dynastyValueForPlayer(id), redValue: redraftValues?.[id] || 0 }
        : null;
    })
    .filter(Boolean);

  const skillPlayers   = rosterPlayers.filter((p: any) => positions.includes(p.position));
  const topDynastyCore = [...skillPlayers]
    .sort((a: any, b: any) => b.dynValue - a.dynValue)
    .slice(0, 8);

  const coreAge      = average(topDynastyCore.map((p: any) => Number(p.age)).filter(Boolean));
  const oldCoreCount = topDynastyCore.filter((p: any) => {
    if (!p.age) return false;
    if (p.position === "QB") return p.age >= 30;
    if (p.position === "RB") return p.age >= 26;
    return p.age >= 29;
  }).length;
  const youngCoreCount = topDynastyCore.filter(
    (p: any) => Number(p.age) > 0 && Number(p.age) <= 24
  ).length;

  const rosterDynVal = rosters
    .map((roster: any) => ({
      roster_id: roster.roster_id,
      val:
        (roster.players || []).reduce(
          (s: number, id: string) => s + dynastyValueForPlayer(id),
          0
        ) +
        (ownedPicks || [])
          .filter((pick: any) => Number(pick.owner_id) === Number(roster.roster_id))
          .reduce((s: number, pick: any) => s + getStoredPickValue(pickValues, pick), 0),
    }))
    .sort((a: any, b: any) => b.val - a.val);

  const rosterRedVal = rosters
    .map((roster: any) => ({
      roster_id: roster.roster_id,
      val: (roster.players || []).reduce(
        (s: number, id: string) => s + (redraftValues?.[id] || 0),
        0
      ),
    }))
    .sort((a: any, b: any) => b.val - a.val);

  const standingsSorted = [...rosters].sort((a: any, b: any) => {
    const aw = a.settings?.wins || 0;
    const bw = b.settings?.wins || 0;
    return bw !== aw ? bw - aw : (b.settings?.fpts || 0) - (a.settings?.fpts || 0);
  });
  const maxPfSorted = [...rosters].sort(
    (a: any, b: any) => (b.settings?.fpts_max || 0) - (a.settings?.fpts_max || 0)
  );

  const dynRank   = rosterDynVal.findIndex((r: any) => Number(r.roster_id) === Number(rosterId)) + 1;
  const redRank   = rosterRedVal.findIndex((r: any) => Number(r.roster_id) === Number(rosterId)) + 1;
  const standRank = standingsSorted.findIndex((r: any) => Number(r.roster_id) === Number(rosterId)) + 1;
  const maxPfRank = maxPfSorted.findIndex((r: any) => Number(r.roster_id) === Number(rosterId)) + 1;
  const { bucket, bucketColor } = getLeagueDirectionBucket(dynRank, redRank, n);

  const positionTotals = positions.reduce((acc: Record<string, number>, pos) => {
    acc[pos] = skillPlayers
      .filter((p: any) => p.position === pos)
      .reduce((s: number, p: any) => s + p.dynValue, 0);
    return acc;
  }, {});

  const positionRanks = positions.map((pos) => {
    const leagueTotals = rosters.map((roster: any) =>
      (roster.players || []).reduce((s: number, id: string) => {
        const player = players?.[id];
        if (!player || player.position !== pos) return s;
        return s + dynastyValueForPlayer(id);
      }, 0)
    );
    return {
      pos,
      total: positionTotals[pos],
      rank: rankAgainstLeague(leagueTotals, positionTotals[pos]),
    };
  });

  const strongThreshold = Math.max(2, Math.ceil(n / 3));
  const weakThreshold   = Math.max(strongThreshold + 1, n - 2);
  const strengths = positionRanks
    .filter((e) => e.rank <= strongThreshold)
    .sort((a, b) => a.rank - b.rank)
    .map((e) => `${e.pos} strength (${ordinal(e.rank)} of ${n})`);
  const concerns = positionRanks
    .filter((e) => e.rank >= weakThreshold)
    .sort((a, b) => b.rank - a.rank)
    .map((e) => `${e.pos} needs help (${ordinal(e.rank)} of ${n})`);

  if (pickTotal >= 3500 || futureFirsts.length >= 2) {
    strengths.push(`Strong draft capital (${firstRounders.length} firsts)`);
  } else if (firstRounders.length <= 1 && pickTotal < 1500) {
    concerns.push("Thin future draft capital");
  }
  if (youngCoreCount >= 4) strengths.push(`Young core (avg age ${coreAge || "-"})`);
  if (oldCoreCount   >= 4) concerns.push("Core is aging");

  const weakestPos   = [...positionRanks].sort((a, b) => b.rank - a.rank)[0]?.pos || "RB";
  const strongestPos = [...positionRanks].sort((a, b) => a.rank - b.rank)[0]?.pos || "WR";
  const agingSellPos =
    oldCoreCount > 0
      ? (
          ["RB", "WR", "TE", "QB"].find((pos) =>
            topDynastyCore.some(
              (p: any) =>
                p.position === pos &&
                ((pos === "RB" && Number(p.age) >= 26) ||
                 (pos === "QB" && Number(p.age) >= 30) ||
                 ((pos === "WR" || pos === "TE") && Number(p.age) >= 29))
            )
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
    case "Window Closing":
      summary = "You are winning today but the foundation is thin. Push the window hard now — do not sacrifice more future equity.";
      actions = [
        `Target a proven ${weakestPos} without giving up picks`,
        "Consolidate aging surplus into one proven difference-maker",
        "Avoid burning future firsts — your next window will need them",
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
    case "Stranded":
      summary = "Neither the future nor the present is working. Convert aging assets into picks before this window fully closes.";
      actions = [
        `Move aging ${agingSellPos} pieces for firsts or young ${weakestPos} value`,
        "Take multi-asset packages over single declining veterans",
        "Keep young anchors and widen the value base before pressing again",
      ];
      break;
    case "Fading Out":
      summary = "This roster lacks both present production and long-term assets. A deliberate reset with focus is the best path.";
      actions = [
        "Prioritize first-rounders and young QB/WR assets",
        `Sell any productive ${agingSellPos} pieces before the market cools`,
        "Avoid buying redraft floor until the dynasty foundation is set",
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
    concerns:  concerns.slice(0, 3),
    positionRanks,
    coreAge,
    youngCoreCount,
    oldCoreCount,
    pickTotal,
    firstRounders:        firstRounders.length,
    premiumCurrentFirsts: premiumCurrentFirsts.length,
    futureFirsts:         futureFirsts.length,
  };
};

// ── Position bucket helpers ───────────────────────────────────

/** Returns { strong, weak } position arrays for a given profile,
 *  used by trade fit scoring. */
export const getProfilePosBuckets = (profile: any) => {
  const positions     = profile?.positionRanks || [];
  const n             = profile?.n || 12;
  const strongThreshold = Math.max(2, Math.ceil(n / 3));
  const weakThreshold   = Math.max(strongThreshold + 1, n - 2);
  return {
    strong: positions
      .filter((e: any) => e.rank <= strongThreshold)
      .map((e: any) => e.pos),
    weak: positions
      .filter((e: any) => e.rank >= weakThreshold)
      .map((e: any) => e.pos),
  };
};

// ── Trade fit ─────────────────────────────────────────────────

/** Short text label for a numeric trade fit score. */
export const getLeagueMateMotivation = (profile: any, tradeCount30d: number): string => {
  if (!profile) return "No clear read yet.";
  const activeTrader = tradeCount30d >= 2 ? " Active trader lately." : "";
  switch (profile.bucket) {
    case "Elite":
    case "True Contender":
      return `Likely buying weekly points and lineup upgrades.${activeTrader}`;
    case "Almost There":
      return `Probably open to a focused win-now patch without burning the whole future.${activeTrader}`;
    case "Window Closing":
      return `In win-now mode — should be receptive to current production before the window shuts.${activeTrader}`;
    case "Rebuilder":
    case "Stranded":
    case "Fading Out":
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

export const getTradePartnerFitLabel = (fitScore: number): string => {
  if (fitScore >= 34) return "Best Trade Partner";
  if (fitScore >= 24) return "Strong Fit";
  if (fitScore >= 14) return "Solid Fit";
  if (fitScore < 4)   return "Tough Fit";
  return "Neutral Fit";
};

/** Scores how well two rosters fit as trade partners based on position overlap
 *  and strategic bucket alignment. */
export const getTradePartnerFit = ({ myProfile, oppProfile, tradeCount30d }: any) => {
  if (!myProfile || !oppProfile) {
    return { fitScore: 0, fitLabel: "Neutral Fit", fitReasons: [] as string[] };
  }

  const myBuckets  = getProfilePosBuckets(myProfile);
  const oppBuckets = getProfilePosBuckets(oppProfile);

  const overlapToBuy   = myBuckets.weak.filter((pos: string) => oppBuckets.strong.includes(pos));
  const overlapToSell  = myBuckets.strong.filter((pos: string) => oppBuckets.weak.includes(pos));
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

  const iAmBuying  = ["Elite", "True Contender", "Almost There", "Window Closing"].includes(myProfile.bucket);
  const iAmSelling = ["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(myProfile.bucket);
  const oppBuying  = ["Elite", "True Contender", "Almost There", "Window Closing"].includes(oppProfile.bucket);
  const oppSelling = ["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(oppProfile.bucket);

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
    fitLabel:   getTradePartnerFitLabel(fitScore),
    fitReasons: fitReasons.slice(0, 3),
  };
};

/** Cross-league position preference fit — how well the partner's
 *  roster-building pattern across all their leagues aligns with yours. */
export const getCrossLeaguePreferenceFit = ({ myProfile, crossLeagueIntel }: any) => {
  if (!myProfile || !crossLeagueIntel || (crossLeagueIntel.totalDynastyLeagues || 0) < 2) {
    return { fitScore: 0, fitReasons: [] as string[] };
  }

  const myBuckets          = getProfilePosBuckets(myProfile);
  const preferredPositions = crossLeagueIntel.preferredPositions || [];
  const overlappingStrengths = myBuckets.strong.filter((pos: string) =>
    preferredPositions.includes(pos)
  );
  const fitReasons: string[] = [];
  let fitScore = 0;

  if (overlappingStrengths.length > 0) {
    fitScore += overlappingStrengths.length * 7;
    fitReasons.push(
      `Across leagues they keep collecting ${overlappingStrengths.join("/")} assets`
    );
  }
  if (
    (crossLeagueIntel.youngQbWrRate || 0) >= 0.22 &&
    myBuckets.strong.some((pos: string) => ["QB", "WR"].includes(pos))
  ) {
    fitScore += 5;
    fitReasons.push("They show a clear bias toward young QB/WR insulation");
  }
  if (
    (crossLeagueIntel.veteranRbRate || 0) >= 0.12 &&
    myBuckets.strong.includes("RB")
  ) {
    fitScore += 4;
    fitReasons.push("They repeatedly roster veteran RB production");
  }
  if ((crossLeagueIntel.totalDynastyLeagues || 0) >= 6) fitScore += 2;

  return { fitScore, fitReasons: fitReasons.slice(0, 2) };
};

/** Cross-league trade behavior fit — how well the partner's actual
 *  trade history across leagues aligns with what you can offer. */
export const getCrossLeagueTradeBehaviorFit = ({ myProfile, crossLeagueIntel }: any) => {
  if (
    !myProfile ||
    !crossLeagueIntel ||
    (crossLeagueIntel.crossLeagueTradeCount30d || 0) <= 0
  ) {
    return { fitScore: 0, fitReasons: [] as string[] };
  }

  const myBuckets               = getProfilePosBuckets(myProfile);
  const tradePreferredPositions = crossLeagueIntel.tradePreferredPositions || [];
  const fitReasons: string[]    = [];
  let fitScore = 0;

  const overlappingStrengths = myBuckets.strong.filter((pos: string) =>
    tradePreferredPositions.includes(pos)
  );
  if (overlappingStrengths.length > 0) {
    fitScore += overlappingStrengths.length * 8;
    fitReasons.push(
      `They actively trade for ${overlappingStrengths.join("/")} across leagues`
    );
  }
  if (
    (crossLeagueIntel.youngQbWrBuyRate || 0) >= 0.2 &&
    myBuckets.strong.some((pos: string) => ["QB", "WR"].includes(pos))
  ) {
    fitScore += 5;
    fitReasons.push("Their recent deals skew toward young QB/WR insulation");
  }
  if (
    (crossLeagueIntel.veteranRbBuyRate || 0) >= 0.15 &&
    myBuckets.strong.includes("RB")
  ) {
    fitScore += 4;
    fitReasons.push("They have been paying for veteran RB production");
  }
  if ((crossLeagueIntel.crossLeagueTradeCount30d || 0) >= 4) fitScore += 3;

  return { fitScore, fitReasons: fitReasons.slice(0, 2) };
};
