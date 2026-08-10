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
  AssetDisposition, LeagueAssetDispositions, LeagueExpiringBlocks,
} from "../../lib/types";
import type { PersonalSignal } from "../../lib/helpers/personalRankings";
import { normalizeDisposition, opponentAssetKey, isBlockActive } from "../../lib/helpers/dispositions";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { createScoringFactors } from "./hooks/useScoringFactors";
import { FinderSearchInput } from "./FinderSearch";
import FinderResults from "./FinderResults";
import { FinderDirectionPanel } from "./FinderDirectionPanel";
import {
  packageOk, posTotals, isBalanced, LOW_VALUE_FLOOR,
} from "./FinderScoring";
import {
  finderPickKey,
  buildPostTradePlayers as buildPostTradePlayersUtil,
  getNFLDepthIdx as getNFLDepthIdxUtil,
  computePosRank as computePosRankUtil,
} from "./finderUtils";
import type { MarketSignal, TradeResult, FinderStrategyOverride } from "./finderTypes";
import { YEARS } from "./shared";
import { runFinderPipeline } from "./finderPipeline";
import type { PlayerWithValue, PickWithValue } from "./shared";
import { Card } from "../ui/Card";

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
  finderStrategyOverride: FinderStrategyOverride;
  setFinderStrategyOverride: (mode: FinderStrategyOverride) => void;
  allPicks: AugmentedPick[];
  user: SleeperUser | null;
  selectedLeagueDraftHasOccurred: boolean;
  loadingCalcValues: boolean;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  /** Raw personal buy/sell signal map; the block predicates read it directly (Stage 6). */
  finderSignals: Record<string, PersonalSignal>;
  /** Raw personal-vs-consensus rank delta per player (vsMkt); shown on each card's player rows. */
  finderRankGaps: Record<string, number>;
  leaguePlayerTags: LeagueAssetDispositions;
  onSetAssetDisposition: (leagueId: string, assetId: string, disposition: AssetDisposition | null) => void;
  /** Personal, time-boxed "don't want this player" block — editable both here (each receive-side
   *  player row) and from League Hub's Opponent Rosters tab; both surfaces share the same map. */
  noInterestPlayers: LeagueExpiringBlocks;
  onSetNoInterest: (leagueId: string, playerId: string, days: number | null) => void;
  /** Fingerprints of Finder suggestions the user dismissed; still-active ones are filtered out. */
  discardedTrades: LeagueExpiringBlocks;
  discardFinderTrade: (leagueId: string, fingerprint: string) => void;
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
  setTradeHubSection: (section: "CALCULATOR" | "FINDER" | "TRADE_LOG" | "ATTEMPTS") => void;
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
  finderStrategyOverride, setFinderStrategyOverride,
  allPicks,
  user,
  selectedLeagueDraftHasOccurred,
  loadingCalcValues,
  playerDispositions, finderSignals, finderRankGaps, leaguePlayerTags, onSetAssetDisposition,
  noInterestPlayers, onSetNoInterest, discardedTrades, discardFinderTrade,
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
    previewTradeSimulation,
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
      // Stage 6: block predicates read the personal SIGNAL directly (no string round-trip).
      // Sell-side (never trade away) is CORE-tag-only — no personal signal asks us to hold a
      // player, so the gap signal never blocks the give side. Buy-side blocks acquiring a
      // player we'd strongly shop (STRONG_SELL ⇒ personal rank far below market) OR a player/pick
      // the opponent has been manually marked SELL_NO ("Not Willing to Sell") on their roster —
      // that's an explicit signal a suggested trade for them will never be accepted.
      const disposition = (assetId?: string | null) =>
        assetId ? normalizeDisposition(leaguePlayerTags[selectedLeague?.league_id ?? ""]?.[assetId]) : undefined;
      // Opponent-side dispositions (SELL_NO/SELL_OK) are keyed per-roster (opponentAssetKey) so a
      // tag set against one opponent's copy of an asset never leaks onto another opponent's (or a
      // re-acquired) copy of the same asset — the oppRosterId must be passed at every call site.
      const oppDisposition = (assetId?: string | null, oppRosterId?: number | string | null) =>
        assetId && oppRosterId != null
          ? normalizeDisposition(leaguePlayerTags[selectedLeague?.league_id ?? ""]?.[opponentAssetKey(assetId, oppRosterId)])
          : undefined;
      const isBlockedSellDisposition = (assetId?: string | null) => disposition(assetId) === "CORE";
      // Personal "No Interest" block: independent of the opponent's own SELL_NO/SELL_OK tag
      // above — this is the user not wanting that specific player, not the opponent refusing
      // to sell. Not roster-scoped (bare player_id), so it still applies if he changes teams.
      const isNoInterest = (playerId?: string | null) =>
        !!playerId && isBlockActive(noInterestPlayers[selectedLeague?.league_id ?? ""]?.[playerId]);
      const isBlockedBuyDisposition = (playerId?: string | null, oppRosterId?: number | string | null) =>
        (!!playerId && finderSignals[playerId] === "STRONG_SELL")
        || oppDisposition(playerId, oppRosterId) === "SELL_NO"
        || isNoInterest(playerId);
      const isWantToTrade = (assetId?: string | null) => disposition(assetId) === "SHOPPING";
      const isOffload = (assetId?: string | null) => disposition(assetId) === "OFFLOAD";
      const isPricey = (assetId?: string | null) => disposition(assetId) === "PRICEY";
      const isOpenToSell = (assetId?: string | null, oppRosterId?: number | string | null) =>
        oppDisposition(assetId, oppRosterId) === "SELL_OK";
      const myT = posTotals(myPlayers);
      // Read from component-level useMemo — only rebuilds on league switch / value refresh
      // Single source of truth: the fully adjusted profile (dynasty + redraft + sim + age).
      // At this point selectedLeagueDirectionAdjusted is guaranteed non-null (loading gate above).
      const finderDirectionProfile = selectedLeagueDirectionAdjusted;
      // Manual strategy override: forces the bucket every downstream branch keys off of
      // (CONTENDER_BUCKETS/SELLER_BUCKETS checks, getDirectionTradeScore, failsDirectionGuardrail,
      // etc.), regardless of what the direction engine actually computed. The real computed
      // bucket is still shown as-is in FinderDirectionPanel's "Direction Engine" badge.
      const finderDirection = finderStrategyOverride === "TANK"
        ? "Hopeless"
        : finderStrategyOverride === "CONTEND"
          ? "Elite"
          : finderDirectionProfile.bucket;
      // Sim is normally resolved before selectedLeagueDirectionAdjusted is non-null, so
      // playoffOdds is a real number here. Guard anyway: default to 50 (neutral), NEVER 0 —
      // a 0 default would silently flip the whole finder into tank/sell-side mode.
      const hasMySim = finderDirectionProfile.hasSimData === true
        && Number.isFinite(finderDirectionProfile.playoffOdds);
      const myFinderPlayoffOdds = hasMySim ? Number(finderDirectionProfile.playoffOdds) : 50;

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
      // Stockpile detection only makes sense for the automatic read — a manual override
      // means the user has explicitly decided the strategy, so it must not be dampened.
      const isStockpiledRebuild = finderStrategyOverride === "AUTO" && dynastyStrong && pickRich;

      // ── Auto-strategy detection (replaces manual toggles) ────────────────
      // "Full Rebuild" is reserved for genuinely no-hope situations: bottom-
      // dynasty buckets where long-term and short-term are both bleak. The
      // previous "playoff odds < 35%" trigger was firing for top-dynasty teams
      // having a down year, which is the wrong signal for blow-it-up moves.
      // Tank-mode scoring (in useScoringFactors) boosts pick acquisition.
      // Disable for stockpiled teams so trade scoring doesn't keep pushing
      // them toward more picks they don't need.
      // Don't auto-tank unless the user's own sim is actually resolved (hasMySim).
      const iAmTankingFinder = finderStrategyOverride === "TANK"
        ? true
        : finderStrategyOverride === "CONTEND"
          ? false
          : hasMySim && myFinderPlayoffOdds < 50 && !isStockpiledRebuild;

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
      const isChampionshipPush = finderStrategyOverride === "CONTEND"
        ? true
        : finderStrategyOverride === "TANK"
          ? false
          : ["Elite", "True Contender"].includes(finderDirection) && myFinderPlayoffOdds >= 70;
      // Auto-strategy label for UI display
      const autoStrategyLabel: string = finderStrategyOverride === "TANK"
        ? "Full Tank Mode"
        : finderStrategyOverride === "CONTEND"
        ? "Full Contend Mode"
        : isChampionshipPush
        ? "Championship Push"
        : finderDirection === "Window Closing"
          ? "Win-Now Window"
          : isStockpiledRebuild
            ? "Consolidate"
            : isHardSellSide
              ? "Full Rebuild"
              : iAmTankingFinder
                ? "Soft Sell"
                : finderDirection === "Rebuilder"
                  ? "Rebuild Sell"
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
      // A pick the user has manually flagged Shopping/Offload should always make the give-pool,
      // never buried behind a stack of untagged current-year picks in the slice(0, 6) below.
      // Same for next year's capital while in Full Contend Mode / a championship push — a real
      // contender can deal that without it costing this year's points or depth, so it shouldn't
      // be strictly outranked by every current-year pick the way a rebuilder's future picks should.
      const pickSellPriority = (p: AugmentedPick) => {
        const key = finderPickKey(p);
        if (isOffload(key)) return 0;
        if (isWantToTrade(key)) return 1;
        if (isChampionshipPush && Number(p.season) <= Number(finderSeasonYear) + 1) return 2;
        return 3;
      };
      const myFinderPicks = allPicks
        .filter((p) => p.owner_id === myRoster?.roster_id && !isBlockedSellDisposition(finderPickKey(p)))
        .map((p) => ({ ...p, value: finderPickValue(p) }))
        .filter((p) => p.value > 0)
        .sort((a, b) => {
          const priorityDiff = pickSellPriority(a) - pickSellPriority(b);
          if (priorityDiff !== 0) return priorityDiff;
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
        isStockpiledRebuild,
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
      // Give pool: skill players worth ≥ LOW_VALUE_FLOOR (700). Sub-700 players are noise and
      // must not be trade pieces — not as headliners and not as balancers (the root cause of
      // junk like a 51-value WR padding a package). Two carve-outs preserve intent: a pinned
      // player is re-added below (you explicitly want to move him), and the cross-league
      // affinity sweetener is drawn from the full roster (myPlayers) further down.
      const myTopBase = myPlayers
        .filter((p) => !isBlockedSellDisposition(p.player_id) && (p.value ?? 0) >= LOW_VALUE_FLOOR);
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

      // oppDirOk (the hard structural acceptance pre-filter) now lives in finderPipeline,
      // where it is judged on the opponent's ADJUSTED window bucket via the canonical
      // classifier rather than raw playoff odds. See runFinderPipeline.

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

      // Freeze guard: a generous ceiling on total generated candidates. Not a quality knob —
      // the per-format depth caps below define the intended search; this only stops a
      // pathologically deep roster from growing results[] without bound before scoring.
      const MAX_CANDIDATES = 50000;

      for (const oppRoster of rosters.filter((r) => r.owner_id !== user?.user_id && !ignoredOwnerIds.includes(r.owner_id) && (deferredTargetOppRosterId === null || r.roster_id === deferredTargetOppRosterId))) {
        if (results.length >= MAX_CANDIDATES) break;
        const oppPlayers = rosterPlayers(oppRoster);
        const oppPicks: PickWithValue[] = allPicks
          .filter((p) => p.owner_id === oppRoster.roster_id && !isBlockedBuyDisposition(finderPickKey(p), oppRoster.roster_id))
          .map((p) => ({ ...p, value: finderPickValue(p) }))
          .filter((p) => p.value > 0)
          .sort((a, b) => {
            const yearDiff = (draftYearPriority[a.season] ?? 999) - (draftYearPriority[b.season] ?? 999);
            if (yearDiff !== 0) return yearDiff;
            if (a.round !== b.round) return a.round - b.round;
            return b.value - a.value;
          })
          .slice(0, 8);

        // Receive pool: skill players worth ≥ LOW_VALUE_FLOOR (700). Sub-700 players are noise
        // (a 394-value TE or 545-value RB padding a package), so never receive them as
        // headliners or balancers. A target-pinned opponent player is re-added below; the
        // Lottery format (sourced separately from oppPlayers) keeps its low-value upside picks.
        // Also exclude "Zero Interest" buy-disposition players unless explicitly targeted.
        const oppTopBase = oppPlayers
          .filter((p) => !isBlockedBuyDisposition(p.player_id, oppRoster.roster_id) && (p.value ?? 0) >= LOW_VALUE_FLOOR);
        const targetPinnedOppPlayer = deferredTargetPlayerId && !isBlockedBuyDisposition(deferredTargetPlayerId, oppRoster.roster_id)
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

        // Sweetener-affinity (#6): a sub-700 give-side piece this opponent already rosters on
        // ≥2 of their OTHER dynasty leagues — proof they personally value the player. It is
        // value-neutral goodwill (excluded from all value math; see computeFinderAdjustedNet)
        // that only nudges acceptance, so it can ride alongside an already-balanced base.
        const oppOwnedCounts = leagueMateProfileByRosterId.get(oppRoster.roster_id)?.ownedPlayerCounts ?? {};
        // Search the FULL roster (sub-700 players are excluded from myTop by the pool floor).
        const sweetenerPiece = myPlayers.find(
          (p) => p.value < LOW_VALUE_FLOOR
            && (oppOwnedCounts[p.player_id] ?? 0) >= 2
            && !isBlockedSellDisposition(p.player_id),
        ) ?? null;

        // 1v1 — capped at the same sibling depth (18) as the multi-body formats.
        for (let mi = 0; mi < myCap(18); mi++) {
          const mp = myTop[mi];
          for (let oi = 0; oi < oppCap(18); oi++) {
            const op = oppTop[oi];
            if (!isBalanced([mp.value], [op.value])) continue;
            if (!qbSafe([mp])) continue;
            if (!oppQbSafe(oppPlayers, [op])) continue;
            if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
            results.push({
              give: [mp], receive: [op], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
              score: posScore([mp], [op]),
              net: op.value - mp.value, format: "1 for 1",
            });
            // Value-neutral sweetener variant of the same balanced base (net/score unchanged).
            if (sweetenerPiece && sweetenerPiece.player_id !== mp.player_id
              && myPkgOk([mp, sweetenerPiece]) && qbSafe([mp, sweetenerPiece])) {
              results.push({
                give: [mp, sweetenerPiece], receive: [op], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op]),
                net: op.value - mp.value, format: "1 for 1 + sweetener",
                sweetenerPlayerId: sweetenerPiece.player_id,
              });
            }
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
            for (let k = 0; k < oppCap(18); k++) {
              const op = oppTop[k];
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
          if (isBlockedBuyDisposition(p.player_id, oppRoster.roster_id)) return false;
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

      // ── Discarded-trade suppression ──────────────────────────────────────
      // Fingerprints of exact give/receive/opponent combinations the user dismissed via the
      // card's Discard button (components/tradeHub/shared.ts's buildTradeFingerprint) — only
      // still-active (unexpired) ones apply.
      const discardedFingerprints = new Set(
        Object.entries(discardedTrades[selectedLeague?.league_id ?? ""] ?? {})
          .filter(([, expiresAt]) => isBlockActive(expiresAt))
          .map(([fp]) => fp)
      );

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
        discardedFingerprints,
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
        isOffload,
        isPricey,
        isOpenToSell,
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
    calcFcValues, user, playerDispositions, finderSignals, leaguePlayerTags, allPicks,
    noInterestPlayers, discardedTrades,
    selectedLeagueDraftHasOccurred, pickFcValues, redraftValues, marketSignalMap,
    players, deferredPinnedPlayerId, deferredTargetOppRosterId, deferredTargetPlayerId,
    top32QBFloor, nflTeamDepth, ignoredOwnerIds, selectedLeagueSimulation,
    deferredFinderSeed, tradePartnerRankings, leagueMateProfileByRosterId,
    tradeAttempts, historicalSnapshot, playerStats, crossLeagueExposure,
    buyLowPlayerIds, finderWeeklyProjMap, finderStrategyOverride,
  ]);

  if (!selectedLeague) return (
    <p className="text-slate-400 text-sm">Select a league from the dropdown above to use the Trade Finder.</p>
  );
  // Block the entire finder until the authoritative direction profile is ready.
  // selectedLeagueDirectionAdjusted returns null whenever its inputs are mid-update
  // (league switch, sim recomputing for the new league, etc.). Showing stale trades
  // driven by the wrong direction is worse than showing a spinner.
  if (!selectedLeagueDirectionAdjusted) return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      <p className="text-sm text-slate-400">Computing direction engine…</p>
      <p className="text-xs text-slate-600">Analysing your roster, picks, and playoff simulation</p>
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
          <Card padding="lg" className="space-y-2">
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
              finderStrategyOverride={finderStrategyOverride}
              setFinderStrategyOverride={setFinderStrategyOverride}
            />
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Find trades involving a specific player</p>
            {pinnedPlayer ? (
              <div className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium">{pinnedPlayer.full_name}</span>
                  <span className="text-[10px] text-slate-500 uppercase">{pinnedPlayer.position}</span>
                  <span className="text-xs text-slate-500 font-mono">{pinnedPlayer.value.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => { setFinderPinnedPlayerId(null); }}
                  className="text-xs text-slate-500 hover:text-red-400 transition ml-3"
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
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
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
              <div className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Want to receive</span>
                  <span className="text-sm text-white font-medium">{targetPinnedPlayer.full_name}</span>
                  <span className="text-[10px] text-slate-500 uppercase">{targetPinnedPlayer.position}</span>
                  <span className="text-xs text-slate-500 font-mono">{targetPinnedPlayer.value.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => startTransition(() => { setFinderTargetPlayerId(null); setFinderSeed(Math.random()); })}
                  className="text-xs text-slate-500 hover:text-red-400 transition ml-3"
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
          </Card>

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {pinnedPlayer
                ? <>Trades involving <strong className="text-slate-300">{pinnedPlayer.full_name}</strong> for <strong className="text-slate-300">{selectedLeague.name}</strong>.</>
                : <>Random trade suggestions for <strong className="text-slate-300">{selectedLeague.name}</strong>.</>
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
            <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2 text-xs text-slate-500">
              <span className="text-red-500">🚫</span>
              {ignoredInLeague.length === 1
                ? <span><strong className="text-slate-400">{users[ignoredInLeague[0].owner_id] || "1 owner"}</strong> is on your ignore list and excluded from results.</span>
                : <span><strong className="text-slate-400">{ignoredInLeague.length} owners</strong> on your ignore list are excluded from results.</span>
              }
            </div>
          )}
          {/* Tagged assets strip — read-only summary. Editing now lives on Rosters & Rules
              (your own players/picks) and Opponent Rosters (their willingness to sell) in
              League Hub, so this strip only shows counts + a quick-remove per tag. */}
          {(() => {
            const leagueId = selectedLeague?.league_id ?? "";
            const leagueTags = leaguePlayerTags[leagueId] ?? {};
            const playerMap = players as Record<string, SleeperPlayer>;
            const assetLabel = (id: string) => {
              const p = playerMap[id];
              if (p) return p.full_name ?? id;
              const m = id.match(/^(\d{4})-(\d+)-(\d+)$/);
              return m ? `${m[1]} Rd ${m[2]} Pick` : id;
            };
            const byDisposition = (target: string) =>
              Object.entries(leagueTags).filter(([, t]) => normalizeDisposition(t) === target);
            // Tailwind can't resolve dynamically-interpolated class names, so each bucket
            // carries its complete, statically-written class strings rather than a color name.
            const buckets: { key: string; label: string; labelCls: string; chipCls: string; xCls: string }[] = [
              { key: "CORE", label: "Core — Do Not Sell", labelCls: "text-emerald-500", chipCls: "border-emerald-800 bg-emerald-950/30 text-emerald-300", xCls: "text-emerald-600" },
              { key: "PRICEY", label: "Pricey — Unlikely to Sell", labelCls: "text-amber-500", chipCls: "border-amber-800 bg-amber-950/30 text-amber-300", xCls: "text-amber-600" },
              { key: "SHOPPING", label: "Shopping — Small Interest", labelCls: "text-orange-500", chipCls: "border-orange-800 bg-orange-950/30 text-orange-300", xCls: "text-orange-600" },
              { key: "OFFLOAD", label: "Offload — Move ASAP", labelCls: "text-red-500", chipCls: "border-red-800 bg-red-950/30 text-red-300", xCls: "text-red-600" },
            ];
            const sellNoCount = byDisposition("SELL_NO").length;
            const hasAny = buckets.some((b) => byDisposition(b.key).length > 0) || sellNoCount > 0;
            if (!hasAny) return null;
            return (
              <div className="rounded-lg border border-slate-700 bg-slate-800/30 px-3 py-2 space-y-2">
                {buckets.map(({ key, label, labelCls, chipCls, xCls }) => {
                  const entries = byDisposition(key);
                  if (entries.length === 0) return null;
                  return (
                    <div key={key}>
                      <div className={`text-[9px] font-bold uppercase tracking-widest ${labelCls} mb-1`}>{label}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {entries.map(([id]) => (
                          <button
                            key={id}
                            onClick={() => onSetAssetDisposition(leagueId, id, null)}
                            title="Click to clear"
                            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] hover:border-red-600 hover:text-red-400 transition ${chipCls}`}
                          >
                            {assetLabel(id)} <span className={`${xCls} hover:text-red-400 ml-0.5`}>✕</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {sellNoCount > 0 && (
                  <p className="text-[10px] text-slate-500">
                    {sellNoCount} opponent asset{sellNoCount > 1 ? "s are" : " is"} marked Not Willing to Sell and excluded from suggestions.
                  </p>
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
            previewTradeSimulation={previewTradeSimulation}
            posTeamTotals={posTeamTotals}
            numTeams={numTeams}
            leaguePlayerTags={leaguePlayerTags}
            noInterestPlayers={noInterestPlayers}
            onSetNoInterest={onSetNoInterest}
            marketSignalMap={marketSignalMap}
            rankGapMap={finderRankGaps}
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
            onMarkAttempted={onMarkAttempted}
            onSessionMark={onSessionMark}
            onDiscardTrade={discardFinderTrade}
          />
        </div>
      );
}

export default React.memo(TradeFinder);