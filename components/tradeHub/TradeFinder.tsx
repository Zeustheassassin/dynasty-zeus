"use client";
import React, { useState, useMemo, useDeferredValue, startTransition } from "react";
import {
  getStoredPickValue,
  getSeasonYear,
} from "../../lib/helpers";

import type {
  TradeAttempt,
  SleeperPlayer, SleeperRoster, SleeperUser,
  AugmentedPick,
  LeagueMateView, TradePartnerRanking, HistoricalSnapshot,
  FcTrendEntry,
} from "../../lib/types";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { createScoringFactors } from "./hooks/useScoringFactors";
import { FinderSearchInput } from "./FinderSearch";
import FinderResults from "./FinderResults";
import { FinderDirectionPanel } from "./FinderDirectionPanel";
import {
  isOldProducerBuy, isFutureInsulationAsset,
  packageOk, posTotals, isBalanced,
} from "./FinderScoring";
import {
  finderPickKey,
  buildPostTradePlayers as buildPostTradePlayersUtil,
  getNFLDepthIdx as getNFLDepthIdxUtil,
  computePosRank as computePosRankUtil,
} from "./finderUtils";
import type { MarketSignal, TradeResult } from "./finderTypes";
import { YEARS } from "./shared";
import { runFinderPipeline } from "./finderPipeline";
import type { PlayerWithValue, PickWithValue } from "./shared";

// â”€â”€ Local types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€ Props â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface TradeFinderProps {
  finderSeed: number;
  setFinderSeed: React.Dispatch<React.SetStateAction<number>>;
  finderPinnedPlayerId: string | null;
  setFinderPinnedPlayerId: (id: string | null) => void;
  finderTargetOppRosterId: number | null;
  setFinderTargetOppRosterId: (id: number | null) => void;
  finderTargetPlayerId: string | null;
  setFinderTargetPlayerId: (id: string | null) => void;
  allPicks: AugmentedPick[];
  user: SleeperUser | null;
  selectedLeagueDraftHasOccurred: boolean;
  loadingCalcValues: boolean;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  leaguePlayerTags: Record<string, Record<string, "CORE" | "WANT_TO_TRADE">>;
  onToggleLeaguePlayerTag: (leagueId: string, playerId: string, forceTag?: "CORE" | "WANT_TO_TRADE") => void;
  leagueMateProfileByRosterId: Map<number, LeagueMateView>;
  selectedLeagueMateProfilesView: LeagueMateView[];
  tradePartnerRankings: TradePartnerRanking[];
  onRefreshDirection: () => void;
  buyLowPlayerIds: string[];
  ignoredOwnerIds: string[];
  nflState?: { week: number; season_type: string; season: string; display_week?: number } | null;
  playerStats?: Record<string, { avgTargets: number; avgCarries: number; snapPct: number; gamesPlayed: number; recentTargets?: number; recentCarries?: number; recentSnapPct?: number; targetTrend?: number; carryTrend?: number; snapTrend?: number }> | null;
  crossLeagueExposure?: Record<string, { count: number }> | null;
  historicalSnapshot: HistoricalSnapshot | null;
  projectionData?: { sleeperId: string; fpts: number }[] | null;
  setPlayerProfileId: (id: string | null) => void;
  tradeAttempts: TradeAttempt[];
  onMarkAttempted: (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => Promise<void>;
  sessionMarked: Set<string>;
  onSessionMark: (fingerprint: string) => void;
  setViewRosterRosterId: (id: number | null) => void;
  fcTrendData: FcTrendEntry[];
  setTradeHubSection: (section: "CALCULATOR" | "FINDER" | "RECOMMENDATIONS" | "TRADE_LOG" | "ATTEMPTS" | "MARKET") => void;
  setCalcOpponentRosterId: (id: number | null) => void;
  setCalcGive: React.Dispatch<React.SetStateAction<string[]>>;
  setCalcReceive: React.Dispatch<React.SetStateAction<string[]>>;
  setCalcGivePicks: React.Dispatch<React.SetStateAction<string[]>>;
  setCalcReceivePicks: React.Dispatch<React.SetStateAction<string[]>>;
  setCalcSearchA: (s: string) => void;
  setCalcSearchB: (s: string) => void;
}

// â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TradeFinder({
  finderSeed, setFinderSeed,
  finderPinnedPlayerId, setFinderPinnedPlayerId,
  finderTargetOppRosterId, setFinderTargetOppRosterId,
  finderTargetPlayerId, setFinderTargetPlayerId,
  allPicks,
  user,
  selectedLeagueDraftHasOccurred,
  loadingCalcValues,
  playerDispositions, leaguePlayerTags, onToggleLeaguePlayerTag,
  leagueMateProfileByRosterId, selectedLeagueMateProfilesView,
  tradePartnerRankings,
  onRefreshDirection,
  buyLowPlayerIds,
  ignoredOwnerIds,
  nflState,
  playerStats,
  crossLeagueExposure,
  historicalSnapshot,
  projectionData,
  setPlayerProfileId,
  tradeAttempts,
  onMarkAttempted,
  sessionMarked,
  onSessionMark,
  setViewRosterRosterId,
  fcTrendData,
  setTradeHubSection,
  setCalcOpponentRosterId,
  setCalcGive, setCalcReceive, setCalcGivePicks, setCalcReceivePicks,
  setCalcSearchA, setCalcSearchB,
}: TradeFinderProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();
  const {
    leagueAdjustedFcValues: calcFcValues,
    leagueAdjustedRedraftValues: redraftValues,
    pickFcValues,
    selectedLeagueDirectionAdjusted,
    selectedLeagueSimulation,
    selectedLeagueDynamicPickValues,
  } = useValues();

  // Weekly projection map: sleeperId â†’ projected fpts
  const finderWeeklyProjMap = useMemo(
    () => new Map<string, number>(
      (projectionData || []).map((row) => [String(row.sleeperId), Number(row.fpts || 0)])
    ),
    [projectionData]
  );

  // Per-roster player arrays with dynasty values pre-applied.
  const finderRosterPlayersMap = useMemo(() => {
    const calcVal = (id: string) => (calcFcValues as Record<string, number>)[id] ?? players[id]?.value ?? 0;
    const map = new Map<number, PlayerWithValue[]>();
    rosters.forEach((roster) => {
      map.set(
        roster.roster_id,
        (roster?.players || [])
          .map((id: string): PlayerWithValue | null => { const p = players[id]; return p ? { ...p, value: calcVal(id) } : null; })
          .filter((p): p is PlayerWithValue => !!p && ["QB", "RB", "WR", "TE"].includes(p.position) && p.value > 0)
          .sort((a, b) => b.value - a.value)
      );
    });
    return map;
  }, [rosters, players, calcFcValues]);

  const deferredFinderSeed          = useDeferredValue(finderSeed);
  const deferredPinnedPlayerId      = useDeferredValue(finderPinnedPlayerId);
  const deferredTargetPlayerId      = useDeferredValue(finderTargetPlayerId);
  const deferredTargetOppRosterId   = useDeferredValue(finderTargetOppRosterId);

  const finderMyRosterPlayers = useMemo(() => {
    const myRoster = rosters.find((r) => r.owner_id === user?.user_id);
    return myRoster ? finderRosterPlayersMap.get(myRoster.roster_id) ?? [] : [];
  }, [rosters, user, finderRosterPlayersMap]);

  const posTeamTotals = useMemo(() => {
    const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
    return rosters.map((r) => {
      const rosterPlayers = finderRosterPlayersMap.get(r.roster_id) ?? [];
      const totals: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
      rosterPlayers.forEach((p) => { if (POSITIONS.includes(p.position as typeof POSITIONS[number])) totals[p.position] += p.value; });
      return { rosterId: r.roster_id, totals };
    });
  }, [rosters, finderRosterPlayersMap]);

  // Thin wrapper over the shared finderUtils implementation (closes over posTeamTotals)
  // so the finder and useScoringFactors share one definition and can't drift.
  const computePosRank = (pos: string, rosterId: number, overrideTotal?: number): number =>
    computePosRankUtil(pos, rosterId, posTeamTotals, overrideTotal);

  const [directionRefreshing, setDirectionRefreshing] = useState(false);

  React.useEffect(() => {
    if (directionRefreshing && selectedLeagueDirectionAdjusted) setDirectionRefreshing(false);
  }, [directionRefreshing, selectedLeagueDirectionAdjusted]);

  // NFL depth chart map — sorted by depth_chart_order then dynasty value.
  const nflTeamDepth = useMemo(() => {
    const map = new Map<string, Record<string, PlayerWithValue[]>>();
    Object.values(players).forEach((p) => {
      if (!p.team || !["QB","RB","WR","TE"].includes(p.position)) return;
      if ((p.status ?? "").toLowerCase() === "retired") return;
      if (!map.has(p.team)) map.set(p.team, { QB: [], RB: [], WR: [], TE: [] });
      map.get(p.team)![p.position].push({ ...p, value: calcFcValues[p.player_id] ?? players[p.player_id]?.value ?? 0 });
    });
    map.forEach((posMap) => {
      Object.keys(posMap).forEach((pos) => {
        posMap[pos].sort((a, b) => {
          const oa = a.depth_chart_order ?? null;
          const ob = b.depth_chart_order ?? null;
          if (oa !== null && ob !== null) return oa - ob;
          if (oa !== null) return -1;
          if (ob !== null) return 1;
          return b.value - a.value;
        });
      });
    });
    return map;
  }, [players, calcFcValues]);

  // â”€â”€ Market signal map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const marketSignalMap = useMemo(() => {
    const LIQUID_THRESHOLD = 0.003;
    const TREND_THRESHOLD  = 150;
    const map = new Map<string, MarketSignal>();
    fcTrendData.forEach((entry) => {
      const isLiquid = entry.tradeFrequency >= LIQUID_THRESHOLD;
      if (!isLiquid) { map.set(entry.sleeperId, "NONE"); return; }
      if (entry.trend30Day <= -TREND_THRESHOLD) map.set(entry.sleeperId, "BUY_LOW");
      else if (entry.trend30Day >= TREND_THRESHOLD) map.set(entry.sleeperId, "SELL_HIGH");
      else map.set(entry.sleeperId, "LIQUID");
    });
    return map;
  }, [fcTrendData]);

  // Top-32 QB value floor
  const allQBsSorted = useMemo(() =>
    Object.values(players)
      .filter((p) => p.position === "QB")
      .map((p) => calcFcValues[p.player_id] ?? players[p.player_id]?.value ?? 0)
      .filter((v) => v > 0)
      .sort((a, b) => b - a),
    [players, calcFcValues]
  );
  const top32QBFloor = allQBsSorted[31] ?? 0;


  // Entire render-time finder pipeline hoisted into one memo so typing in the
  // search inputs (isolated components) and unrelated parent re-renders no longer
  // re-run the O(n²)+ trade-generation loops. Returns null while any gate is unmet;
  // the gate JSX is re-rendered at component level below (hooks can't be conditional).
  const finderModel = useMemo(() => {
      if (!selectedLeague || !selectedLeagueDirectionAdjusted || loadingCalcValues) return null;
      const finderSeasonYear = getSeasonYear(nflState);

      const finderPickLabel = (p: AugmentedPick) => {
        const via = p.roster_id !== p.owner_id ? ` (via ${users[p.roster_id] || `Team ${p.roster_id}`})` : "";
        const isSlotted = p.slot && String(p.slot).includes(".");
        const slotLabel = isSlotted
          ? `${p.season} ${p.slot}`
          : `${p.season} Rd ${p.round}`;
        const expectedSlot = !isSlotted
          ? (selectedLeagueDynamicPickValues[`${p.season}-${p.round}-${p.roster_id}`]?.expectedSlot ?? null)
          : null;
        // Only show predicted slot for current and next year — 2+ years out is too speculative
        const expectedSuffix = expectedSlot != null && Number(p.season) <= Number(finderSeasonYear) + 1
          ? ` · Predicted Slot ${expectedSlot}` : "";
        return `${slotLabel}${expectedSuffix}${via}`;
      };

      // Build roster player list with values — reads from pre-computed Map (O(1) lookup)
      const rosterPlayers = (roster: SleeperRoster | null | undefined) => roster ? finderRosterPlayersMap.get(roster.roster_id) ?? [] : [];


      // Roster-aware drop cost — replaces flat waiver adjustment for net calculations.
      // Only PLAYERS consume roster spots; picks do not.
      // netPlayerGain > 0 means I receive more players than I give → may need to drop.
      const calcDropCost = (rosterId: number, netPlayerGain: number): number => {
        if (netPlayerGain <= 0) return 0;
        const limit = (selectedLeague?.roster_positions ?? []).length || 25;
        const roster = rosters.find((ros) => ros.roster_id === rosterId);
        if (!roster) return 0;
        const currentCount = (roster.players ?? []).length;
        const openSlots = Math.max(0, limit - currentCount);
        const dropsNeeded = Math.max(0, netPlayerGain - openSlots);
        if (dropsNeeded === 0) return 0;
        const sorted = (roster.players ?? []).map((pid) => calcFcValues[pid] ?? 0).sort((a, b) => a - b);
        return sorted.slice(0, dropsNeeded).reduce((s, v) => s + v, 0);
      };

      const myRoster = rosters.find((r) => r.owner_id === user?.user_id);
      const myPlayers = rosterPlayers(myRoster);
      const isBlockedSellDisposition = (playerId?: string | null) =>
        !!playerId && (
          playerDispositions[playerId]?.sell === "Not Willing to Trade" ||
          leaguePlayerTags[selectedLeague?.league_id]?.[playerId] === "CORE"
        );
      const isBlockedBuyDisposition = (playerId?: string | null) =>
        !!playerId && ["Zero Interest", "Skip"].includes(playerDispositions[playerId]?.buy || "");
      const isWantToTrade = (playerId?: string | null) =>
        !!playerId && leaguePlayerTags[selectedLeague?.league_id]?.[playerId] === "WANT_TO_TRADE";
      const myT = posTotals(myPlayers);
      // Read from component-level useMemo — only rebuilds on league switch / value refresh
      // Single source of truth: the fully adjusted profile (dynasty + redraft + sim + age).
      // At this point selectedLeagueDirectionAdjusted is guaranteed non-null (loading gate above).
      const finderDirectionProfile = selectedLeagueDirectionAdjusted;
      const finderDirection = finderDirectionProfile.bucket;
      // Sim is now required before selectedLeagueDirectionAdjusted resolves — playoffOdds
      // is always a real number by the time we reach here (loading gate above blocks otherwise).
      const myFinderPlayoffOdds = finderDirectionProfile.playoffOdds ?? 0;

      // ── Stockpiled-rebuild detection ─────────────────────────────────────
      // A team can be dynasty-elite (top of league) and already pick-rich while
      // still having low playoff odds — that's a team poised to consolidate,
      // not blow up. The smart move is tier-ups: trade depth into stars while
      // staying young. They should NOT get "Full Rebuild" suggestions that
      // chase even more picks.
      const dynRank = finderDirectionProfile.dynRank ?? 999;
      const totalTeams = finderDirectionProfile.n ?? rosters.length;
      const dynastyStrong = totalTeams > 0 && dynRank <= Math.ceil(totalTeams * 0.33);
      const ownedFirstsCount = allPicks.filter((p) =>
        Number(p.owner_id) === Number(myRoster?.roster_id) &&
        Number(p.round) === 1
      ).length;
      // Each team naturally has 1 first per year (3 across the 3-year window),
      // so 5+ owned firsts means at least 2 acquired via trade — clear stockpile.
      const pickRich = ownedFirstsCount >= 5;
      const isStockpiledRebuild = dynastyStrong && pickRich;

      // ── Auto-strategy detection (replaces manual toggles) ────────────────
      // "Full Rebuild" is reserved for genuinely no-hope situations: bottom-
      // dynasty buckets where long-term and short-term are both bleak. The
      // previous "playoff odds < 35%" trigger was firing for top-dynasty teams
      // having a down year, which is the wrong signal for blow-it-up moves.
      // Tank-mode scoring (in useScoringFactors) boosts pick acquisition.
      // Disable for stockpiled teams so trade scoring doesn't keep pushing
      // them toward more picks they don't need.
      const iAmTankingFinder = myFinderPlayoffOdds < 50 && !isStockpiledRebuild;

      const isHardSellSide = (
        ["Stranded", "Fading Out", "Hopeless"].includes(finderDirection)
      ) && !isStockpiledRebuild;
      // Draft capital mode: auto-enabled for any sell-side team so pick trades
      // are always part of the result pool alongside normal player swaps.
      // Suppressed for stockpiled teams so suggestions skew to player tier-ups.
      const draftCapitalMode = (isHardSellSide || finderDirection === "Rebuilder") && !isStockpiledRebuild;
      // Prefer future picks when in a deep rebuild — pick position matters more
      // than current-year upside for teams rebuilding over 2+ year horizon.
      const finderPreferFuturePicks = ["Stranded", "Fading Out", "Hopeless"].includes(finderDirection)
        && !isStockpiledRebuild;
      // Tank Mode: lift user-side package/QB constraints for hard sell-side teams.
      const finderTankMode = isHardSellSide;
      // Championship push: confirmed contender with locked/near-locked playoff odds.
      // The one move matters more than value — filling the exact hole is the priority.
      const isChampionshipPush = ["Elite", "True Contender"].includes(finderDirection) &&
        myFinderPlayoffOdds >= 70;
      // Auto-strategy label for UI display
      const autoStrategyLabel: string = isChampionshipPush
        ? "Championship Push"
        : finderDirection === "Window Closing"
          ? "Win-Now Window"
          : isStockpiledRebuild
            ? "Consolidate"
            : isHardSellSide
              ? "Full Rebuild"
              : finderDirection === "Rebuilder"
                ? "Rebuild Sell"
                : iAmTankingFinder
                  ? "Soft Sell"
                  : ["Elite", "True Contender", "Almost There"].includes(finderDirection)
                    ? "Contender Mode"
                    : finderDirection === "Fading Contender"
                      ? "Transition"
                      : "Direction Mix";
      const priorityDraftYear = String(
        Number(finderSeasonYear) + (selectedLeagueDraftHasOccurred ? 1 : 0)
      );
      const orderedDraftYears = [
        ...YEARS.filter((year) => Number(year) >= Number(priorityDraftYear)),
        ...YEARS.filter((year) => Number(year) < Number(priorityDraftYear)),
      ];
      const draftYearPriority = Object.fromEntries(
        orderedDraftYears.map((year, idx) => [year, idx])
      ) as Record<string, number>;
      const numTeams = rosters.length;
      // 2+ years out: skip slot prediction and use round-average as a neutral baseline
      const finderPickValue = (p: AugmentedPick) => {
        if (Number(p.season) > Number(finderSeasonYear) + 1) return getStoredPickValue(pickFcValues, p);
        return selectedLeagueDynamicPickValues[`${p.season}-${p.round}-${p.roster_id}`]?.expectedValue ?? getStoredPickValue(pickFcValues, p);
      };
      const myFinderPicks = allPicks
        .filter((p) => p.owner_id === myRoster?.roster_id)
        .map((p) => ({ ...p, value: finderPickValue(p) }))
        .filter((p) => p.value > 0)
        .sort((a, b) => {
          const yearDiff = (draftYearPriority[a.season] ?? 999) - (draftYearPriority[b.season] ?? 999);
          if (yearDiff !== 0) return yearDiff;
          if (a.round !== b.round) return a.round - b.round;
          return b.value - a.value;
        })
        .slice(0, 6);
      const allTeamPosTotals = rosters.map((r) => posTotals(rosterPlayers(r)));
      const starterSlots = (selectedLeague?.roster_positions || []).filter(
        (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
      );
      const starterCounts = starterSlots.reduce((acc: Record<string, number>, slot: string) => {
        acc[slot] = (acc[slot] || 0) + 1;
        return acc;
      }, {});
      const hasSuperFlex = (starterCounts.SUPER_FLEX || 0) > 0;
      const hasFlex = (starterCounts.FLEX || 0) > 0;
      const rosterById = new Map(rosters.map((r) => [Number(r.roster_id), r]));
      const weakPositions = new Set(
        (finderDirectionProfile?.positionRanks || [])
          .filter((entry) => entry.rank >= Math.max(4, numTeams - 2))
          .map((entry) => entry.pos)
      );
      const strongPositions = new Set(
        (finderDirectionProfile?.positionRanks || [])
          .filter((entry) => entry.rank <= Math.max(2, Math.ceil(numTeams / 3)))
          .map((entry) => entry.pos)
      );

      const {
        getTradeLineupSafety,
        posScore,
        getDirectionTradeScore,
        getTradeIntent,
        failsDirectionGuardrail,
      } = createScoringFactors({
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
      });
      const buildPostTradePlayers = (baseRoster: SleeperRoster | undefined, givePlayers: PlayerWithValue[], receivePlayers: PlayerWithValue[]): PlayerWithValue[] =>
        buildPostTradePlayersUtil(baseRoster, givePlayers, receivePlayers, players, calcFcValues);
      // Full roster is the give pool — no artificial cap
      const myTopBase = myPlayers
        .filter((p) => !isBlockedSellDisposition(p.player_id));
      const myPinnedPlayer = deferredPinnedPlayerId && !isBlockedSellDisposition(deferredPinnedPlayerId)
        ? myPlayers.find((p) => p.player_id === deferredPinnedPlayerId)
        : null;
      const myTop = myPinnedPlayer && !myTopBase.some((p) => p.player_id === myPinnedPlayer.player_id)
        ? [...myTopBase.slice(0, 9), myPinnedPlayer].filter(Boolean)
        : myTopBase;
      // When either give or receive player is pinned, relax loop caps so rarer combos surface

      // ── Ignored owners notice ──
      const ignoredInLeague = rosters.filter((r) => r.owner_id !== user?.user_id && ignoredOwnerIds.includes(r.owner_id));

      // ── Player search / pin UI ──
      // Search inputs are now isolated components — typing never causes this IIFE to run.
      // pinnedPlayer uses deferredPinnedPlayerId so the IIFE doesn't recompute
      // on every intermediate state change — only when React has idle time.
      const pinnedPlayer = deferredPinnedPlayerId
        ? myPlayers.find((p) => p.player_id === deferredPinnedPlayerId && !isBlockedSellDisposition(p.player_id)) ?? null
        : null;

      // Opponent roster(s) for target player search
      const finderOppRostersFiltered = rosters.filter((r) =>
        r.owner_id !== user?.user_id &&
        (deferredTargetOppRosterId === null || r.roster_id === deferredTargetOppRosterId)
      );
      const allOppPlayers = finderOppRostersFiltered.flatMap((r) => rosterPlayers(r));
      const targetPinnedPlayer = deferredTargetPlayerId
        ? allOppPlayers.find((p) => p.player_id === deferredTargetPlayerId) ?? null
        : null;

      // top32QBFloor is memoised at component level (allQBsSorted / top32QBFloor)

      // How many of my QBs are within top-32 threshold
      const myTop32QBs = myPlayers.filter(
        (p) => p.position === "QB" && p.value >= top32QBFloor
      );

      // Returns true if giving these players still leaves ≥3 top-32 QBs on my roster.
      // Bypassed in Tank Mode — user explicitly chose to shed QB depth.
      const qbSafe = (givePlayers: PlayerWithValue[]) => {
        if (finderTankMode) return true;
        const qbsGiven = givePlayers.filter((p) => p.position === "QB" && p.value >= top32QBFloor).length;
        return myTop32QBs.length - qbsGiven >= 3;
      };

      // Returns true if the opponent still has ≥3 top-32 QBs after giving these players away
      const oppQbSafe = (oppPlayersList: PlayerWithValue[], givePlayers: PlayerWithValue[]) => {
        const oppTop32QBs = oppPlayersList.filter(
          (p) => p.position === "QB" && p.value >= top32QBFloor
        );
        const qbsGiven = givePlayers.filter((p) => p.position === "QB" && p.value >= top32QBFloor).length;
        return oppTop32QBs.length - qbsGiven >= 3;
      };

      const oppReceiveOk = (oppPlayersList: PlayerWithValue[], givePlayers: PlayerWithValue[], receivePlayers: PlayerWithValue[]) => {
        const outgoingIds = new Set(receivePlayers.map((p) => p.player_id));
        for (const pos of ["QB", "WR", "TE"] as const) {
          const limit = POS_RANK_LIMITS[pos];
          const incoming = givePlayers.filter((p) => p.position === pos);
          if (incoming.length === 0) continue;
          // Skip rank constraint for low-value depth pieces — bench swaps and handcuffs
          // should never be blocked just because they don't crack the opponent's top-N
          const impactIncoming = incoming.filter((p) => p.value >= 2000);
          if (impactIncoming.length === 0) continue;
          const oppPosAfter = oppPlayersList
            .filter((p) => p.position === pos && !outgoingIds.has(p.player_id))
            .concat(incoming)
            .sort((a, b) => b.value - a.value);
          const passes = impactIncoming.every((pl) => {
            const rank = oppPosAfter.findIndex((p) => p.player_id === pl.player_id);
            return rank < limit; // 0-indexed: rank 0…limit-1 = top N
          });
          if (!passes) return false;
        }
        return true;
      };

      // Hard direction filter — applied at generation time alongside oppReceiveOk.
      // Blocks structurally implausible trades before they reach scoring.
      // Rules:
      //   1. A tanking team (< 30% playoff odds) will not trade away a 1st-round pick
      //      in exchange for only veterans and no picks/youth in return.
      //   2. A clear contender (≥ 65% playoff odds) will not give up players for only picks.
      const oppDirOk = (
        oppRosterId: number,
        givePlayers: PlayerWithValue[],   // what we send them
        givePicks: PickWithValue[],
        receivePlayers: PlayerWithValue[], // what they send us
        receivePicks: PickWithValue[]
      ): boolean => {
        const oppOdds = selectedLeagueSimulation?.rowByRosterId?.get(Number(oppRosterId))?.playoffOdds ?? 50;
        // Tanker giving a 1st for pure vets — they need picks, not aging players
        if (oppOdds < 30) {
          const givingFirstRound = givePicks.some((p) => Number(p.round) === 1);
          const receivingOnlyVets = givePlayers.length > 0
            && givePlayers.every((p) => isOldProducerBuy(p))
            && receivePicks.length === 0
            && receivePlayers.filter((p) => isFutureInsulationAsset(p)).length === 0;
          if (givingFirstRound && receivingOnlyVets) return false;
        }
        // Contender giving away their own players for only the user's picks — they should be buying
        // production to win now, not selling contributors for future capital (that's rebuilder behavior).
        // "receivePlayers" = players the opponent gives us; "givePlayers" = players we send them.
        if (oppOdds >= 65 && receivePlayers.length > 0 && givePlayers.length === 0 && receivePicks.length === 0) {
          return false;
        }
        return true;
      };

      // User-side package check — bypassed in Tank Mode so the user can give 2+ QBs/TEs
      const myPkgOk = (pkg: PlayerWithValue[]) => finderTankMode || packageOk(pkg);

      // QB receiving limit: QB must rank in the opponent's top 3 at the position.
      // Whether it's an acceptable deal given their actual depth is handled by the
      // QB depth-rank penalty in oppDirectionScore (scaled by giveQualityFactor).
      const POS_RANK_LIMITS: Record<string, number> = { QB: 3, WR: 5, TE: 2 };

      // nflTeamDepth is memoised at component level (useMemo above)
      // Returns sorted depth index for a player (0=starter, 1=primary HC, 2=secondary HC…)
      const getNFLDepthIdx = (team: string, pos: string, playerId: string): number | null =>
        getNFLDepthIdxUtil(team, pos, playerId, nflTeamDepth);

      const results: TradeResult[] = [];

      for (const oppRoster of rosters.filter((r) => r.owner_id !== user?.user_id && !ignoredOwnerIds.includes(r.owner_id) && (deferredTargetOppRosterId === null || r.roster_id === deferredTargetOppRosterId))) {
        const oppPlayers = rosterPlayers(oppRoster);
        const oppPicks: PickWithValue[] = allPicks
          .filter((p) => p.owner_id === oppRoster.roster_id)
          .map((p) => ({ ...p, value: finderPickValue(p) }))
          .filter((p) => p.value > 0)
          .sort((a, b) => {
            const yearDiff = (draftYearPriority[a.season] ?? 999) - (draftYearPriority[b.season] ?? 999);
            if (yearDiff !== 0) return yearDiff;
            if (a.round !== b.round) return a.round - b.round;
            return b.value - a.value;
          })
          .slice(0, 8);

        // Full opponent roster is the receive pool — no artificial cap
        // Also exclude "Zero Interest" buy-disposition players unless explicitly targeted
        const oppTopBase = oppPlayers
          .filter((p) => !isBlockedBuyDisposition(p.player_id));
        const targetPinnedOppPlayer = deferredTargetPlayerId && !isBlockedBuyDisposition(deferredTargetPlayerId)
          ? oppPlayers.find((p) => p.player_id === deferredTargetPlayerId)
          : null;
        const oppTop = targetPinnedOppPlayer && !oppTopBase.some((p) => p.player_id === targetPinnedOppPlayer.player_id)
          ? [...oppTopBase.slice(0, 9), targetPinnedOppPlayer].filter(Boolean)
          : oppTopBase;
        const oppName = users[oppRoster.owner_id] || `Team ${oppRoster.roster_id}`;

        if (draftCapitalMode) {
          for (const mp of myTop) {
            if (isBlockedSellDisposition(mp.player_id)) continue;
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
            if (isBlockedSellDisposition(mp.player_id)) continue;
            for (let i = 0; i < oppPicks.length; i++) {
              for (let j = i + 1; j < oppPicks.length; j++) {
                const p1 = oppPicks[i], p2 = oppPicks[j];
                if (!isBalanced([mp.value], [p1.value, p2.value])) continue;
                if (!qbSafe([mp])) continue;
                if (!oppReceiveOk(oppPlayers, [mp], [])) continue;
                results.push({
                  give: [mp], receive: [], givePicks: [], receivePicks: [p1, p2], oppName, oppRosterId: oppRoster.roster_id,
                  score: -Math.abs((p1.value + p2.value) - mp.value), net: p1.value + p2.value - mp.value, format: "1 for 2", draftCapital: true,
                });
              }
            }
          }

          for (let i = 0; i < Math.min(myTop.length, 14); i++) {
            for (let j = i + 1; j < Math.min(myTop.length, 14); j++) {
              const mp1 = myTop[i], mp2 = myTop[j];
              if (isBlockedSellDisposition(mp1.player_id) || isBlockedSellDisposition(mp2.player_id)) continue;
              if (!myPkgOk([mp1, mp2])) continue;
              if (!qbSafe([mp1, mp2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp1, mp2], [])) continue;
              for (const pick of oppPicks) {
                if (!isBalanced([mp1.value, mp2.value], [pick.value])) continue;
                results.push({
                  give: [mp1, mp2], receive: [], givePicks: [], receivePicks: [pick], oppName, oppRosterId: oppRoster.roster_id,
                  score: -Math.abs(pick.value - (mp1.value + mp2.value)), net: pick.value - mp1.value - mp2.value, format: "2 for 1", draftCapital: true,
                });
              }
            }
          }

          // Fall through — also generate normal player-swap trades so sell-side teams
          // see both pick trades and player trades in the same ranked result pool.
        }

        // When a player is pinned, extend the cap just enough to include that player's position
        // in the sorted list — never blow open the entire roster (that causes C(n,4)^2 freezes).
        const pinnedMyIdx = myPinnedPlayer ? myTop.findIndex((p) => p.player_id === myPinnedPlayer.player_id) : -1;
        const pinnedOppIdx = targetPinnedOppPlayer ? oppTop.findIndex((p) => p.player_id === targetPinnedOppPlayer.player_id) : -1;
        const myCap = (base: number) => Math.min(myTop.length, pinnedMyIdx >= 0 ? Math.min(Math.max(base, pinnedMyIdx + 1), 18) : base);
        const oppCap = (base: number) => Math.min(oppTop.length, pinnedOppIdx >= 0 ? Math.min(Math.max(base, pinnedOppIdx + 1), 18) : base);

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
          for (let i = 0; i < oppCap(18); i++) {
            for (let j = i + 1; j < oppCap(18); j++) {
              const op1 = oppTop[i], op2 = oppTop[j];
              if (!isBalanced([mp.value], [op1.value, op2.value])) continue;
              if (!packageOk([op1, op2])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op1, op2])) continue;
              results.push({
                give: [mp], receive: [op1, op2], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op1, op2]),
                net: op1.value + op2.value - mp.value - calcDropCost(myRoster?.roster_id ?? 0, 1), format: "1 for 2",
              });
            }
          }
        }

        // 1v3
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(14); i++) {
            for (let j = i + 1; j < oppCap(14); j++) {
              for (let k = j + 1; k < oppCap(14); k++) {
                const op1 = oppTop[i], op2 = oppTop[j], op3 = oppTop[k];
                if (!isBalanced([mp.value], [op1.value, op2.value, op3.value])) continue;
                if (!packageOk([op1, op2, op3])) continue;
                if (!qbSafe([mp])) continue;
                if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                if (!oppReceiveOk(oppPlayers, [mp], [op1, op2, op3])) continue;
                results.push({
                  give: [mp], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp], [op1, op2, op3]),
                  net: op1.value + op2.value + op3.value - mp.value - calcDropCost(myRoster?.roster_id ?? 0, 2), format: "1 for 3",
                });
              }
            }
          }
        }

        // 1v4
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(10); i++) {
            for (let j = i + 1; j < oppCap(10); j++) {
              for (let k = j + 1; k < oppCap(10); k++) {
                for (let l = k + 1; l < oppCap(10); l++) {
                  const op1 = oppTop[i], op2 = oppTop[j], op3 = oppTop[k], op4 = oppTop[l];
                  if (!isBalanced([mp.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                  if (!packageOk([op1, op2, op3, op4])) continue;
                  if (!qbSafe([mp])) continue;
                  if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                  if (!oppReceiveOk(oppPlayers, [mp], [op1, op2, op3, op4])) continue;
                  results.push({
                    give: [mp], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                    score: posScore([mp], [op1, op2, op3, op4]),
                    net: op1.value + op2.value + op3.value + op4.value - mp.value - calcDropCost(myRoster?.roster_id ?? 0, 3), format: "1 for 4",
                  });
                }
              }
            }
          }
        }

        // 2v1
        for (let i = 0; i < myCap(18); i++) {
          for (let j = i + 1; j < myCap(18); j++) {
            for (const op of oppTop) {
              const mp1 = myTop[i], mp2 = myTop[j];
              if (!isBalanced([mp1.value, mp2.value], [op.value])) continue;
              if (!myPkgOk([mp1, mp2])) continue;
              if (!qbSafe([mp1, mp2])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op])) continue;
              results.push({
                give: [mp1, mp2], receive: [op], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp1, mp2], [op]),
                net: op.value - mp1.value - mp2.value, format: "2 for 1",
              });
            }
          }
        }

        // 2v2
        for (let i = 0; i < myCap(14); i++) {
          for (let j = i + 1; j < myCap(14); j++) {
            for (let k = 0; k < oppCap(14); k++) {
              for (let l = k + 1; l < oppCap(14); l++) {
                const mp1 = myTop[i], mp2 = myTop[j];
                const op1 = oppTop[k], op2 = oppTop[l];
                if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value])) continue;
                if (!myPkgOk([mp1, mp2])) continue;
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
        for (let i = 0; i < myCap(12); i++) {
          for (let j = i + 1; j < myCap(12); j++) {
            for (let k = 0; k < oppCap(12); k++) {
              for (let l = k + 1; l < oppCap(12); l++) {
                for (let m = l + 1; m < oppCap(12); m++) {
                  const mp1 = myTop[i], mp2 = myTop[j];
                  const op1 = oppTop[k], op2 = oppTop[l], op3 = oppTop[m];
                  if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value, op3.value])) continue;
                  if (!myPkgOk([mp1, mp2])) continue;
                  if (!packageOk([op1, op2, op3])) continue;
                  if (!qbSafe([mp1, mp2])) continue;
                  if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                  if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2, op3])) continue;
                  results.push({
                    give: [mp1, mp2], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                    score: posScore([mp1, mp2], [op1, op2, op3]),
                    net: op1.value + op2.value + op3.value - mp1.value - mp2.value - calcDropCost(myRoster?.roster_id ?? 0, 1), format: "2 for 3",
                  });
                }
              }
            }
          }
        }

        // 2v4
        for (let i = 0; i < myCap(10); i++) {
          for (let j = i + 1; j < myCap(10); j++) {
            for (let k = 0; k < oppCap(10); k++) {
              for (let l = k + 1; l < oppCap(10); l++) {
                for (let m = l + 1; m < oppCap(10); m++) {
                  for (let n = m + 1; n < oppCap(10); n++) {
                    const mp1 = myTop[i], mp2 = myTop[j];
                    const op1 = oppTop[k], op2 = oppTop[l], op3 = oppTop[m], op4 = oppTop[n];
                    if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                    if (!myPkgOk([mp1, mp2])) continue;
                    if (!packageOk([op1, op2, op3, op4])) continue;
                    if (!qbSafe([mp1, mp2])) continue;
                    if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                    if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2, op3, op4])) continue;
                    results.push({
                      give: [mp1, mp2], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                      score: posScore([mp1, mp2], [op1, op2, op3, op4]),
                      net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - calcDropCost(myRoster?.roster_id ?? 0, 2), format: "2 for 4",
                    });
                  }
                }
              }
            }
          }
        }

        // 3v3
        for (let i = 0; i < myCap(10); i++) {
          for (let j = i + 1; j < myCap(10); j++) {
            for (let k = j + 1; k < myCap(10); k++) {
              const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k];
              if (!myPkgOk([mp1, mp2, mp3])) continue;
              if (!qbSafe([mp1, mp2, mp3])) continue;
              for (let a = 0; a < oppCap(10); a++) {
                for (let b = a + 1; b < oppCap(10); b++) {
                  for (let c = b + 1; c < oppCap(10); c++) {
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
        for (let i = 0; i < myCap(8); i++) {
          for (let j = i + 1; j < myCap(8); j++) {
            for (let k = j + 1; k < myCap(8); k++) {
              const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k];
              if (!myPkgOk([mp1, mp2, mp3])) continue;
              if (!qbSafe([mp1, mp2, mp3])) continue;
              for (let a = 0; a < oppCap(8); a++) {
                for (let b = a + 1; b < oppCap(8); b++) {
                  for (let c = b + 1; c < oppCap(8); c++) {
                    for (let d = c + 1; d < oppCap(8); d++) {
                      const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c], op4 = oppTop[d];
                      if (!isBalanced([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                      if (!packageOk([op1, op2, op3, op4])) continue;
                      if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                      if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3], [op1, op2, op3, op4])) continue;
                      results.push({
                        give: [mp1, mp2, mp3], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                        score: posScore([mp1, mp2, mp3], [op1, op2, op3, op4]),
                        net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - mp3.value - calcDropCost(myRoster?.roster_id ?? 0, 1), format: "3 for 4",
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // 4v4
        for (let i = 0; i < myCap(8); i++) {
          for (let j = i + 1; j < myCap(8); j++) {
            for (let k = j + 1; k < myCap(8); k++) {
              for (let l = k + 1; l < myCap(8); l++) {
                const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k], mp4 = myTop[l];
                if (!myPkgOk([mp1, mp2, mp3, mp4])) continue;
                if (!qbSafe([mp1, mp2, mp3, mp4])) continue;
                for (let a = 0; a < oppCap(8); a++) {
                  for (let b = a + 1; b < oppCap(8); b++) {
                    for (let c = b + 1; c < oppCap(8); c++) {
                      for (let d = c + 1; d < oppCap(8); d++) {
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
              results.push({
                give: [mp], receive: [op], givePicks: [myPick], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op]),
                net: op.value - mp.value - myPick.value, format: "1 + pick for 1",
              });
            }
          }
        }

        // 2 + your pick for 1
        for (let i = 0; i < Math.min(myTop.length, 7); i++) {
          for (let j = i + 1; j < Math.min(myTop.length, 7); j++) {
            const mp1 = myTop[i], mp2 = myTop[j];
            if (!myPkgOk([mp1, mp2])) continue;
            if (!qbSafe([mp1, mp2])) continue;
            for (const myPick of myEqualizerPicks) {
              for (const op of oppTop) {
                if (!isBalanced([mp1.value, mp2.value, myPick.value], [op.value])) continue;
                if (!oppQbSafe(oppPlayers, [op])) continue;
                if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op])) continue;
                results.push({
                  give: [mp1, mp2], receive: [op], givePicks: [myPick], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp1, mp2], [op]),
                  net: op.value - mp1.value - mp2.value - myPick.value, format: "2 + pick for 1",
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
              results.push({
                give: [mp], receive: [op], givePicks: [], receivePicks: [oppPick], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op]),
                net: op.value + oppPick.value - mp.value, format: "1 for 1 + pick",
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
                results.push({
                  give: [mp], receive: [op1, op2], givePicks: [], receivePicks: [oppPick], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp], [op1, op2]),
                  net: op1.value + op2.value + oppPick.value - mp.value - calcDropCost(myRoster?.roster_id ?? 0, 1), format: "1 for 2 + pick",
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
        const myLotteryFinderPicks = myFinderPicks.filter((p) =>
          Number(p.round) >= 3 && Number(p.value || 0) > 0 && Number(p.value || 0) < FINDER_LOTTERY_CEILING
        );
        const oppLotteryPlayers = oppPlayers.filter((p) => {
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
          // Pick the single closest-value pick per player so dedup never discards the better one
          const bestPick = myLotteryFinderPicks
            .filter((p) => {
              const ratio = lp.value / Math.max(p.value, 1);
              return ratio >= 0.5 && ratio <= 2.0;
            })
            .sort((a, b) => Math.abs(a.value - lp.value) - Math.abs(b.value - lp.value))[0];
          if (!bestPick) continue;
          results.push({
            give: [], receive: [lp], givePicks: [bestPick], receivePicks: [],
            oppName, oppRosterId: oppRoster.roster_id,
            score: posScore([], [lp]) * 0.6,
            net: lp.value - bestPick.value,
            format: "Lottery",
          });
        }
      }

      // ── Scoring + slotting pipeline ──────────────────────────────────────
      const { allTrades, recentFingerprints, rosterOverflow } = runFinderPipeline(results, {
        allPicks,
        players,
        calcFcValues: calcFcValues as Record<string, number>,
        redraftValues: (redraftValues ?? {}) as Record<string, number>,
        rosters,
        selectedLeague,
        user,
        myPlayers,
        myRoster,
        numTeams,
        starterCounts,
        hasSuperFlex,
        draftYearPriority,
        priorityDraftYear,
        weakPositions,
        finderDirection,
        finderTankMode,
        draftCapitalMode,
        finderPreferFuturePicks,
        iAmTankingFinder,
        myFinderPlayoffOdds,
        isChampionshipPush,
        pinnedPlayer,
        deferredTargetPlayerId,
        deferredPinnedPlayerId,
        deferredTargetOppRosterId,
        deferredFinderSeed,
        nflTeamDepth,
        tradePartnerRankings,
        leagueMateProfileByRosterId,
        tradeAttempts,
        historicalSnapshot,
        playerStats: playerStats ?? null,
        crossLeagueExposure: crossLeagueExposure ?? null,
        buyLowPlayerIds,
        nflState: nflState ?? null,
        selectedLeagueSimulation: selectedLeagueSimulation ?? null,
        selectedLeagueDraftHasOccurred,
        weeklyProjMap: finderWeeklyProjMap,
        playerDispositions,
        finderPickValue,
        buildPostTradePlayers,
        getNFLDepthIdx,
        rosterPlayers,
        isBlockedSellDisposition,
        isBlockedBuyDisposition,
        isWantToTrade,
        oppDirOk,
        failsDirectionGuardrail,
        getDirectionTradeScore,
        getTradeLineupSafety,
      });

      return {
        allTrades, recentFingerprints, rosterOverflow,
        finderDirectionProfile, finderDirection, autoStrategyLabel,
        isChampionshipPush, finderTankMode, draftCapitalMode,
        finderPreferFuturePicks, iAmTankingFinder, weakPositions,
        numTeams, myRoster, pinnedPlayer, targetPinnedPlayer,
        allOppPlayers, ignoredInLeague, calcDropCost, finderPickLabel,
        getTradeIntent,
      };
  }, [
    selectedLeague, selectedLeagueDirectionAdjusted, loadingCalcValues, nflState,
    users, selectedLeagueDynamicPickValues, finderRosterPlayersMap, rosters,
    calcFcValues, user, playerDispositions, leaguePlayerTags, allPicks,
    selectedLeagueDraftHasOccurred, pickFcValues, redraftValues, marketSignalMap,
    players, deferredPinnedPlayerId, deferredTargetOppRosterId, deferredTargetPlayerId,
    top32QBFloor, nflTeamDepth, ignoredOwnerIds, selectedLeagueSimulation,
    deferredFinderSeed, tradePartnerRankings, leagueMateProfileByRosterId,
    tradeAttempts, historicalSnapshot, playerStats, crossLeagueExposure,
    buyLowPlayerIds, finderWeeklyProjMap,
  ]);

  if (!selectedLeague) return (
    <p className="text-gray-400 text-sm">Select a league from the dropdown above to use the Trade Finder.</p>
  );
  // Block the entire finder until the authoritative direction profile is ready.
  // selectedLeagueDirectionAdjusted returns null whenever its inputs are mid-update
  // (league switch, sim recomputing for the new league, etc.). Showing stale trades
  // driven by the wrong direction is worse than showing a spinner.
  if (!selectedLeagueDirectionAdjusted) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      <p className="text-sm text-gray-400">Computing direction engine…</p>
      <p className="text-xs text-gray-600">Analysing your roster, picks, and playoff simulation</p>
    </div>
  );
  if (loadingCalcValues) return <p className="text-sm text-blue-400">Loading player values…</p>;
  if (!finderModel) return null;

  const {
    allTrades, recentFingerprints, rosterOverflow,
    finderDirectionProfile, finderDirection, autoStrategyLabel,
    isChampionshipPush, finderTankMode, draftCapitalMode,
    finderPreferFuturePicks, iAmTankingFinder, weakPositions,
    numTeams, myRoster, pinnedPlayer, targetPinnedPlayer,
    allOppPlayers, ignoredInLeague, calcDropCost, finderPickLabel,
    getTradeIntent,
  } = finderModel;

  return (
        <div className="space-y-4">
          {/* ── Player pin search ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
            <FinderDirectionPanel
              loadingCalcValues={loadingCalcValues}
              finderDirectionProfile={finderDirectionProfile}
              directionRefreshing={directionRefreshing}
              setDirectionRefreshing={setDirectionRefreshing}
              onRefreshDirection={onRefreshDirection}
              selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
              setFinderTargetOppRosterId={setFinderTargetOppRosterId}
              isChampionshipPush={isChampionshipPush}
              finderTankMode={finderTankMode}
              draftCapitalMode={draftCapitalMode}
              autoStrategyLabel={autoStrategyLabel}
              finderPreferFuturePicks={finderPreferFuturePicks}
              rosterOverflow={rosterOverflow}
            />
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Find trades involving a specific player</p>
            {pinnedPlayer ? (
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium">{pinnedPlayer.full_name}</span>
                  <span className="text-[10px] text-gray-500 uppercase">{pinnedPlayer.position}</span>
                  <span className="text-xs text-gray-500 font-mono">{pinnedPlayer.value.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => { setFinderPinnedPlayerId(null); }}
                  className="text-xs text-gray-500 hover:text-red-400 transition ml-3"
                >
                  ✕ Clear
                </button>
              </div>
            ) : (
              <FinderSearchInput
                players={finderMyRosterPlayers}
                onSelect={(pid) => startTransition(() => { setFinderPinnedPlayerId(pid); setFinderSeed(Math.random()); })}
              />
            )}

            {/* ── Owner filter dropdown ── */}
            <select
              value={finderTargetOppRosterId ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                startTransition(() => {
                  setFinderTargetOppRosterId(val);
                  setFinderTargetPlayerId(null);
                  setFinderSeed(Math.random());
                });
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Trade with any owner…</option>
              {rosters
                .filter((r) => r.owner_id !== user?.user_id)
                .slice()
                .sort((a, b) =>
                  (users[a.owner_id] || "").localeCompare(users[b.owner_id] || "")
                )
                .map((r) => (
                  <option key={r.roster_id} value={r.roster_id}>
                    {users[r.owner_id] || `Team ${r.roster_id}`}
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
                  onClick={() => startTransition(() => { setFinderTargetPlayerId(null); setFinderSeed(Math.random()); })}
                  className="text-xs text-gray-500 hover:text-red-400 transition ml-3"
                >
                  ✕ Clear
                </button>
              </div>
            ) : (
              <FinderSearchInput
                key={`target-${deferredTargetOppRosterId ?? "all"}`}
                players={allOppPlayers}
                onSelect={(pid) => startTransition(() => { setFinderTargetPlayerId(pid); setFinderSeed(Math.random()); })}
                placeholder={finderTargetOppRosterId ? "Search their roster for a player to receive…" : "Search league for a player you want to receive…"}
              />
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
              onClick={() => startTransition(() => setFinderSeed(Math.random()))}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-lg px-3 py-1.5 transition shrink-0 ml-3"
            >
              Refresh
            </button>
          </div>
          {ignoredInLeague.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2 text-xs text-gray-500">
              <span className="text-red-500">≡ƒÜ½</span>
              {ignoredInLeague.length === 1
                ? <span><strong className="text-gray-400">{users[ignoredInLeague[0].owner_id] || "1 owner"}</strong> is on your ignore list and excluded from results.</span>
                : <span><strong className="text-gray-400">{ignoredInLeague.length} owners</strong> on your ignore list are excluded from results.</span>
              }
            </div>
          )}
          {/* Tagged players strip — Core (locked) and Shopping (want to move) */}
          {(() => {
            const leagueId = selectedLeague?.league_id ?? "";
            const leagueTags = leaguePlayerTags[leagueId] ?? {};
            const corePlayers = Object.entries(leagueTags).filter(([, t]) => t === "CORE");
            const shoppingPlayers = Object.entries(leagueTags).filter(([, t]) => t === "WANT_TO_TRADE");
            if (corePlayers.length === 0 && shoppingPlayers.length === 0) return null;
            const playerMap = players as Record<string, SleeperPlayer>;
            return (
              <div className="rounded-lg border border-gray-700 bg-gray-800/30 px-3 py-2 space-y-2">
                {corePlayers.length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-500 mb-1">Core — Do Not Sell</div>
                    <div className="flex flex-wrap gap-1.5">
                      {corePlayers.map(([pid]) => (
                        <button
                          key={pid}
                          onClick={() => onToggleLeaguePlayerTag(leagueId, pid, "CORE")}
                          title="Click to remove Core tag"
                          className="flex items-center gap-1 rounded-full border border-emerald-800 bg-emerald-950/30 px-2 py-0.5 text-[10px] text-emerald-300 hover:border-red-600 hover:text-red-400 transition"
                        >
                          🔒 {playerMap[pid]?.full_name ?? pid} <span className="text-emerald-600 hover:text-red-400 ml-0.5">✕</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {shoppingPlayers.length > 0 && (
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-widest text-orange-500 mb-1">Shopping — Want to Move</div>
                    <div className="flex flex-wrap gap-1.5">
                      {shoppingPlayers.map(([pid]) => (
                        <button
                          key={pid}
                          onClick={() => onToggleLeaguePlayerTag(leagueId, pid, "WANT_TO_TRADE")}
                          title="Click to remove Shopping tag"
                          className="flex items-center gap-1 rounded-full border border-orange-800 bg-orange-950/30 px-2 py-0.5 text-[10px] text-orange-300 hover:border-red-600 hover:text-red-400 transition"
                        >
                          🔄 {playerMap[pid]?.full_name ?? pid} <span className="text-orange-600 hover:text-red-400 ml-0.5">✕</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <FinderResults
            allTrades={allTrades}
            recentFingerprints={recentFingerprints}
            pinnedPlayer={pinnedPlayer}
            draftCapitalMode={draftCapitalMode}
            leagueId={selectedLeague.league_id}
            myRoster={myRoster}
            selectedLeagueSimulation={selectedLeagueSimulation}
            posTeamTotals={posTeamTotals}
            numTeams={numTeams}
            leaguePlayerTags={leaguePlayerTags}
            marketSignalMap={marketSignalMap}
            tradeAttempts={tradeAttempts}
            sessionMarked={sessionMarked}
            iAmTankingFinder={iAmTankingFinder}
            finderDirection={finderDirection}
            weakPositions={weakPositions}
            leagueMateProfileByRosterId={leagueMateProfileByRosterId}
            calcDropCost={calcDropCost}
            computePosRank={computePosRank}
            getTradeIntent={getTradeIntent}
            finderPickLabel={finderPickLabel}
            onSetPlayerProfileId={setPlayerProfileId}
            onSetViewRosterRosterId={setViewRosterRosterId}
            onOpenInCalculator={(trade) => {
              setCalcOpponentRosterId(trade.oppRosterId);
              setCalcGive(trade.give.map((p) => p.player_id));
              setCalcReceive(trade.receive.map((p) => p.player_id));
              setCalcGivePicks(trade.givePicks.map((p) => finderPickKey(p)));
              setCalcReceivePicks(trade.receivePicks.map((p) => finderPickKey(p)));
              setCalcSearchA("");
              setCalcSearchB("");
              setTradeHubSection("CALCULATOR");
            }}
            onToggleLeaguePlayerTag={onToggleLeaguePlayerTag}
            onMarkAttempted={onMarkAttempted}
            onSessionMark={onSessionMark}
          />
        </div>
      );
}

export default React.memo(TradeFinder);