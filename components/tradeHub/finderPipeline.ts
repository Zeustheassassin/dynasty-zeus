import { getSeasonYear } from "../../lib/helpers";
import { classifyOppDirection, CONTENDER_BUCKETS, SELLER_BUCKETS } from "../../lib/helpers/direction/scoring";
import type {
  SleeperRoster, SleeperPlayer, SleeperUser, SleeperLeague,
  AugmentedPick, TradeAttempt, LeagueMateView, TradePartnerRanking,
  HistoricalSnapshot, LeagueSimulation,
} from "../../lib/types";
import {
  isFutureInsulationAsset, isOldProducerBuy,
  getAgeUrgency, getFutureValue, computeTeamWindow, getPickSlotBonus,
  isBalanced, LOW_VALUE_FLOOR, MID_VALUE_CEILING,
} from "./FinderScoring";
import { finderPickKey } from "./finderUtils";
import { buildTradeFingerprint } from "./shared";
import type { TradeResult } from "./finderTypes";
import { valueBearingGive } from "./finderTypes";
import type { PlayerWithValue } from "./shared";

// Shared injury-status classification — reused by the tank-mode receive filter (a hurt-but-
// talented player is an acceptable tank return alongside picks/youth) and by the emergency-fill
// and market-intel scoring below.
const INJURED_STATUSES = new Set(["ir", "out", "dnr", "pup", "nfi"]);

export interface FinderPipelineCtx {
  // Data
  allPicks: AugmentedPick[];
  players: Record<string, SleeperPlayer>;
  calcFcValues: Record<string, number>;
  redraftValues: Record<string, number>;
  rosters: SleeperRoster[];
  selectedLeague: SleeperLeague;
  user: SleeperUser | null;
  myPlayers: PlayerWithValue[];
  myRoster: SleeperRoster | undefined;
  numTeams: number;
  starterCounts: Record<string, number>;
  hasSuperFlex: boolean;
  draftYearPriority: Record<string, number>;
  priorityDraftYear: string;
  weakPositions: Set<string>;
  finderDirection: string;
  finderTankMode: boolean;
  draftCapitalMode: boolean;
  finderPreferFuturePicks: boolean;
  iAmTankingFinder: boolean;
  myFinderPlayoffOdds: number;
  isChampionshipPush: boolean;
  pinnedPlayer: PlayerWithValue | null;
  deferredTargetPlayerId: string | null;
  deferredPinnedPlayerId: string | null;
  deferredTargetOppRosterId: number | null;
  deferredFinderSeed: number;
  nflTeamDepth: Map<string, Record<string, PlayerWithValue[]>>;
  tradePartnerRankings: TradePartnerRanking[];
  leagueMateProfileByRosterId: Map<number, LeagueMateView>;
  tradeAttempts: TradeAttempt[];
  historicalSnapshot: HistoricalSnapshot | null;
  playerStats: Record<string, {
    avgTargets: number; avgCarries: number; snapPct: number; gamesPlayed: number;
    recentTargets?: number; recentCarries?: number; recentSnapPct?: number;
    targetTrend?: number; carryTrend?: number; snapTrend?: number;
  }> | null;
  crossLeagueExposure: Record<string, { count: number }> | null;
  buyLowPlayerIds: string[];
  nflState: { week: number; season_type: string; season: string; display_week?: number } | null;
  selectedLeagueSimulation: LeagueSimulation | null;
  selectedLeagueDraftHasOccurred: boolean;
  weeklyProjMap: Map<string, number>;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  // Functions
  finderPickValue: (p: AugmentedPick) => number;
  buildPostTradePlayers: (
    baseRoster: SleeperRoster | undefined,
    give: PlayerWithValue[],
    receive: PlayerWithValue[],
  ) => PlayerWithValue[];
  getNFLDepthIdx: (team: string, pos: string, playerId: string) => number | null;
  rosterPlayers: (roster: SleeperRoster | null | undefined) => PlayerWithValue[];
  isBlockedSellDisposition: (assetId?: string | null) => boolean;
  isBlockedBuyDisposition: (assetId?: string | null) => boolean;
  isWantToTrade: (assetId?: string | null) => boolean;
  isOffload: (assetId?: string | null) => boolean;
  isPricey: (assetId?: string | null) => boolean;
  isOpenToSell: (assetId?: string | null) => boolean;
  failsDirectionGuardrail: (r: TradeResult) => boolean;
  getDirectionTradeScore: (r: TradeResult) => number;
  getTradeLineupSafety: (r: TradeResult) => {
    valid: boolean; myValid: boolean; oppValid: boolean; score: number;
  };
}

export function runFinderPipeline(
  results: TradeResult[],
  ctx: FinderPipelineCtx,
): { allTrades: TradeResult[]; recentFingerprints: Set<string>; rosterOverflow: number } {
  const {
    allPicks, players, calcFcValues, redraftValues, rosters, selectedLeague,
    user, myPlayers, myRoster, numTeams, starterCounts, hasSuperFlex,
    draftYearPriority, priorityDraftYear, weakPositions, finderDirection,
    finderTankMode, draftCapitalMode, finderPreferFuturePicks, iAmTankingFinder,
    myFinderPlayoffOdds, isChampionshipPush, pinnedPlayer, deferredTargetPlayerId,
    deferredPinnedPlayerId, deferredTargetOppRosterId, deferredFinderSeed,
    nflTeamDepth, tradePartnerRankings, leagueMateProfileByRosterId, tradeAttempts,
    historicalSnapshot, playerStats, crossLeagueExposure, buyLowPlayerIds,
    nflState, selectedLeagueSimulation, selectedLeagueDraftHasOccurred,
    weeklyProjMap, playerDispositions, finderPickValue, buildPostTradePlayers,
    getNFLDepthIdx, rosterPlayers, isBlockedSellDisposition,
    isBlockedBuyDisposition, isWantToTrade, isOffload, isPricey, isOpenToSell,
    failsDirectionGuardrail, getDirectionTradeScore, getTradeLineupSafety,
  } = ctx;

  const getSortedIds = <T,>(items: T[], getId: (item: T) => string) =>
    items.map(getId).filter(Boolean).sort();
  const sameIds = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id, index) => id === b[index]);
  const overlapRatio = (a: string[], b: string[]) => {
    if (!a.length || !b.length) return 0;
    const bSet = new Set(b);
    const overlap = a.filter((id) => bSet.has(id)).length;
    return overlap / Math.min(a.length, b.length);
  };
  const getTradeSimilarityProfile = (trade: TradeResult) => {
    const givePlayers = getSortedIds(trade.give, (p) => String(p.player_id));
    const receivePlayers = getSortedIds(trade.receive, (p) => String(p.player_id));
    const givePicks = getSortedIds(trade.givePicks, (p) => finderPickKey(p));
    const receivePicks = getSortedIds(trade.receivePicks, (p) => finderPickKey(p));
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
  const areTradesTooSimilar = (a: TradeResult, b: TradeResult) => {
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

    const aGiveSet = new Set(aProfile.givePlayers);
    const bGiveSet = new Set(bProfile.givePlayers);
    const aRecvSet = new Set(aProfile.receivePlayers);
    const bRecvSet = new Set(bProfile.receivePlayers);
    const aGiveInB = aProfile.givePlayers.length > 0 && aProfile.givePlayers.every(id => bGiveSet.has(id));
    const aRecvInB = aProfile.receivePlayers.length > 0 && aProfile.receivePlayers.every(id => bRecvSet.has(id));
    const bGiveInA = bProfile.givePlayers.length > 0 && bProfile.givePlayers.every(id => aGiveSet.has(id));
    const bRecvInA = bProfile.receivePlayers.length > 0 && bProfile.receivePlayers.every(id => aRecvSet.has(id));
    if (aGiveInB && aRecvInB) return true;
    if (bGiveInA && bRecvInA) return true;

    return false;
  };

  // Hard block: every given player is a true HC RB going to someone who doesn't own the starter.
  const isWrongOwnerHCPackage = (r: TradeResult) => {
    if (r.give.length === 0) return false;
    return r.give.every((gp) => {
      if (gp.position !== "RB" || gp.value >= 1400) return false;
      const gpData = players[gp.player_id];
      if (!gpData?.team) return false;
      const gpIdx = getNFLDepthIdx(gpData.team, "RB", gp.player_id);
      if (gpIdx === null || gpIdx === 0) return false;
      const starter = nflTeamDepth.get(gpData.team)?.RB?.[0];
      const oppRoster = rosters.find((ros) => ros.roster_id === r.oppRosterId);
      const oppRosterPlayers = oppRoster ? rosterPlayers(oppRoster) : [];
      return !starter || !oppRosterPlayers.some((op) => op.player_id === starter.player_id);
    });
  };

  const isValidSameTeamPair = (team: string, p1: PlayerWithValue, p2: PlayerWithValue): boolean => {
    const pos1 = String(p1.position), pos2 = String(p2.position);
    if ((pos1 === "QB" && pos2 === "WR") || (pos1 === "WR" && pos2 === "QB")) return true;
    if ((pos1 === "QB" && pos2 === "TE") || (pos1 === "TE" && pos2 === "QB")) return true;
    if (pos1 === "RB" && pos2 === "RB") {
      const idx1 = getNFLDepthIdx(team, "RB", p1.player_id);
      const idx2 = getNFLDepthIdx(team, "RB", p2.player_id);
      if (idx1 !== null && idx2 !== null) {
        const oneIsStarter  = idx1 === 0 || idx2 === 0;
        const oneIsBackup   = idx1 >= 1  || idx2 >= 1;
        if (oneIsStarter && oneIsBackup) return true;
      }
    }
    return false;
  };
  const hasBadSameTeamCombo = (side: PlayerWithValue[]): boolean => {
    const byTeam = new Map<string, PlayerWithValue[]>();
    for (const p of side) {
      const team = players[p.player_id]?.team;
      if (!team) continue;
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team)!.push(p);
    }
    for (const [team, tPlayers] of byTeam) {
      if (tPlayers.length < 2) continue;
      for (let i = 0; i < tPlayers.length; i++) {
        for (let j = i + 1; j < tPlayers.length; j++) {
          if (!isValidSameTeamPair(team, tPlayers[i], tPlayers[j])) return true;
        }
      }
    }
    return false;
  };

  const oppProfileByRosterId = new Map(
    tradePartnerRankings.map((p) => [Number(p.rosterId), p])
  );

  // Hard structural acceptance pre-filter (#10): judged on the opponent's ADJUSTED window
  // bucket via the canonical classifier, not raw playoff odds — so the front-door gate
  // agrees with oppDirectionScore. Drops trades a tanker/buyer would never make.
  const oppDirOk = (r: TradeResult): boolean => {
    const oppProfile = oppProfileByRosterId.get(Number(r.oppRosterId));
    const oppOdds = oppProfile?.playoffOdds
      ?? selectedLeagueSimulation?.rowByRosterId?.get(Number(r.oppRosterId))?.playoffOdds
      ?? 50;
    const cls = classifyOppDirection(oppProfile?.directionProfile?.bucket ?? "", oppOdds);
    // Rule 1: a hopeless/tanking team won't take our 1st-round pick plus only aging vets
    // while sending back established players and no picks/youth — they need picks, not vets.
    if (cls.isHopeless) {
      const givingFirstRound = r.givePicks.some((p) => Number(p.round) === 1);
      const receivingOnlyVets = r.give.length > 0
        && r.give.every((p) => isOldProducerBuy(p))
        && r.receivePicks.length === 0
        && r.receive.filter((p) => isFutureInsulationAsset(p)).length === 0;
      if (givingFirstRound && receivingOnlyVets) return false;
    }
    // Rule 2: a clear buyer (elite/contender) won't give up players for only the user's picks.
    if ((cls.isElite || cls.isContender)
        && r.receive.length > 0 && r.give.length === 0 && r.receivePicks.length === 0) {
      return false;
    }
    return true;
  };

  // Anti-padding gate (#8): a sub-700 piece may RIDE in a package, but it must not be the
  // thing making the trade balance. If removing a sub-700 body (other than a flagged affinity
  // sweetener, and only when its side has another player) breaks isBalanced, that body was
  // manufacturing fake balance to "bring the value closer so it fits" — drop the whole trade.
  // Lottery / draft-capital formats are intentionally low-value and exempt.
  const lowValueBalancerOk = (r: TradeResult): boolean => {
    if (r.format === "Lottery" || r.draftCapital) return true;
    const giveForCheck = r.sweetenerPlayerId
      ? r.give.filter((p) => p.player_id !== r.sweetenerPlayerId)
      : r.give;
    const allGive = [...giveForCheck.map((p) => p.value), ...r.givePicks.map((p) => p.value)];
    const allReceive = [...r.receive.map((p) => p.value), ...r.receivePicks.map((p) => p.value)];
    if (giveForCheck.length >= 2) {
      for (let i = 0; i < giveForCheck.length; i++) {
        if (giveForCheck[i].value >= LOW_VALUE_FLOOR) continue;
        if (!isBalanced(allGive.filter((_, idx) => idx !== i), allReceive)) return false;
      }
    }
    if (r.receive.length >= 2) {
      for (let i = 0; i < r.receive.length; i++) {
        if (r.receive[i].value >= LOW_VALUE_FLOOR) continue;
        if (!isBalanced(allGive, allReceive.filter((_, idx) => idx !== i))) return false;
      }
    }
    return true;
  };

  // Hard window guardrail: a team building dynasty value (NOT win-now) must never ACQUIRE an
  // aging, depreciating veteran — an old producer only helps a genuine contender; for everyone
  // else it just burns value over a window they aren't competing in. Win-now = a contender
  // bucket, a championship push, or ≥50% playoff odds. (Selling old producers is unaffected —
  // this only blocks RECEIVING them. A pinned/targeted player still routes through the pin
  // filters above.) This is the rule a pick-rich "Consolidate"/Rebuilder team needs: it must
  // not spend even its excess picks turning a young asset + future pick into an aging vet.
  // Win-now = a contender bucket, a championship push, or a winning sim — but NEVER while
  // actively tanking (a tanker is selling, even with a stale Almost There / Window Closing
  // bucket), and the bare odds>=50 path excludes seller buckets (a high sim seed on a
  // value-rich/points-poor roster doesn't make it a buyer of aging vets).
  const userIsWinNow = !iAmTankingFinder && (
    isChampionshipPush
    || CONTENDER_BUCKETS.includes(finderDirection)
    || (myFinderPlayoffOdds >= 50 && !SELLER_BUCKETS.includes(finderDirection))
  );
  const userWindowOk = (r: TradeResult): boolean =>
    userIsWinNow
    || !!deferredTargetPlayerId
    || !r.receive.some((p) => isOldProducerBuy(p));

  const preGuardrail = results
    .filter((r) => isFinite(r.score))
    .filter((r) => !r.give.some((p) => isBlockedSellDisposition(p.player_id)))
    .filter((r) => !r.receive.some((p) => isBlockedBuyDisposition(p.player_id)))
    .filter((r) => !pinnedPlayer || r.give.some((p) => p.player_id === pinnedPlayer.player_id))
    .filter((r) => !deferredTargetPlayerId || r.receive.some((p) => p.player_id === deferredTargetPlayerId))
    .filter((r) => !isWrongOwnerHCPackage(r))
    .filter((r) => !hasBadSameTeamCombo(r.give) && !hasBadSameTeamCombo(r.receive))
    .filter((r) => !finderTankMode || r.receive.every((p) =>
      isFutureInsulationAsset(p) ||
      (INJURED_STATUSES.has((players[p.player_id]?.injury_status ?? "").toLowerCase()) && (p.value ?? 0) >= 1500)
    ))
    .filter((r) => oppDirOk(r))
    .filter((r) => lowValueBalancerOk(r))
    .filter((r) => userWindowOk(r));
  const hasGuardrailPassing = !finderTankMode && preGuardrail.some((r) => !failsDirectionGuardrail(r));

  // ── Roster concentration map ────────────────────────────────────────────
  const rosterConcentrationMap = new Map<number, Record<string, number>>();
  for (const rr of rosters.filter((rr) => rr.owner_id !== user?.user_id)) {
    const rPlayers = rosterPlayers(rr);
    const concMap: Record<string, number> = {};
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const posPlayers = rPlayers
        .filter((p) => p.position === pos)
        .sort((a, b) => b.value - a.value);
      const total = posPlayers.reduce((s: number, p) => s + (p.value || 0), 0);
      const top1 = posPlayers[0]?.value ?? 0;
      concMap[pos] = total > 0 ? top1 / total : 0;
    }
    rosterConcentrationMap.set(Number(rr.roster_id), concMap);
  }

  const myTeamWindow = computeTeamWindow(myPlayers);

  // ── PENDING suppression map ──────────────────────────────────────────────
  const pendingGiveByOpp  = new Map<number, Set<string>>();
  const pendingRecvByOpp  = new Map<number, Set<string>>();
  tradeAttempts
    .filter((a) =>
      a.league_id === selectedLeague?.league_id &&
      a.status === "PENDING" &&
      a.initiated_by === "ME"
    )
    .forEach((a) => {
      const oppId = Number(a.partner_roster_id);
      if (!pendingGiveByOpp.has(oppId)) pendingGiveByOpp.set(oppId, new Set());
      if (!pendingRecvByOpp.has(oppId)) pendingRecvByOpp.set(oppId, new Set());
      a.give_players.forEach((p) => pendingGiveByOpp.get(oppId)!.add(p.player_id));
      a.receive_players.forEach((p) => pendingRecvByOpp.get(oppId)!.add(p.player_id));
    });

  // ── Format win-rate map from logged FINDER attempts ────────────────────
  const formatWinRates = (() => {
    const resolved = tradeAttempts.filter(
      (a) => a.source === "FINDER" && a.initiated_by === "ME" && a.status !== "PENDING"
    );
    const scores = new Map<string, { score: number; count: number }>();
    for (const a of resolved) {
      const key = `${a.give_players.length + a.give_picks.length}v${a.receive_players.length + a.receive_picks.length}`;
      const pts = a.status === "ACCEPTED" ? 1.0 : a.status === "COUNTERED" ? 0.5 : 0;
      const entry = scores.get(key) ?? { score: 0, count: 0 };
      scores.set(key, { score: entry.score + pts, count: entry.count + 1 });
    }
    const rates = new Map<string, number>();
    scores.forEach(({ score, count }, key) => {
      if (count >= 2) rates.set(key, score / count);
    });
    return rates;
  })();

  // ── Season timing context ────
  const nflWeek = nflState?.season_type === "regular"
    ? (nflState?.display_week ?? nflState?.week ?? 0)
    : 0;
  const isTradeDeadlineWindow = nflWeek >= 10 && nflWeek <= 13;
  const isEarlySeason         = nflWeek >= 1  && nflWeek <= 5;
  const isLateSeasonPost      = nflWeek >= 14;

  // ── Draft proximity multiplier ──────
  const draftProximityMultiplier: number = (() => {
    if (selectedLeagueDraftHasOccurred) return 1.0;
    const seasonType = nflState?.season_type ?? "pre";
    if (seasonType === "pre" || seasonType === "off") return 1.0;
    if (isEarlySeason) return 0.35;
    if (isLateSeasonPost) return 0.75;
    if (isTradeDeadlineWindow) return 0.50;
    return 0.50;
  })();

  // ── Standings pressure map ──────────────────────────────────────────────
  const playoffTeamCount   = selectedLeague?.settings?.playoff_teams ?? 6;
  const playoffWeekStart   = selectedLeague?.settings?.playoff_week_start ?? 15;
  const weeksRemaining     = nflWeek > 0 ? Math.max(0, (playoffWeekStart - 1) - nflWeek) : 0;

  const sortedStandings = [...rosters]
    .map((rr) => ({
      rosterId: Number(rr.roster_id),
      wins: (rr.settings?.wins ?? 0) + (rr.settings?.ties ?? 0) * 0.5,
    }))
    .sort((a, b) => b.wins - a.wins);
  const lastPlayoffSpotWins = sortedStandings[playoffTeamCount - 1]?.wins ?? 0;
  const standingsMap = new Map(sortedStandings.map((s, idx) => [s.rosterId, { ...s, playoffRank: idx + 1 }]));

  // ── Roster overflow detection ─────────────────────────────────────────
  const totalRosterSlots =
    (selectedLeague?.roster_positions || []).length +
    (selectedLeague?.settings?.taxi_slots ?? 0) +
    (selectedLeague?.settings?.reserve_slots ?? 0);
  const currentOwnedPlayers = (myRoster?.players || []).length;
  // Once the rookie draft is done, the priority year shifts to NEXT year and
  // those picks are ~12 months away — too far to be a current roster-pressure
  // signal. The "Roster pressure +X" badge should only fire when picks are
  // imminent (i.e., before this year's draft).
  const upcomingDraftPickCount = selectedLeagueDraftHasOccurred
    ? 0
    : allPicks.filter(
        (p) =>
          Number(p.owner_id) === Number(myRoster?.roster_id) &&
          String(p.season) === priorityDraftYear
      ).length;
  const allLeagueUpcomingPickValues = allPicks
    .filter((p) => String(p.season) === priorityDraftYear)
    .map((p) => finderPickValue(p))
    .filter((v: number) => v > 0);
  const leagueWorstPickValue =
    allLeagueUpcomingPickValues.length > 0 ? Math.min(...allLeagueUpcomingPickValues) : 500;
  const subThresholdCount = myPlayers.filter(
    (p) => (p.value ?? 0) < leagueWorstPickValue
  ).length;
  const cuttableRate = selectedLeagueDraftHasOccurred ? 0.15 : 0.57;
  const cuttablePlayerCount = Math.round(subThresholdCount * cuttableRate);
  const effectivePlayerCount = currentOwnedPlayers - cuttablePlayerCount;
  const projectedRosterAfterDraft = effectivePlayerCount + upcomingDraftPickCount;
  const rosterOverflow = Math.max(0, projectedRosterAfterDraft - totalRosterSlots);

  // Per-position viable depth count
  const myViableDepth: Record<string, number> = {};
  for (const pos of ["QB", "RB", "WR", "TE"] as const) {
    myViableDepth[pos] = myPlayers.filter(
      (p) => p.position === pos && (p.value ?? 0) >= 1500
    ).length;
  }

  // Acceptance-first hard gate: on a standard swap, reject trades the opponent has no real
  // reason to accept. oppDirectionScore mixes value + structural fit, so fair-but-neutral
  // trades land mildly negative (a single aging vet ≈ -4); the genuine "they'd never accept"
  // signals are large negatives (elite asked for picks-only ≈ -18, rebuilder handed pure
  // vets ≈ -11). -10 rejects those structural mismatches while keeping neutral fair trades.
  // Tunable: raise toward 0 for a stricter board (fewer, higher-conviction trades).
  const ACCEPT_FLOOR = -10;

  // O(1) candidate index lookup for the seeded tiebreak below — avoids an O(n^2) results.indexOf
  // per surviving candidate (the MAX_CANDIDATES ceiling makes the worst case large).
  const resultIndex = new Map<TradeResult, number>(results.map((rr, i) => [rr, i]));

  // Seeded shuffle so Refresh button produces a new random set
  const shuffled = preGuardrail
    .filter((r) => finderTankMode || !hasGuardrailPassing || !failsDirectionGuardrail(r))
    .filter((r) => {
      const pendingRecv = pendingRecvByOpp.get(Number(r.oppRosterId));
      const pendingGive = pendingGiveByOpp.get(Number(r.oppRosterId));
      if (!pendingRecv && !pendingGive) return true;
      const topRecv = [...r.receive].sort((a, b) => b.value - a.value)[0];
      if (topRecv && pendingRecv?.has(topRecv.player_id)) return false;
      const topGive = [...r.give].sort((a, b) => b.value - a.value)[0];
      if (topGive && pendingGive?.has(topGive.player_id)) return false;
      return true;
    })
    .map((r) => {
      const lineupSafety = getTradeLineupSafety(r);
      const partnerProfile = leagueMateProfileByRosterId.get(Number(r.oppRosterId));
      const bucketPriority = draftCapitalMode && r.receivePicks.length > 0
        ? (finderPreferFuturePicks
            ? -(Math.max(...r.receivePicks.map((p) => draftYearPriority[p.season] ?? 0)))
            : Math.min(...r.receivePicks.map((p) => draftYearPriority[p.season] ?? 999)))
        : 999;
      const partnerFitScore =
        (partnerProfile?.fitScore ?? 0) * 0.65 +
        Math.min(partnerProfile?.tradeCount30d ?? 0, 3) * 1.5 +
        Math.min(partnerProfile?.totalDynastyLeagues ?? 0, 8) * 0.35;
      const sellScoreMap: Record<string, number> = {
        "Trade at All Costs": 4, "Lower than Market": 2, "Neutral": 1,
        "Will Trade but Higher than Market": -1,
      };
      const buyScoreMap: Record<string, number> = {
        "Buy Over Market": 4, "Buy at Market": 2, "Neutral": 1, "Buy Low": -1,
      };
      const dispositionScore = (() => {
        let ds = 0;
        const dsGive = valueBearingGive(r); // strip value-neutral sweetener from sell scoring
        ds += dsGive.reduce((s: number, gp) =>
          s + (sellScoreMap[playerDispositions[gp.player_id]?.sell ?? "Neutral"] ?? 0), 0);
        ds += r.receive.reduce((s: number, rp) =>
          s + (buyScoreMap[playerDispositions[rp.player_id]?.buy ?? "Neutral"] ?? 0), 0);
        const sellHighGiven = dsGive.filter((gp) =>
          playerDispositions[gp.player_id]?.sell === "Will Trade but Higher than Market"
        ).length;
        if (sellHighGiven > 0 && r.net < -150) ds -= sellHighGiven * 8;
        if (sellHighGiven > 0 && r.net >= 0)   ds += sellHighGiven * 4;
        const buyLowReceived = r.receive.filter((rp) =>
          playerDispositions[rp.player_id]?.buy === "Buy Low"
        ).length;
        if (buyLowReceived > 0 && r.net < -150) ds -= buyLowReceived * 8;
        if (buyLowReceived > 0 && r.net >= 0)   ds += buyLowReceived * 5;
        return ds;
      })();
      const oppDirectionScore = (() => {
        const oppProfile     = oppProfileByRosterId.get(Number(r.oppRosterId));
        const oppPlayoffOdds = oppProfile?.playoffOdds
          ?? selectedLeagueSimulation?.rowByRosterId?.get(Number(r.oppRosterId))?.playoffOdds
          ?? 50;
        const oppBucket = oppProfile?.directionProfile?.bucket ?? "";

        const oppReceivesPlayers = valueBearingGive(r); // strip value-neutral sweetener
        const oppReceivesPicks   = r.givePicks;
        const oppGivesPlayers    = r.receive;
        const oppGivesPicks      = r.receivePicks;

        // Canonical classification — same ladder used by oppDirOk, crossLeagueIntel, the
        // acceptance gate, and the leaguemate rankings (lib/helpers/direction/scoring).
        const {
          isHopeless: oppIsHopeless, isRebuild: oppIsRebuild, isElite: oppIsElite,
          isContender: oppIsContender, isFading: oppIsFading,
        } = classifyOppDirection(oppBucket, oppPlayoffOdds);

        const oppReceivesRedraft = oppReceivesPlayers.reduce((s: number, p) => s + (redraftValues?.[p.player_id] ?? 0), 0);
        const oppGivesRedraft    = oppGivesPlayers.reduce((s: number, p) => s + (redraftValues?.[p.player_id] ?? 0), 0);
        const oppReceivesYoung   = oppReceivesPlayers.filter((p) => isFutureInsulationAsset(p)).length;
        const oppReceivesVets    = oppReceivesPlayers.filter((p) => isOldProducerBuy(p)).length;
        const oppGivesVets       = oppGivesPlayers.filter((p) => isOldProducerBuy(p)).length;
        const oppGivesYoung      = oppGivesPlayers.filter((p) => isFutureInsulationAsset(p)).length;

        const pickRecvScore = (base1st: number, base2nd: number, baseLate: number) =>
          oppReceivesPicks.reduce((s: number, p) => {
            const rd = Number(p.round);
            return s + (rd === 1 ? base1st : rd === 2 ? base2nd : baseLate);
          }, 0);
        const pickGiveScore = (base1st: number, base2nd: number, baseLate: number) =>
          oppGivesPicks.reduce((s: number, p) => {
            const rd = Number(p.round);
            return s + (rd === 1 ? base1st : rd === 2 ? base2nd : baseLate);
          }, 0);

        let ods = 0;

        if (oppIsHopeless) {
          ods += pickRecvScore(16, 10, 6);
          ods += oppReceivesYoung * 9;
          ods -= oppReceivesVets * 10;
          ods += oppGivesVets * 8;
          ods -= pickGiveScore(12, 8, 4);
          ods -= oppGivesYoung * 8;
          if (oppReceivesVets > 0 && oppReceivesPicks.length === 0 && oppReceivesYoung === 0) ods -= 12;

        } else if (oppIsRebuild) {
          ods += pickRecvScore(12, 7, 4);
          ods += oppReceivesYoung * 7;
          ods -= oppReceivesVets * 7;
          ods += oppGivesVets * 5;
          ods -= pickGiveScore(8, 5, 2);
          ods -= oppGivesYoung * 5;
          if (oppReceivesVets > 0 && oppReceivesPicks.length === 0 && oppReceivesYoung === 0) ods -= 9;

        } else if (oppIsElite) {
          const netRedraft = oppReceivesRedraft - oppGivesRedraft;
          ods += Math.min(netRedraft / 40, 12);
          ods -= pickRecvScore(12, 8, 5);
          ods -= pickGiveScore(4, 3, 2);
          ods += oppReceivesVets * 5;
          ods -= oppReceivesYoung * 6;
          if (oppReceivesPlayers.length === 0 && oppReceivesPicks.length > 0) ods -= 14;

        } else if (oppIsContender) {
          const netRedraft = oppReceivesRedraft - oppGivesRedraft;
          ods += Math.min(netRedraft / 50, 8);
          ods -= pickRecvScore(8, 5, 3);
          ods -= oppReceivesYoung * 3;
          ods += oppReceivesVets * 4;
          if (oppReceivesPlayers.length === 0 && oppReceivesPicks.length > 0) ods -= 10;

        } else if (oppIsFading) {
          const netRedraft = oppReceivesRedraft - oppGivesRedraft;
          ods += Math.min(netRedraft / 55, 6);
          ods -= pickRecvScore(6, 4, 2);
          ods += oppReceivesVets * 2;
          ods -= oppGivesVets * 3;

        } else {
          const netRedraft = oppReceivesRedraft - oppGivesRedraft;
          ods += Math.min(netRedraft / 70, 4);
          ods -= pickRecvScore(4, 2, 1);
          ods += oppReceivesYoung * 2;
        }

        if (oppGivesPicks.length === 0 && (oppIsRebuild || oppIsHopeless)) ods += 3;

        const oppPosRanks = (oppProfile?.directionProfile?.positionRanks ?? []) as Array<{ pos: string; rank: number }>;
        const oppConc = rosterConcentrationMap.get(Number(r.oppRosterId)) ?? {};
        if (oppPosRanks.length > 0) {
          const oppWeakPos = new Set(
            oppPosRanks
              .filter((pr) => pr.rank >= Math.ceil(numTeams * 0.6))
              .map((pr) => pr.pos)
          );
          const oppStrongPos = new Set(
            oppPosRanks
              .filter((pr) => pr.rank <= Math.ceil(numTeams * 0.3))
              .map((pr) => pr.pos)
          );
          oppReceivesPlayers
            .filter((p) => oppWeakPos.has(p.position) && p.value >= 1500)
            .forEach((p) => {
              const conc = oppConc[p.position] ?? 0;
              ods += 7 + (conc > 0.65 ? 4 : conc > 0.50 ? 2 : 0);
            });
          const surplusGiven = oppReceivesPlayers.filter(
            (p) => oppStrongPos.has(p.position) && p.value >= 2000
          ).length;
          ods -= surplusGiven * 3;
          const demandedStrength = oppGivesPlayers.filter(
            (p) => oppStrongPos.has(p.position) && p.value >= 2000
          ).length;
          ods -= demandedStrength * 4;
        }

        if (hasSuperFlex && oppPosRanks.length > 0) {
          const oppQBRank = oppPosRanks.find((pr) => pr.pos === "QB")?.rank ?? numTeams;
          if (oppQBRank >= Math.ceil(numTeams * 0.5)) {
            const qbsReceived = oppReceivesPlayers.filter((p) => p.position === "QB").length;
            if (qbsReceived > 0) ods += 9;
            const qbsDemanded = oppGivesPlayers.filter((p) => p.position === "QB").length;
            if (qbsDemanded > 0) ods -= 8;
          }
        }

        {
          const oppRosterForQB = rosters.find((ros) => Number(ros.roster_id) === Number(r.oppRosterId));
          const oppQBValuesSorted = (oppRosterForQB?.players ?? [])
            .filter((pid) => players[pid]?.position === "QB")
            .map((pid) => calcFcValues[pid] ?? 0)
            .filter((v) => v > 0)
            .sort((a, b) => b - a);
          const qbStartingSlots = hasSuperFlex ? 2 : 1;
          const oppGiveTopValue = Math.max(
            0,
            ...oppGivesPlayers.map((p) => p.value),
            ...oppGivesPicks.map((p) => p.value)
          );
          const giveQualityFactor = Math.min(1.0, oppGiveTopValue / 2500);
          oppReceivesPlayers.filter((p) => p.position === "QB").forEach((qb) => {
            const qbsAbove = oppQBValuesSorted.filter((v) => v > qb.value).length;
            if (qbsAbove >= qbStartingSlots) {
              const depthExcess = qbsAbove - qbStartingSlots + 1;
              ods -= Math.round(qb.value * 0.50 * depthExcess * giveQualityFactor);
            }
          });
        }

        {
          const oppRosterForInjury = rosters.find((ros) => Number(ros.roster_id) === Number(r.oppRosterId));
          if (oppRosterForInjury) {
            const oppAllPlayers = rosterPlayers(oppRosterForInjury);
            const injStatuses = new Set(["ir", "out", "dnr", "pup"]);
            const injuredPositions = new Set<string>();
            oppAllPlayers.forEach((p) => {
              const inj = (players[p.player_id]?.injury_status ?? "").toLowerCase();
              if (injStatuses.has(inj) && (p.value ?? 0) >= 2000) {
                injuredPositions.add(p.position);
              }
            });
            if (injuredPositions.size > 0) {
              const emergencyFills = oppReceivesPlayers.filter(
                (p) => injuredPositions.has(p.position) && (p.value ?? 0) >= 1500
              ).length;
              ods += emergencyFills * 11;
              const takingReplacement = oppGivesPlayers.filter(
                (p) => injuredPositions.has(p.position) && (p.value ?? 0) >= 1500
              ).length;
              ods -= takingReplacement * 7;
            }
          }
        }

        return Math.round(ods * 1.25);
      })();

      const formatBonus = (() => {
        const totalGive = r.give.length + r.givePicks.length;
        const totalRecv = r.receive.length + r.receivePicks.length;
        const total = totalGive + totalRecv;
        if (total === 2) return 12;
        if (total === 3) return 9;
        if (totalGive === 2 && totalRecv === 2) return 7;
        if (total === 4) return -2;
        if (total === 5) return -10;
        return -18;
      })();

      const HC_VALUE_THRESHOLD = 1400;
      const handcuffBonus = (() => {
        let hb = 0;
        const oppRosterForHandcuff = rosters.find((ros) => ros.roster_id === r.oppRosterId);
        const oppRosterPlayers = oppRosterForHandcuff ? rosterPlayers(oppRosterForHandcuff) : [];

        for (const gp of r.give) {
          if (gp.position !== "RB") continue;
          const gpData = players[gp.player_id];
          if (!gpData?.team) continue;
          const gpIdx = getNFLDepthIdx(gpData.team, "RB", gp.player_id);
          if (gpIdx === null) continue;

          if (gpIdx === 0) {
            const rb2 = nflTeamDepth.get(gpData.team)?.RB?.[1];
            if (rb2 && oppRosterPlayers.some((op) => op.player_id === rb2.player_id)) hb += 4;
          } else if (gp.value < HC_VALUE_THRESHOLD) {
            const scale = gpIdx === 1 ? 1.0 : gpIdx === 2 ? 0.5 : 0.25;
            const starter = nflTeamDepth.get(gpData.team)?.RB?.[0];
            const oppOwnsStarter = !!starter && oppRosterPlayers.some((op) => op.player_id === starter.player_id);
            if (oppOwnsStarter) {
              hb += Math.round(6 * scale);
            } else {
              hb -= Math.round(18 * scale);
            }
          }
        }

        for (const rp of r.receive) {
          if (rp.position !== "RB") continue;
          const rpData = players[rp.player_id];
          if (!rpData?.team) continue;
          const rpIdx = getNFLDepthIdx(rpData.team, "RB", rp.player_id);
          if (rpIdx === null || rpIdx === 0) continue;
          if (rp.value >= HC_VALUE_THRESHOLD) continue;
          const scale = rpIdx === 1 ? 1.0 : rpIdx === 2 ? 0.5 : 0.25;
          const starter = nflTeamDepth.get(rpData.team)?.RB?.[0];
          const iOwnStarter = !!starter && myPlayers.some((mp) => mp.player_id === starter.player_id);
          if (iOwnStarter) hb += Math.round(4 * scale);
        }

        return hb;
      })();

      const starPremiumScore = (() => {
        const allGiveVals    = [...valueBearingGive(r).map((p) => p.value), ...r.givePicks.map((p) => p.value)];
        const allReceiveVals = [...r.receive.map((p) => p.value), ...r.receivePicks.map((p) => p.value)];
        if (allGiveVals.length === 0 || allReceiveVals.length === 0) return 0;
        const topGive    = Math.max(...allGiveVals);
        const topReceive = Math.max(...allReceiveVals);
        const spsGlobalTop = Math.max(...allGiveVals, ...allReceiveVals);
        const pickScoreParams = (picks: Array<{ round: number | string; value: number }>): { threshold: number; scale: number } => {
          if (picks.length === 0) return { threshold: 0.78, scale: 1.0 };
          const best = Math.min(...picks.map((p) => Number(p.round)));
          if (best === 1) {
            const bestFirstVal = Math.max(...picks.filter((p) => Number(p.round) === 1).map((p) => p.value));
            if (bestFirstVal >= spsGlobalTop * 0.97) return { threshold: 0.78, scale: 1.0 };
            return { threshold: 0.78, scale: 0.10 };
          }
          if (best === 2) return { threshold: 0.83, scale: 0.75 };
          if (best === 3) return { threshold: 0.87, scale: 1.00 };
          return              { threshold: 0.91, scale: 1.50 };
        };
        const recvParams = pickScoreParams(r.receivePicks);
        const giveParams = pickScoreParams(r.givePicks);
        let sps = 0;
        if (topGive >= 2000 && allReceiveVals.length >= 2) {
          const ratio = topReceive / topGive;
          if (ratio < recvParams.threshold) sps -= Math.round(recvParams.scale * Math.min((recvParams.threshold - ratio) / 0.25, 1.0) * 22);
        }
        if (topReceive >= 2000 && allGiveVals.length >= 2) {
          const ratio = topGive / topReceive;
          if (ratio < giveParams.threshold) sps -= Math.round(giveParams.scale * Math.min((giveParams.threshold - ratio) / 0.25, 1.0) * 22);
        }
        return sps;
      })();

      // Asymmetric (acceptance-first ranking): steeply penalize the USER overpaying
      // (net < 0), but only mildly and boundedly reward the user gaining value (net > 0) so a
      // single lopsided-but-acceptable deal can't dominate the board. Pairs with the signed
      // user-gain sort in FinderResults. At net = 0 this is 0, matching the prior symmetric form.
      const balancePenalty = r.net < 0
        ? -Math.pow(Math.abs(r.net) / 150, 1.5) * 3   // user pays up — steep penalty
        : Math.min(r.net / 150, 4);                    // user gains — small bounded reward

      const futurePickBonus = (() => {
        if (!finderPreferFuturePicks || r.receivePicks.length === 0) return 0;
        const currentYear = Number(getSeasonYear(nflState));
        return r.receivePicks.reduce((s: number, p) => {
          const yr = Number(p.season);
          if (yr === currentYear) return s - 4;
          if (yr === currentYear + 1) return s + 5;
          return s + 7;
        }, 0);
      })();

      const attemptIntelScore = (() => {
        if (!selectedLeague?.league_id || tradeAttempts.length === 0) return 0;
        const now = Date.now();
        const FULL_WINDOW  = 14 * 24 * 60 * 60 * 1000;
        const HALF_WINDOW  = 56 * 24 * 60 * 60 * 1000;
        const weight = (iso: string) => {
          const age = now - new Date(iso).getTime();
          if (age <= FULL_WINDOW) return 1.0;
          if (age <= HALF_WINDOW) return 0.5;
          return 0;
        };

        const oppAttempts = tradeAttempts.filter(
          (a) => a.league_id === selectedLeague.league_id &&
                 Number(a.partner_roster_id) === Number(r.oppRosterId)
        );
        if (oppAttempts.length === 0) return 0;

        const theirSellWeight   = new Map<string, number>();
        const theirBuyWeight    = new Map<string, number>();
        const myShopWeight      = new Map<string, number>();
        const myTargetWeight    = new Map<string, number>();
        // Decline memory: a deal I FLOATED that this owner refused is evidence against re-pitching
        // the same pieces. declinedReceive = a player I asked for and they wouldn't part with;
        // declinedGive = a player I offered and they wouldn't take. DECLINED counts full; NO_RESPONSE
        // (a ghost) counts half. COUNTERED is engagement, not refusal, so it stays "live" below.
        const declinedReceiveWeight = new Map<string, number>();
        const declinedGiveWeight    = new Map<string, number>();
        // Cap accumulated decline weight so chasing one player with several escalating offers can't
        // stack an unbounded penalty that buries every OTHER package merely containing that player.
        // One refusal already fires at full strength; repeats add a little, then plateau.
        const DECLINE_WEIGHT_CAP = 1.5;

        for (const a of oppAttempts) {
          const w = weight(a.attempted_at);
          if (w === 0) continue;
          if (a.initiated_by === "THEM") {
            // Their own offer reveals appetite regardless of how I ended up responding to it.
            for (const p of a.give_players)    theirSellWeight.set(p.player_id,  (theirSellWeight.get(p.player_id)  ?? 0) + w);
            for (const p of a.receive_players) theirBuyWeight.set(p.player_id,   (theirBuyWeight.get(p.player_id)   ?? 0) + w);
          } else if (a.status === "DECLINED" || a.status === "NO_RESPONSE") {
            // My offer, refused — a soft, decaying aversion to re-pitching the same players.
            const rw = w * (a.status === "DECLINED" ? 1 : 0.5);
            for (const p of a.give_players)    declinedGiveWeight.set(p.player_id,    (declinedGiveWeight.get(p.player_id)    ?? 0) + rw);
            for (const p of a.receive_players) declinedReceiveWeight.set(p.player_id, (declinedReceiveWeight.get(p.player_id) ?? 0) + rw);
          } else {
            // My offer, still live (PENDING / COUNTERED) or struck (ACCEPTED): standing interest.
            for (const p of a.give_players)    myShopWeight.set(p.player_id,     (myShopWeight.get(p.player_id)     ?? 0) + w);
            for (const p of a.receive_players) myTargetWeight.set(p.player_id,   (myTargetWeight.get(p.player_id)   ?? 0) + w);
          }
        }

        let ais = 0;

        for (const rp of (r.receive ?? [])) {
          const sellW = theirSellWeight.get(rp.player_id) ?? 0;
          const buyW  = theirBuyWeight.get(rp.player_id)  ?? 0;
          if (sellW > 0) ais += 11 * sellW;
          if (buyW  > 0) ais -= 6  * buyW;
          const targetW = myTargetWeight.get(rp.player_id) ?? 0;
          if (targetW > 0) ais += 6 * targetW;
          // They wouldn't part with this player when I asked — a cleaner, more durable "no" than a
          // give-side refusal (which is more often about total value than the specific piece).
          const declRecvW = Math.min(declinedReceiveWeight.get(rp.player_id) ?? 0, DECLINE_WEIGHT_CAP);
          if (declRecvW > 0) ais -= 12 * declRecvW;
        }

        for (const gp of (r.give ?? [])) {
          const buyW  = theirBuyWeight.get(gp.player_id)  ?? 0;
          if (buyW  > 0) ais += 14 * buyW;
          const shopW = myShopWeight.get(gp.player_id)    ?? 0;
          if (shopW > 0) ais += 3 * shopW;
          // They passed on this player as my outgoing piece — lightly de-rank re-sending it. Skip
          // a value-neutral sweetener (it must stay a pure +4 acceptance nudge; see TradeResult).
          const declGiveW = gp.player_id === r.sweetenerPlayerId
            ? 0
            : Math.min(declinedGiveWeight.get(gp.player_id) ?? 0, DECLINE_WEIGHT_CAP);
          if (declGiveW > 0) ais -= 8 * declGiveW;
        }

        return ais;
      })();

      const marketIntelScore = (() => {
        let mis = 0;
        const playersMap = players;
        const injuredStatuses = new Set(["ir", "out", "dnr", "pup", "nfi"]);

        for (const gp of r.give) {
          const snapVal = historicalSnapshot?.players?.[gp.player_id]?.value;
          if (snapVal && snapVal > 50 && gp.value > 50) {
            const pct = (gp.value - snapVal) / snapVal;
            if (pct <= -0.08) mis += 5;
            else if (pct <= -0.04) mis += 3;
            else if (pct >= 0.10) mis += 4;
            else if (pct >= 0.06) mis += 2;
          }
          const inj = (playersMap[gp.player_id]?.injury_status ?? "").toLowerCase();
          if (injuredStatuses.has(inj)) mis -= 4;
          const exp = Number(playersMap[gp.player_id]?.years_exp ?? -1);
          if (exp >= 7 && gp.value >= 1500) mis += 2;
          const urgency = getAgeUrgency(gp);
          if (urgency >= 0.70 && gp.value >= 2000) mis += Math.round(urgency * 3);
        }

        for (const rp of r.receive) {
          const snapVal = historicalSnapshot?.players?.[rp.player_id]?.value;
          if (snapVal && snapVal > 50 && rp.value > 50) {
            const pct = (rp.value - snapVal) / snapVal;
            if (pct >= 0.10) mis += 5;
            else if (pct >= 0.06) mis += 3;
            else if (pct <= -0.08) mis -= 5;
            else if (pct <= -0.04) mis -= 3;
          }
          const inj = (playersMap[rp.player_id]?.injury_status ?? "").toLowerCase();
          if (injuredStatuses.has(inj) && rp.value >= 2500) mis += 3;
          else if (injuredStatuses.has(inj)) mis -= 2;
        }

        return mis;
      })();

      const archetypeWinRateBonus = (() => {
        const key = `${r.give.length + r.givePicks.length}v${r.receive.length + r.receivePicks.length}`;
        const rate = formatWinRates.get(key);
        if (rate === undefined) return 0;
        if (rate >= 0.75) return 5;
        if (rate >= 0.55) return 3;
        if (rate >= 0.35) return 0;
        if (rate >= 0.15) return -3;
        return -5;
      })();

      const seasonTimingBonus = (() => {
        if (nflWeek === 0) return 0;
        let stb = 0;
        const isContenderish = !iAmTankingFinder && ["Elite", "True Contender", "Almost There", "Fading Contender", "Window Closing"].includes(finderDirection);
        const isRebuilder = iAmTankingFinder || ["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(finderDirection);
        const buyLowSet = new Set(buyLowPlayerIds);

        if (isTradeDeadlineWindow) {
          if (isContenderish) stb += 4;
          if (isRebuilder) stb += r.give.filter((p) => isOldProducerBuy(p)).length * 3;
          const oppBucketDeadline = oppProfileByRosterId.get(Number(r.oppRosterId))?.directionProfile?.bucket ?? "";
          if (["Elite", "True Contender", "Almost There"].includes(oppBucketDeadline)) stb += 3;
        }

        if (isEarlySeason) {
          stb += r.receive.filter((p) => buyLowSet.has(p.player_id)).length * 3;
          stb += r.give.filter((p) => {
            const snap = historicalSnapshot?.players?.[p.player_id]?.value;
            return snap && snap > 50 && p.value > snap * 1.08;
          }).length * 2;
        }

        if (isLateSeasonPost) {
          if (isRebuilder) stb += r.receivePicks.length * 2;
          if (iAmTankingFinder && r.givePicks.length > 0) stb -= r.givePicks.length * 3;
        }

        return stb;
      })();

      const usageSignalScore = (() => {
        if (!playerStats) return 0;
        let uss = 0;

        for (const gp of r.give) {
          const u = playerStats[gp.player_id];
          if (!u || u.gamesPlayed < 2) continue;
          if ((gp.position === "WR" || gp.position === "TE") && u.avgTargets >= 8) uss -= 4;
          if ((gp.position === "WR" || gp.position === "TE") && u.avgTargets <= 3 && gp.value >= 2000) uss += 4;
          if (gp.position === "RB" && u.avgCarries >= 15) uss -= 4;
          if (gp.position === "RB" && u.avgCarries <= 5 && gp.value >= 2000) uss += 4;
          if (u.snapPct < 0.20 && gp.value >= 2000) uss += 5;
          else if (u.snapPct < 0.40 && gp.value >= 3000) uss += 3;
          const gpTT = u.targetTrend ?? 0, gpCT = u.carryTrend ?? 0, gpST = u.snapTrend ?? 0;
          if ((gp.position === "WR" || gp.position === "TE") && gpTT <= -3) uss += 4;
          if ((gp.position === "WR" || gp.position === "TE") && gpTT >= 3) uss -= 3;
          if (gp.position === "RB" && gpCT <= -4) uss += 3;
          if (gp.position === "RB" && gpCT >= 4) uss -= 3;
          if (gpST <= -0.15 && gp.value >= 2000) uss += 3;
        }

        for (const rp of r.receive) {
          const u = playerStats[rp.player_id];
          if (!u || u.gamesPlayed < 2) continue;
          if ((rp.position === "WR" || rp.position === "TE") && u.avgTargets >= 8) uss += 4;
          if ((rp.position === "WR" || rp.position === "TE") && u.avgTargets <= 3 && rp.value >= 2000) uss -= 4;
          if (rp.position === "RB" && u.avgCarries >= 15) uss += 4;
          if (rp.position === "RB" && u.avgCarries <= 5 && rp.value >= 2000) uss -= 4;
          if (u.snapPct < 0.20 && rp.value >= 3000) uss += 5;
          const rpTT = u.targetTrend ?? 0, rpCT = u.carryTrend ?? 0, rpST = u.snapTrend ?? 0;
          if ((rp.position === "WR" || rp.position === "TE") && rpTT >= 3) uss += 4;
          if ((rp.position === "WR" || rp.position === "TE") && rpTT <= -3) uss -= 3;
          if (rp.position === "RB" && rpCT >= 4) uss += 3;
          if (rp.position === "RB" && rpCT <= -4) uss -= 3;
          if (rpST >= 0.15 && rp.value >= 1500) uss += 3;
        }

        return uss;
      })();

      const teamWindowBonus = (() => {
        let twb = 0;
        const isContenderish = !iAmTankingFinder && ["Elite", "True Contender", "Almost There", "Fading Contender", "Window Closing"].includes(finderDirection);
        const isRebuilder = iAmTankingFinder || ["Rebuilder", "Stranded", "Fading Out", "Hopeless"].includes(finderDirection);

        if (myTeamWindow < 2.5) {
          twb += r.receive.filter((p) => isOldProducerBuy(p)).length * 4;
          twb -= r.receive.filter((p) => isFutureInsulationAsset(p)).length * 3;
          twb -= r.receivePicks.length * 2;
          twb += r.give.filter((p) => getFutureValue(p) >= 0.7).length * 2;
        } else if (myTeamWindow > 5.5 && isRebuilder) {
          twb += r.receive.filter((p) => isFutureInsulationAsset(p)).length * 3;
          twb += r.receivePicks.filter((p) => Number(p.round) === 1).length * 3;
          twb -= r.give.filter((p) => isFutureInsulationAsset(p)).length * 3;
        } else if (myTeamWindow >= 2.5 && myTeamWindow <= 4.5 && isContenderish) {
          twb += r.receive.filter((p) => getAgeUrgency(p) >= 0.40 && getAgeUrgency(p) < 0.80).length * 2;
        }

        const oppRosterForWindow = rosters.find((ros) => ros.roster_id === r.oppRosterId);
        if (oppRosterForWindow) {
          const oppWin = computeTeamWindow(rosterPlayers(oppRosterForWindow));
          if (oppWin < 2.5 && oppDirectionScore > 0) twb += 2;
          if (oppWin > 5.5 && r.give.filter((p) => isOldProducerBuy(p)).length > 0) twb -= 2;
        }

        return twb;
      })();

      const starterQualityBonus = (() => {
        let sqb = 0;
        for (const gp of r.give) {
          const myPosGroup = myPlayers
            .filter((p) => p.position === gp.position)
            .sort((a, b) => b.value - a.value);
          const giveRank = myPosGroup.findIndex((p) => p.player_id === gp.player_id) + 1;
          const slots = starterCounts[gp.position] || 0;
          if (giveRank > 0 && giveRank > slots) sqb += 3;
          if (giveRank > 0 && giveRank === 1) sqb -= 3;
        }
        const myPlayersAfterTrade = buildPostTradePlayers(myRoster, r.give, r.receive);
        for (const rp of r.receive) {
          const posAfterTrade = myPlayersAfterTrade
            .filter((p) => p.position === rp.position)
            .sort((a, b) => b.value - a.value);
          const recvRank = posAfterTrade.findIndex((p) => p.player_id === rp.player_id) + 1;
          const slots = starterCounts[rp.position] || 0;
          if (recvRank > 0 && recvRank <= slots) sqb += 4;
          const displacedPlayer = posAfterTrade[recvRank];
          if (displacedPlayer && recvRank > 0 && recvRank <= slots) {
            const myPre = myPlayers.filter((p) => p.position === rp.position).sort((a, b) => b.value - a.value);
            const weakBenchmark = myPre[slots - 1]?.value ?? 0;
            if (rp.value > weakBenchmark * 1.15) sqb += 2;
          }
        }
        return sqb;
      })();

      const activeTraderBonus = (() => {
        if (tradeAttempts.length === 0) return 0;
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const oppId = Number(r.oppRosterId);
        const oppRecentAttempts = tradeAttempts.filter(
          (a) =>
            a.league_id === selectedLeague?.league_id &&
            Number(a.partner_roster_id) === oppId &&
            now - new Date(a.attempted_at).getTime() < THIRTY_DAYS
        );
        const theirInitiated = oppRecentAttempts.filter((a) => a.initiated_by === "THEM").length;
        const totalEngagement = oppRecentAttempts.length;
        let atb = 0;
        if (theirInitiated >= 2) atb += 5;
        else if (theirInitiated === 1) atb += 3;
        if (totalEngagement >= 3) atb += 2;
        const pastAccepted = oppRecentAttempts.filter((a) => a.status === "ACCEPTED").length;
        if (pastAccepted > 0) atb += 3;
        const allDeclined = oppRecentAttempts.length > 0 &&
          oppRecentAttempts.every((a) => a.status === "DECLINED" || a.status === "NO_RESPONSE");
        if (allDeclined && oppRecentAttempts.length >= 2) atb -= 4;
        return atb;
      })();

      const crossLeagueIntelScore = (() => {
        if (!partnerProfile) return 0;
        let cli = 0;

        const tradePrefPos = new Set((partnerProfile.tradePreferredPositions ?? []) as string[]);
        if (tradePrefPos.size > 0) {
          for (const gp of r.give) {
            if (tradePrefPos.has(gp.position) && gp.value >= 1500) cli += 7;
          }
          for (const rp of r.receive) {
            if (tradePrefPos.has(rp.position) && rp.value >= 2000) cli -= 5;
          }
        }

        // Classify from the canonical resolver (not the cast) so seller/buyer here matches
        // oppDirectionScore and oppDirOk exactly — same opponent, same classification.
        const oppProfileCli = oppProfileByRosterId.get(Number(r.oppRosterId));
        const oppOddsCli = oppProfileCli?.playoffOdds
          ?? selectedLeagueSimulation?.rowByRosterId?.get(Number(r.oppRosterId))?.playoffOdds ?? 50;
        const { isSeller, isBuyer } = classifyOppDirection(
          oppProfileCli?.directionProfile?.bucket ?? "", oppOddsCli,
        );

        if (isSeller) {
          const sendingProduction = r.give.filter((p) => isOldProducerBuy(p) || (Number(p.age || 0) >= 26 && p.value >= 2000)).length;
          cli += sendingProduction * 5;
          cli -= r.receivePicks.filter((p) => Number(p.round) === 1).length * 4;
        }

        if (isBuyer) {
          if (r.give.length === 0 && r.givePicks.length > 0) cli -= 6;
          const theyGiveCount = r.receive.length;
          if (theyGiveCount > 0 && r.give.filter((p) => p.value >= 2000).length > 0) cli += 3;
        }

        const repeatedIds = new Set(
          (partnerProfile.repeatedPlayers ?? []).map((p: { playerId: string }) => p.playerId)
        );
        if (repeatedIds.size > 0) {
          for (const rp of r.receive) {
            if (repeatedIds.has(rp.player_id) && rp.value >= 2000) cli -= 8;
          }
          for (const gp of r.give) {
            if (repeatedIds.has(gp.player_id)) cli += 5;
          }
        }

        return cli;
      })();

      const exposureBonus = (() => {
        if (!crossLeagueExposure) return 0;
        let eb = 0;
        for (const gp of r.give) {
          const count = crossLeagueExposure[gp.player_id]?.count ?? 1;
          if (count >= 4) eb += 4;
          else if (count >= 3) eb += 2;
        }
        for (const rp of r.receive) {
          const count = crossLeagueExposure[rp.player_id]?.count ?? 0;
          if (count === 0) eb += 2;
          if (count >= 4) eb -= 3;
        }
        return eb;
      })();

      const standingsPressureScore = (() => {
        if (nflWeek === 0 || weeksRemaining <= 0) return 0;
        const oppStanding = standingsMap.get(Number(r.oppRosterId));
        if (!oppStanding) return 0;
        const gamesBack = Math.max(0, lastPlayoffSpotWins - oppStanding.wins);
        const inPlayoffs = oppStanding.playoffRank <= playoffTeamCount;
        let sps = 0;

        const isDesperate = !inPlayoffs && gamesBack <= 2 && weeksRemaining <= 5;
        const isEliminated = !inPlayoffs && (gamesBack > weeksRemaining || gamesBack >= 4);
        const isComfortableLeader = inPlayoffs && (oppStanding.wins - lastPlayoffSpotWins) >= 2;

        if (isDesperate) {
          const oppReceivesPlayers = valueBearingGive(r); // strip value-neutral sweetener
          const oppReceivesRedraft = oppReceivesPlayers.reduce(
            (s: number, p) => s + (redraftValues?.[p.player_id] ?? 0), 0
          );
          sps += Math.min(oppReceivesRedraft / 60, 8);
          sps += oppReceivesPlayers.filter((p) => isOldProducerBuy(p)).length * 3;
          sps -= r.givePicks.length * 2;
        } else if (isEliminated) {
          sps += r.givePicks.filter((p) => Number(p.round) === 1).length * 4;
          sps += r.give.filter((p) => isFutureInsulationAsset(p)).length * 3;
          sps -= r.give.filter((p) => isOldProducerBuy(p)).length * 4;
        } else if (isComfortableLeader) {
          sps -= 2;
        }

        return sps;
      })();

      const pickSlotScore = (() => {
        let pss = 0;
        for (const rp of r.receivePicks) pss += getPickSlotBonus(rp);
        for (const gp of r.givePicks)    pss -= getPickSlotBonus(gp);
        return pss;
      })();

      const sellHighConfirmScore = (() => {
        if (!historicalSnapshot || !playerStats) return 0;
        let shc = 0;
        for (const gp of r.give) {
          const snapVal = historicalSnapshot.players?.[gp.player_id]?.value;
          if (!snapVal || snapVal <= 50 || gp.value <= 50) continue;
          const pct = (gp.value - snapVal) / snapVal;
          if (pct < 0.06) continue;
          const u = playerStats[gp.player_id];
          if (!u || u.gamesPlayed < 2) continue;
          const usageFalling =
            ((gp.position === "WR" || gp.position === "TE") && (u.targetTrend ?? 0) <= -2) ||
            (gp.position === "RB" && (u.carryTrend ?? 0) <= -3) ||
            ((u.snapTrend ?? 0) <= -0.12);
          if (pct >= 0.10 && usageFalling) shc += 6;
          else if (pct >= 0.06 && usageFalling) shc += 4;
          else if (pct >= 0.10) shc += 2;
        }
        for (const rp of r.receive) {
          const snapVal = historicalSnapshot.players?.[rp.player_id]?.value;
          if (!snapVal || snapVal <= 50 || rp.value <= 50) continue;
          const pct = (rp.value - snapVal) / snapVal;
          if (pct < 0.06) continue;
          const u = playerStats[rp.player_id];
          if (!u || u.gamesPlayed < 2) continue;
          const usageFalling =
            ((rp.position === "WR" || rp.position === "TE") && (u.targetTrend ?? 0) <= -2) ||
            (rp.position === "RB" && (u.carryTrend ?? 0) <= -3);
          if (pct >= 0.08 && usageFalling) shc -= 5;
        }
        return shc;
      })();

      const rosterBalanceScore = (() => {
        let rbs = 0;
        const myPostTrade = buildPostTradePlayers(myRoster, r.give, r.receive);

        for (const pos of ["QB", "RB", "WR", "TE"] as const) {
          const slots = starterCounts[pos] || (pos === "QB" ? 1 : pos === "TE" ? 1 : 2);

          const preBefore = myPlayers
            .filter((p) => p.position === pos)
            .sort((a, b) => b.value - a.value);
          const topEndBefore  = preBefore[0]?.value ?? 0;
          const viableBefore  = preBefore.filter((p) => (p.value ?? 0) >= 1500).length;

          const preAfter = myPostTrade
            .filter((p) => p.position === pos)
            .sort((a, b) => b.value - a.value);
          const topEndAfter  = preAfter[0]?.value ?? 0;
          const viableAfter  = preAfter.filter((p) => (p.value ?? 0) >= 1500).length;

          const floorRequired = slots + 1;
          const hadFloor = viableBefore >= floorRequired;
          const hasFloor = viableAfter  >= floorRequired;

          if (hadFloor && !hasFloor) rbs -= 15;
          if (!hadFloor && viableAfter < viableBefore) rbs -= 8;
          if (topEndAfter > topEndBefore) rbs += (topEndAfter - topEndBefore) / 600;
          if (!hadFloor && hasFloor) rbs += 10;
        }
        return rbs;
      })();

      const rosterConsolidationBonus = (() => {
        if (rosterOverflow <= 0) return 0;
        const netPlayerReduction = r.give.length - r.receive.length;
        const netPickReduction   = r.givePicks.length - r.receivePicks.length;
        const totalReduction = netPlayerReduction + netPickReduction;
        if (totalReduction <= 0) return 0;
        const urgency = Math.min(rosterOverflow / 2, 1.0) * draftProximityMultiplier;
        let rcb = 25 * urgency;
        rcb += totalReduction * 15 * urgency;
        if (r.givePicks.length >= 2 && r.receive.length <= 1) rcb += 20 * urgency;
        if (r.give.length >= 2 && r.receive.length === 1)      rcb += 15 * urgency;
        const currentYearN = Number(getSeasonYear(nflState));
        const givesCurrent  = r.givePicks.some((p) => Number(p.season) === currentYearN);
        const receivesFuture = r.receivePicks.some((p) => Number(p.season) > currentYearN);
        if (givesCurrent && receivesFuture) rcb += 12 * urgency;
        return Math.min(rcb, 50);
      })();

      const depthAwareTierBonus = (() => {
        let dtb = 0;
        for (const pos of ["QB", "RB", "WR", "TE"] as const) {
          const slots = starterCounts[pos] || (pos === "QB" ? 1 : pos === "TE" ? 1 : 2);
          const viable = myViableDepth[pos] ?? 0;
          const isDeep = viable >= slots + 2;
          const isThin = viable <= slots;
          const givenAtPos    = r.give.filter((p) => p.position === pos);
          const receivedAtPos = r.receive.filter((p) => p.position === pos);
          if (isDeep && givenAtPos.length > 0) {
            const viableGiven = givenAtPos.filter((p) => (p.value ?? 0) >= 1500).length;
            const remainingAfter = viable - viableGiven;
            if (remainingAfter >= slots) {
              dtb += givenAtPos.length * 6;
              const receivesOtherPos = r.receive.filter(
                (p) => p.position !== pos && (p.value ?? 0) >= 1500
              ).length;
              dtb += receivesOtherPos * 3;
            }
          }
          if (isThin) {
            dtb += receivedAtPos.length * 7;
            dtb -= givenAtPos.length * 5;
          }
        }
        return dtb;
      })();

      const championshipBonus = (() => {
        if (!isChampionshipPush) return 0;
        let cb = 0;
        const receivedPlayers = r.receive;
        const givenPlayers = r.give;
        const hasProjections = weeklyProjMap.size > 0;
        const incomingProjPts = receivedPlayers.reduce((s: number, p) =>
          s + (hasProjections ? (weeklyProjMap.get(p.player_id) ?? 0) : (redraftValues?.[p.player_id] ?? 0) / 350), 0
        );
        const topIncomingValue = receivedPlayers.reduce(
          (max: number, p) => Math.max(max, p.value ?? 0), 0
        );
        const fillsWeakPos = receivedPlayers.some((p) => weakPositions.has(p.position));
        if (fillsWeakPos) cb += 12;
        cb += incomingProjPts * (hasProjections ? 1.2 : 1.0);
        if (receivedPlayers.length === 1 && givenPlayers.length >= 2 && topIncomingValue >= 6000) cb += 8;
        if (myFinderPlayoffOdds >= 90 && topIncomingValue >= 7000) cb += 6;
        if (r.net >= -600 && fillsWeakPos) cb += 5;
        if (r.receivePicks.length > 0 && receivedPlayers.length === 0) cb -= 10;
        if (receivedPlayers.length > 0 && receivedPlayers.every((p) => isFutureInsulationAsset(p))) cb -= 8;
        return cb;
      })();

      // Manual disposition scoring: Shopping/Offload on the give side nudge the Finder toward
      // pieces the user has said they want moved (Offload — "get off my roster ASAP" — outweighs
      // Shopping); Pricey nudges away without fully blocking it (that's CORE's job, a hard
      // filter upstream). Open to Sell on the receive side mirrors Shopping for the opponent's
      // manually-tagged assets. Covers both players and picks (finderPickKey-keyed).
      const dispositionBonus = (() => {
        let db = 0;
        const giveAssetIds = [...valueBearingGive(r).map((p) => p.player_id), ...r.givePicks.map((p) => finderPickKey(p))];
        const receiveAssetIds = [...r.receive.map((p) => p.player_id), ...r.receivePicks.map((p) => finderPickKey(p))];
        if (giveAssetIds.some((id) => isWantToTrade(id))) db += 20;
        if (giveAssetIds.some((id) => isOffload(id))) db += 35;
        if (giveAssetIds.some((id) => isPricey(id))) db -= 15;
        if (receiveAssetIds.some((id) => isOpenToSell(id))) db += 20;
        return db;
      })();

      const oppDropCostPenalty = (() => {
        const oppNetPlayerGain = valueBearingGive(r).length - r.receive.length;
        if (oppNetPlayerGain <= 0) return 0;
        const oppRosterObj = rosters.find((ros) => ros.roster_id === r.oppRosterId);
        if (!oppRosterObj) return 0;
        const limit = (selectedLeague?.roster_positions ?? []).length || 25;
        const currentCount = (oppRosterObj.players ?? []).length;
        const openSlots = Math.max(0, limit - currentCount);
        const dropsNeeded = Math.max(0, oppNetPlayerGain - openSlots);
        if (dropsNeeded === 0) return 0;
        const sorted = (oppRosterObj.players ?? []).map((pid) => calcFcValues[pid] ?? 0).sort((a, b) => a - b);
        const oppDropCostVal = sorted.slice(0, dropsNeeded).reduce((s, v) => s + v, 0);
        return -Math.round(oppDropCostVal / 50);
      })();

      // ── Strategy score: the ~30 terms grouped into 5 legible, tunable buckets ──────
      // WEIGHTS is the single place to tune the acceptance-vs-value-vs-fit balance.
      // clampBucket bounds any one bucket so a high-scale term (e.g. rosterConsolidation up
      // to 50) can't swamp the value signal. VALUE_EDGE is never clamped — value always counts.
      // BUCKET_CLAMP currently starts effectively OFF, so this is value-equivalent to the prior
      // flat sum — same term set, and ordering unchanged for any non-tied pair (floating-point
      // regrouping can differ by an ULP, which only matters for exact ties). Lower it to ~40 to
      // enable dominance protection once the reordering has been eyeballed on a real league.
      // Sweetener-affinity nudge: a goodwill piece the opponent already rosters elsewhere
      // makes them marginally likelier to say yes (value-neutral; see TradeResult.sweetenerPlayerId).
      const sweetenerBonus = r.sweetenerPlayerId ? 4 : 0;
      // Soft de-rank (#9): pieces in the opinion-dependent 700-1000 band shouldn't decide a
      // trade. Small, capped penalty applied to the RANKING ONLY (rankAdjust below) — NOT to the
      // strategyScore>0 reject gate — so it can only reorder, never drop, a trade.
      const midValueSoftPenalty = Math.max(
        -8,
        [...r.give, ...r.receive].filter(
          (p) => p.value >= LOW_VALUE_FLOOR && p.value < MID_VALUE_CEILING,
        ).length * -3,
      );
      const acceptanceBucket = oppDirectionScore + crossLeagueIntelScore + partnerFitScore
        + attemptIntelScore + activeTraderBonus + oppDropCostPenalty + sweetenerBonus;
      const userFitBucket = getDirectionTradeScore(r) + lineupSafety.score + teamWindowBonus
        + starterQualityBonus + depthAwareTierBonus + rosterBalanceScore + championshipBonus
        + futurePickBonus + standingsPressureScore;
      const valueEdgeBucket = r.score + balancePenalty + starPremiumScore + pickSlotScore + handcuffBonus;
      const structureBucket = formatBonus + rosterConsolidationBonus;
      const signalsBucket = dispositionScore + marketIntelScore + archetypeWinRateBonus
        + seasonTimingBonus + usageSignalScore + exposureBonus + sellHighConfirmScore + dispositionBonus;

      const WEIGHTS = { acceptance: 1, userFit: 1, valueEdge: 1, structure: 1, signals: 1 };
      const BUCKET_CLAMP = 100000; // ~off (byte-identical); set to ~40 to bound non-value buckets
      const clampBucket = (v: number) => Math.max(-BUCKET_CLAMP, Math.min(BUCKET_CLAMP, v));

      const strategyScore =
        WEIGHTS.acceptance * clampBucket(acceptanceBucket) +
        WEIGHTS.userFit    * clampBucket(userFitBucket) +
        WEIGHTS.valueEdge  * valueEdgeBucket +
        WEIGHTS.structure  * clampBucket(structureBucket) +
        WEIGHTS.signals    * clampBucket(signalsBucket);
      return {
        r,
        lineupSafety,
        partnerProfile,
        bucketPriority,
        strategyScore,
        // Ordering score = strategyScore plus the soft mid-value de-rank. Kept separate from
        // strategyScore so the >0 reject gate below can never be flipped by the de-rank.
        rankScore: strategyScore + midValueSoftPenalty,
        oppDirectionScore,
        sort: Math.abs(Math.sin(deferredFinderSeed * ((resultIndex.get(r) ?? 0) + 1)) * 10000) % 1,
      };
    })
    .filter(({ lineupSafety }) => finderTankMode
      ? (lineupSafety.myValid && lineupSafety.oppValid)
      : lineupSafety.valid
    )
    .filter(({ strategyScore }) => strategyScore > 0)
    .filter(({ r, oppDirectionScore }) => {
      // Acceptance-first: never surface a standard swap the opponent has no directional
      // reason to accept. Lottery / draft-capital formats are exempt — they are
      // intentionally pick-skewed sell-side moves judged on different terms.
      const isStandardSwap = !r.draftCapital && r.format !== "Lottery";
      return !isStandardSwap || oppDirectionScore >= ACCEPT_FLOOR;
    })
    .sort((a, b) => {
      // Rank by the full strategy/value model first; the draft-pick-year preference
      // (bucketPriority) is only a tiebreak, so an excellent player trade can't be buried
      // under a marginal pick trade just because the pick lands in the preferred year.
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      if (a.bucketPriority !== b.bucketPriority) return a.bucketPriority - b.bucketPriority;
      return a.sort - b.sort;
    })
    .map(({ r }) => r);

  // ── Build the standard final list ──────────────────────────────────────
  const FINAL_TRADE_COUNT = 12;  // headline ranked trades
  const BUY_LOW_COUNT = 5;       // bonus buy-low slots appended after
  const buyLowSet = new Set(buyLowPlayerIds);
  const seen = new Set<string>();
  const playerCount: Record<string, number> = {};
  const oppCount: Record<string, number> = {};
  const addToSlots = (acc: TradeResult[], r: TradeResult, allIds: string[], key: string) => {
    seen.add(key);
    allIds.forEach((pid) => { playerCount[pid] = (playerCount[pid] || 0) + 1; });
    oppCount[String(r.oppRosterId)] = (oppCount[String(r.oppRosterId)] || 0) + 1;
    acc.push(r);
  };
  const MAX_COMPLEX_TRADES = 2;
  let complexTradeCount = 0;
  const topTrades = shuffled.reduce((acc: TradeResult[], r) => {
      if (acc.length >= FINAL_TRADE_COUNT) return acc;
      const allIds = [
        ...r.give.map((p) => `player-${p.player_id}`),
        ...r.receive.map((p) => `player-${p.player_id}`),
        ...r.givePicks.map((p) => `pick-${finderPickKey(p)}`),
        ...r.receivePicks.map((p) => `pick-${finderPickKey(p)}`),
      ];
      const key = [...allIds].sort().join(",");
      if (seen.has(key)) return acc;
      if (acc.some((existing) => areTradesTooSimilar(existing, r))) return acc;
      const isPlayerPinned = !!deferredPinnedPlayerId;
      const isOwnerPinned = !!deferredTargetOppRosterId;
      const oppKey = String(r.oppRosterId);
      if (!isPlayerPinned && !isOwnerPinned) {
        if (allIds.some((pid) => pid !== `player-${deferredPinnedPlayerId}` && (playerCount[pid] || 0) >= 2)) return acc;
        if ((oppCount[oppKey] || 0) >= 4) return acc;
      }
      const totalPieces = r.give.length + r.receive.length + r.givePicks.length + r.receivePicks.length;
      if (totalPieces >= 5) {
        if (complexTradeCount >= MAX_COMPLEX_TRADES) return acc;
        complexTradeCount++;
      }
      addToSlots(acc, r, allIds, key);
      return acc;
    }, []);

  // ── 5 bonus buy-low slots ──────────────────────────────────────────────
  const buyLowSlots = shuffled.reduce((acc: TradeResult[], r) => {
      if (acc.length >= BUY_LOW_COUNT) return acc;

      const totalGiven    = r.give.length + r.givePicks.length;
      const totalReceived = r.receive.length + r.receivePicks.length;
      if (totalGiven !== 1 || totalReceived !== 1) return acc;

      if (r.receive.length !== 1 || !buyLowSet.has(r.receive[0].player_id)) return acc;

      if (r.give.length === 1 && buyLowSet.has(r.give[0].player_id)) return acc;

      const allIds = [
        ...r.give.map((p) => `player-${p.player_id}`),
        ...r.receive.map((p) => `player-${p.player_id}`),
        ...r.givePicks.map((p) => `pick-${finderPickKey(p)}`),
        ...r.receivePicks.map((p) => `pick-${finderPickKey(p)}`),
      ];
      const key = [...allIds].sort().join(",");
      if (seen.has(key)) return acc;
      if (acc.some((existing) => areTradesTooSimilar(existing, r))) return acc;
      addToSlots(acc, r, allIds, key);
      return acc;
    }, [])
    .map((r) => ({ ...r, isBuyLow: true }));

  const allTrades = [...topTrades, ...buyLowSlots];

  const TWENTY_EIGHT_DAYS = 28 * 24 * 60 * 60 * 1000;
  const recentFingerprints = new Set(
    tradeAttempts
      .filter((a) => a.league_id === selectedLeague?.league_id && Date.now() - new Date(a.attempted_at).getTime() < TWENTY_EIGHT_DAYS)
      .map((a) => buildTradeFingerprint(
        a.league_id,
        a.partner_roster_id,
        [...a.give_players.map((p) => p.player_id), ...a.give_picks.map((p) => p.key)],
        [...a.receive_players.map((p) => p.player_id), ...a.receive_picks.map((p) => p.key)],
      ))
  );

  return { allTrades, recentFingerprints, rosterOverflow };
}
