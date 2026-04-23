import { CURRENT_YEAR } from "../season";
import { average, ordinal, rankAgainstLeague } from "../math";
import { getStoredPickValue } from "../picks";
import type { RosterDirectionProfile, CrossLeagueIntel } from "../../types";
import { getLeagueDirectionBucket } from "./bucket";

/** Minimal player shape needed inside getRosterDirectionProfile. */
interface DirectionPlayer {
  player_id?: string;
  position?: string;
  age?: number | null;
  dynValue?: number;
  redValue?: number;
}

/** Minimal pick shape needed for pick-value aggregation in direction profile. */
interface PickLike {
  season?: string | number;
  round?: number;
  owner_id?: string | number;
  slot?: string;
}

/** Minimal roster shape needed for direction profile computation. */
interface RosterLike {
  roster_id?: number;
  players?: string[];
  settings?: {
    wins?: number;
    losses?: number;
    fpts?: number;
    fpts_max?: number;
  };
}

/** Computes the full roster direction profile for one roster within a league. */
export const getRosterDirectionProfile = ({
  rosterId,
  rosters,
  ownedPicks,
  players,
  pickValues,
  redraftValues,
  dynastyValueForPlayer,
}: {
  rosterId: number;
  rosters: RosterLike[];
  ownedPicks: PickLike[];
  players: Record<string, DirectionPlayer>;
  pickValues: Record<string, number>;
  redraftValues: Record<string, number>;
  dynastyValueForPlayer: (id: string) => number;
}) => {
  if (!rosterId || !rosters?.length) return null;

  const targetRoster = rosters.find((r: RosterLike) => Number(r.roster_id) === Number(rosterId));
  if (!targetRoster) return null;

  const positions = ["QB", "RB", "WR", "TE"];
  const n         = rosters.length;
  const pickList  = (ownedPicks || []).filter((pick: PickLike) => Number(pick.owner_id) === Number(rosterId));
  const firstRounders         = pickList.filter((pick: PickLike) => Number(pick.round) === 1);
  const currentYearFirsts     = firstRounders.filter((pick: PickLike) => String(pick.season) === CURRENT_YEAR);
  const premiumCurrentFirsts  = currentYearFirsts.filter((pick: PickLike) => {
    const slot = String(pick.slot || "");
    if (!slot.includes(".")) return false;
    const [, rawPick] = slot.split(".");
    return Number(rawPick) > 0 && Number(rawPick) <= 6;
  });
  const futureFirsts = firstRounders.filter((pick: PickLike) => String(pick.season) !== CURRENT_YEAR);
  const pickTotal    = pickList.reduce(
    (s: number, pick: PickLike) => s + getStoredPickValue(pickValues, pick),
    0
  );

  type EnrichedPlayer = DirectionPlayer & { dynValue: number; redValue: number };
  const rosterPlayers = (targetRoster.players || [])
    .map((id: string) => {
      const player = players?.[id];
      return player
        ? { ...player, dynValue: dynastyValueForPlayer(id), redValue: redraftValues?.[id] || 0 }
        : null;
    })
    .filter((p): p is EnrichedPlayer => p !== null);

  const skillPlayers   = rosterPlayers.filter((p) => positions.includes(p.position ?? ""));
  const topDynastyCore = [...skillPlayers]
    .sort((a, b) => b.dynValue - a.dynValue)
    .slice(0, 8);

  const coreAge      = average(topDynastyCore.map((p) => Number(p.age)).filter(Boolean));
  const oldCoreCount = topDynastyCore.filter((p) => {
    if (!p.age) return false;
    if (p.position === "QB") return p.age >= 30;
    if (p.position === "RB") return p.age >= 26;
    return p.age >= 29;
  }).length;
  const youngCoreCount = topDynastyCore.filter(
    (p) => Number(p.age) > 0 && Number(p.age) <= 24
  ).length;

  const rosterDynVal = rosters
    .map((roster: RosterLike) => ({
      roster_id: roster.roster_id,
      val:
        (roster.players || []).reduce(
          (s: number, id: string) => s + dynastyValueForPlayer(id),
          0
        ) +
        (ownedPicks || [])
          .filter((pick: PickLike) => Number(pick.owner_id) === Number(roster.roster_id))
          .reduce((s: number, pick: PickLike) => s + getStoredPickValue(pickValues, pick), 0),
    }))
    .sort((a, b) => b.val - a.val);

  const rosterRedVal = rosters
    .map((roster: RosterLike) => ({
      roster_id: roster.roster_id,
      val: (roster.players || []).reduce(
        (s: number, id: string) => s + (redraftValues?.[id] || 0),
        0
      ),
    }))
    .sort((a, b) => b.val - a.val);

  const standingsSorted = [...rosters].sort((a: RosterLike, b: RosterLike) => {
    const aw = a.settings?.wins || 0;
    const bw = b.settings?.wins || 0;
    return bw !== aw ? bw - aw : (b.settings?.fpts || 0) - (a.settings?.fpts || 0);
  });
  const maxPfSorted = [...rosters].sort(
    (a: RosterLike, b: RosterLike) => (b.settings?.fpts_max || 0) - (a.settings?.fpts_max || 0)
  );

  const dynRank   = rosterDynVal.findIndex((r) => Number(r.roster_id) === Number(rosterId)) + 1;
  const redRank   = rosterRedVal.findIndex((r) => Number(r.roster_id) === Number(rosterId)) + 1;
  const standRank = standingsSorted.findIndex((r: RosterLike) => Number(r.roster_id) === Number(rosterId)) + 1;
  const maxPfRank = maxPfSorted.findIndex((r: RosterLike) => Number(r.roster_id) === Number(rosterId)) + 1;
  const { bucket, bucketColor } = getLeagueDirectionBucket(dynRank, redRank, n);

  const positionTotals = positions.reduce((acc: Record<string, number>, pos) => {
    acc[pos] = skillPlayers
      .filter((p) => p.position === pos)
      .reduce((s: number, p) => s + p.dynValue, 0);
    return acc;
  }, {});

  const positionRanks = positions.map((pos) => {
    const leagueTotals = rosters.map((roster: RosterLike) =>
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
              (p) =>
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

/** Returns { strong, weak } position arrays for a given profile,
 *  used by trade fit scoring. */
export const getProfilePosBuckets = (profile: RosterDirectionProfile | null | undefined) => {
  const positions     = profile?.positionRanks || [];
  const n             = profile?.n || 12;
  const strongThreshold = Math.max(2, Math.ceil(n / 3));
  const weakThreshold   = Math.max(strongThreshold + 1, n - 2);
  return {
    strong: positions
      .filter((e) => e.rank <= strongThreshold)
      .map((e) => e.pos),
    weak: positions
      .filter((e) => e.rank >= weakThreshold)
      .map((e) => e.pos),
  };
};

/** Short text label for a numeric trade fit score. */
export const getLeagueMateMotivation = (profile: RosterDirectionProfile | null | undefined, tradeCount30d: number): string => {
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
export const getTradePartnerFit = ({ myProfile, oppProfile, tradeCount30d }: { myProfile: RosterDirectionProfile | null | undefined; oppProfile: RosterDirectionProfile | null | undefined; tradeCount30d: number }) => {
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
export const getCrossLeaguePreferenceFit = ({ myProfile, crossLeagueIntel }: { myProfile: RosterDirectionProfile | null | undefined; crossLeagueIntel: CrossLeagueIntel | null | undefined }) => {
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
export const getCrossLeagueTradeBehaviorFit = ({ myProfile, crossLeagueIntel }: { myProfile: RosterDirectionProfile | null | undefined; crossLeagueIntel: CrossLeagueIntel | null | undefined }) => {
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
