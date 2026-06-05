import { CURRENT_YEAR } from "../../../lib/helpers";
import type { AugmentedPick, SleeperPlayer, SleeperRoster } from "../../../lib/types";
import {
  isAgingAsset, isOldProducerBuy, isYoungBuildingBlock,
  isFutureInsulationAsset, isPremiumCurrentPick,
} from "../FinderScoring";
import { buildPostTradePlayers } from "../finderUtils";
import type { MarketSignal, TradeResult } from "../finderTypes";
import { valueBearingGive } from "../finderTypes";
import type { PlayerWithValue } from "../shared";

export interface ScoringFactorsParams {
  finderDirection: string;
  iAmTankingFinder: boolean;
  draftCapitalMode: boolean;
  myFinderPlayoffOdds: number;
  weakPositions: Set<string>;
  strongPositions: Set<string>;
  myT: Record<string, number>;
  numTeams: number;
  allTeamPosTotals: Record<string, number>[];
  starterSlots: string[];
  starterCounts: Record<string, number>;
  hasSuperFlex: boolean;
  hasFlex: boolean;
  myPlayers: PlayerWithValue[];
  myRoster: SleeperRoster | undefined;
  rosterById: Map<number, SleeperRoster>;
  rosterPlayers: (roster: SleeperRoster | null | undefined) => PlayerWithValue[];
  allPicks: AugmentedPick[];
  redraftValues: Record<string, number>;
  marketSignalMap: Map<string, MarketSignal>;
  players: Record<string, SleeperPlayer>;
  calcFcValues: Record<string, number>;
}

export function createScoringFactors({
  finderDirection,
  iAmTankingFinder,
  draftCapitalMode,
  myFinderPlayoffOdds,
  weakPositions,
  strongPositions,
  myT,
  numTeams,
  allTeamPosTotals,
  starterSlots,
  starterCounts,
  hasSuperFlex,
  hasFlex,
  myPlayers,
  myRoster,
  rosterById,
  rosterPlayers,
  allPicks,
  redraftValues,
  marketSignalMap,
  players,
  calcFcValues,
}: ScoringFactorsParams) {

  const playerTradeScore = (player: PlayerWithValue) =>
    (redraftValues[player?.player_id] ?? 0) * 2 + (player?.value ?? 0);

  const evaluateLineupSafety = (rosterPlayersList: PlayerWithValue[], relaxed = false) => {
    const available = [...rosterPlayersList].sort(
      (a, b) => playerTradeScore(b) - playerTradeScore(a)
    );
    const usedIds = new Set<string>();
    const lineup: Array<{ slot: string; player: PlayerWithValue | null; score: number }> = [];

    const claimBest = (eligiblePositions: string[], slot: string) => {
      const idx = available.findIndex(
        (player) =>
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

    const bench = available.filter((player) => !usedIds.has(player.player_id));
    const benchCounts = bench.reduce((acc: Record<string, number>, player) => {
      acc[player.position] = (acc[player.position] || 0) + 1;
      return acc;
    }, {});

    const emptySlots = lineup.filter((slot) => !slot.player).length;
    const lineupScore = lineup.reduce((sum, slot) => sum + slot.score, 0);
    const reserveFlex = bench.filter((p) => ["RB", "WR", "TE"].includes(p.position)).length;
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
    const myAfterPlayers = buildPostTradePlayers(myRoster, trade.give, trade.receive, players, calcFcValues);
    const oppRoster = rosterById.get(Number(trade.oppRosterId));
    const oppBeforePlayers = rosterPlayers(oppRoster);
    const oppAfterPlayers = buildPostTradePlayers(oppRoster, trade.receive, trade.give, players, calcFcValues);
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

    const contenderBuckets = new Set(["Elite", "True Contender", "Almost There", "Fading Contender", "Window Closing"]);
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

  const leagueRank = (pos: string, total: number) => {
    const sorted = allTeamPosTotals.map((t) => t[pos] || 0).sort((a, b) => b - a);
    let rank = 1;
    for (const t of sorted) { if (total >= t) break; rank++; }
    return Math.min(rank, numTeams);
  };

  const posScore = (givePL: PlayerWithValue[], receivePL: PlayerWithValue[]) => {
    const postT: Record<string, number> = { ...myT };
    givePL.forEach((p) => { postT[p.position] = (postT[p.position] || 0) - p.value; });
    receivePL.forEach((p) => { postT[p.position] = (postT[p.position] || 0) + p.value; });

    let score = 0;
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const beforeRank = leagueRank(pos, myT[pos] || 0);
      const afterRank  = leagueRank(pos, postT[pos] || 0);
      const rankDelta  = beforeRank - afterRank; // positive = moved up (improved)

      const wasWeak = beforeRank > Math.floor(numTeams / 2);
      score += rankDelta * (wasWeak && rankDelta > 0 ? 3 : 2);

      const drop = afterRank - beforeRank;
      if (drop >= 3) score -= drop * 2.5;
      if (afterRank >= Math.max(8, numTeams - 2)) score -= 4;
      if (afterRank === numTeams) score -= 5;
    }
    return score;
  };

  const getDirectionTradeScore = (trade: TradeResult) => {
    const outgoingPlayers = valueBearingGive(trade); // strip value-neutral sweetener
    const incomingPlayers = trade.receive || [];
    const outgoingPicks = trade.givePicks || [];
    const incomingPicks = trade.receivePicks || [];
    const outgoingRedraft = outgoingPlayers.reduce((sum: number, p) => sum + (redraftValues[p.player_id] || 0), 0);
    const incomingRedraft = incomingPlayers.reduce((sum: number, p) => sum + (redraftValues[p.player_id] || 0), 0);
    const outgoingDynasty = outgoingPlayers.reduce((sum: number, p) => sum + p.value, 0);
    const incomingDynasty = incomingPlayers.reduce((sum: number, p) => sum + p.value, 0);
    const weakPosAdds = incomingPlayers.filter((p) => weakPositions.has(p.position)).length;
    const weakPosLosses = outgoingPlayers.filter((p) => weakPositions.has(p.position)).length;
    const strongPosSells = outgoingPlayers.filter((p) => strongPositions.has(p.position)).length;
    const agingSells = outgoingPlayers.filter((p) => isAgingAsset(p)).length;
    const youngCoreBuys = incomingPlayers.filter((p) => isYoungBuildingBlock(p)).length;
    const picksIn = incomingPicks.reduce((sum: number, p) => sum + p.value, 0);
    const picksOut = outgoingPicks.reduce((sum: number, p) => sum + p.value, 0);
    const premiumCurrentPicksOut = outgoingPicks.filter((p) => isPremiumCurrentPick(p)).length;
    const futureFirstsIn = incomingPicks.filter((p) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
    const oldProducerBuys = incomingPlayers.filter((p) => isOldProducerBuy(p)).length;
    const oldProducerSells = outgoingPlayers.filter((p) => isOldProducerBuy(p)).length;
    const insulationBuys = incomingPlayers.filter((p) => isFutureInsulationAsset(p)).length;
    const insulationSells = outgoingPlayers.filter((p) => isFutureInsulationAsset(p)).length;
    const currentPlayerCapitalOut = outgoingPlayers.reduce((sum: number, p) => {
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

    if (iAmTankingFinder) {
      score += oldProducerSells * 10;
      score += agingSells * 8;
      score += insulationBuys * 9;
      score += youngCoreBuys * 8;
      score += futureFirstsIn * 14;
      score += picksIn / 150;
      score -= outgoingPicks.length * 10;
      score -= picksOut / 150;
      score -= premiumCurrentPicksOut * 18;
      score -= oldProducerBuys * 18;
      score -= incomingPlayers.filter((p) => p.position === "RB" && Number(p.age || 0) >= 25).length * 8;
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
      score -= incomingPlayers.filter((p) => p.position === "RB" && Number(p.age || 0) >= 28).length * 4;
      // RBs injure most often and are hardest to replace off waivers.
      // Contending teams should value RB depth even when RB is already a "strong" position.
      score += incomingPlayers.filter((p) =>
        p.position === "RB" && Number(p.age || 0) >= 22 && Number(p.age || 0) <= 26
      ).length * 4;
    } else if (["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(finderDirection)) {
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
      score -= incomingPlayers.filter((p) => p.position === "RB" && Number(p.age || 0) >= 25).length * 7;
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
    if (trade.draftCapital && !["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(finderDirection) && !iAmTankingFinder) score -= 3;

    // Market signal bonuses — reward trades that align with buy/sell momentum.
    const sellHighGive    = outgoingPlayers.filter((p) => marketSignalMap.get(p.player_id) === "SELL_HIGH").length;
    const buyLowReceive   = incomingPlayers.filter((p) => marketSignalMap.get(p.player_id) === "BUY_LOW").length;
    const liquidGive      = outgoingPlayers.filter((p) => ["SELL_HIGH", "LIQUID"].includes(marketSignalMap.get(p.player_id) ?? "")).length;
    const liquidReceive   = incomingPlayers.filter((p) => ["BUY_LOW", "LIQUID"].includes(marketSignalMap.get(p.player_id) ?? "")).length;
    score += sellHighGive  * 7;
    score += buyLowReceive * 7;
    score += liquidGive    * 2;
    score += liquidReceive * 2;

    return score;
  };

  const getTradeIntent = (trade: TradeResult) => {
    const outgoingPlayers = trade.give || [];
    const incomingPlayers = trade.receive || [];
    const outgoingPicks = trade.givePicks || [];
    const incomingPicks = trade.receivePicks || [];
    const outgoingOldProducers = outgoingPlayers.filter((p) => isOldProducerBuy(p)).length;
    const incomingOldProducers = incomingPlayers.filter((p) => isOldProducerBuy(p)).length;
    const incomingInsulation = incomingPlayers.filter((p) => isFutureInsulationAsset(p)).length;
    const outgoingInsulation = outgoingPlayers.filter((p) => isFutureInsulationAsset(p)).length;
    const weakPosAdds = incomingPlayers.filter((p) => weakPositions.has(p.position)).length;
    const strongPosSells = outgoingPlayers.filter((p) => strongPositions.has(p.position)).length;
    const futureFirstsIn = incomingPicks.filter((p) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
    const playerCountDelta =
      outgoingPlayers.length + outgoingPicks.length - incomingPlayers.length - incomingPicks.length;
    const incomingBest = [...incomingPlayers].sort((a, b) => b.value - a.value)[0];
    const outgoingBest = [...outgoingPlayers].sort((a, b) => b.value - a.value)[0];

    if (incomingPicks.length > 0 && incomingPlayers.length === 0) {
      return { label: "Pick Accumulation", detail: "Turning player value into future insulation and draft capital." };
    }
    if (outgoingPicks.length > 0 && incomingPlayers.length > 0 && weakPosAdds > 0) {
      return { label: "Pick-For-Points", detail: "Using picks to patch a lineup need with immediate player help." };
    }
    // iAmTankingFinder takes priority — even a "True Contender" bucket team at 0% is a seller
    if (iAmTankingFinder && outgoingOldProducers > 0 && (incomingPicks.length > 0 || incomingInsulation > 0)) {
      return {
        label: "Tank Sell",
        detail: `At ${Math.round(myFinderPlayoffOdds)}% playoff odds, converting floor production into draft capital maximizes future pick position without sacrificing cornerstone pieces.`,
      };
    }
    if (!iAmTankingFinder && ["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(finderDirection) && outgoingOldProducers > 0 && (futureFirstsIn > 0 || incomingInsulation > 0)) {
      return { label: "Rebuild Sell", detail: "Selling present points for youth, insulation, or future firsts." };
    }
    if (!iAmTankingFinder && ["Elite", "True Contender", "Almost There"].includes(finderDirection) && incomingOldProducers > 0 && weakPosAdds > 0) {
      return { label: "Win-Now Patch", detail: "Buying immediate production where your current lineup needs help." };
    }
    if (incomingBest && outgoingBest && incomingBest.value > outgoingBest.value && playerCountDelta > 0) {
      return { label: "Tier-Up", detail: "Condensing depth into one stronger difference-maker." };
    }
    if (incomingInsulation > outgoingInsulation && incomingOldProducers === 0) {
      return { label: "Insulation Buy", detail: "Shifting value into younger assets that better fit a long-term build." };
    }
    if (strongPosSells > 0 && weakPosAdds > 0) {
      return { label: "Strength-For-Need", detail: "Using excess at a strong position to solve a weaker room." };
    }
    if (playerCountDelta > 0 && incomingPlayers.length > 0) {
      return { label: "Consolidation", detail: "Shrinking asset count to clean up your lineup and bench shape." };
    }
    if (playerCountDelta < 0 && incomingPlayers.length > 1) {
      return { label: "Depth Split", detail: "Breaking one concentrated asset into multiple usable pieces." };
    }
    if (incomingInsulation > 0 && outgoingOldProducers > 0) {
      return { label: "Age-Down Bet", detail: "Moving from older production into a younger value window." };
    }
    return { label: "Value Rebalance", detail: "A balanced value move that changes roster shape more than headline value." };
  };

  const failsDirectionGuardrail = (trade: TradeResult) => {
    const incomingPlayers = trade.receive || [];
    const incomingPicks = trade.receivePicks || [];

    // iAmTankingFinder covers ALL seller/rebuild cases regardless of bucket label.
    const isEffectiveSeller = iAmTankingFinder || ["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(finderDirection);
    const isEffectiveContender = !iAmTankingFinder && ["Elite", "True Contender", "Almost There", "Window Closing"].includes(finderDirection);

    if (isEffectiveSeller) {
      const outgoingPicksGuard = trade.givePicks || [];
      if (outgoingPicksGuard.length > 0 && incomingPlayers.length > 0) {
        const incomingAllYoung = incomingPlayers.every((p) => isFutureInsulationAsset(p));
        const myTotalPickCount = allPicks.filter(
          (p) => Number(p.owner_id) === Number(myRoster?.roster_id)
        ).length;
        const hasExcessPicks = myTotalPickCount >= 8;
        const allOutgoingPicksLate = outgoingPicksGuard.every((p) => Number(p.round) >= 3);
        if (!incomingAllYoung && !hasExcessPicks && !allOutgoingPicksLate) return true;
      }
    }

    if (isEffectiveContender) {
      if (incomingPlayers.length === 0 && incomingPicks.length > 0) return true;
    }

    return false;
  };

  return {
    playerTradeScore,
    evaluateLineupSafety,
    getTradeLineupSafety,
    leagueRank,
    posScore,
    getDirectionTradeScore,
    getTradeIntent,
    failsDirectionGuardrail,
  };
}
