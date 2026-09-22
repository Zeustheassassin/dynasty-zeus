"use client";
import { useState, useEffect } from "react";
import { CURRENT_YEAR, average } from "../lib/helpers";
import { sleeperApi } from "../lib/sleeperApi";
import { CROSS_LEAGUE_INTEL_OWNER_BATCH, CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY } from "../lib/constants";
import { logger } from "../lib/logger";
import type { CrossLeagueIntel, CrossLeagueIntelPlayer, SleeperRoster, SleeperPlayer, SleeperTransaction, SleeperDraft, SleeperLeague } from "../lib/types";

const log = logger("hooks/useCrossLeagueMateIntel");

export interface UseCrossLeagueMateIntelReturn {
  crossLeagueMateIntel: Record<string, CrossLeagueIntel>;
  loadingCrossLeagueMateIntel: boolean;
}

interface UseCrossLeagueMateIntelOptions {
  leagueId: string | null | undefined;
  rosters: SleeperRoster[];
  userId: string | null | undefined;
  players: Record<string, SleeperPlayer>;
  mainTab: string;
  tradeHubSection: string;
}

function isCrossLeagueDynasty(league: SleeperLeague): boolean {
  return (
    ((league.settings?.taxi_slots ?? 0) > 0 || (league.roster_positions?.length ?? 0) > 20) &&
    (league.settings?.best_ball ?? 0) === 0
  );
}

interface LeagueIntelFetch {
  ownerRoster: SleeperRoster | null;
  trades: SleeperTransaction[];
  draftsData: SleeperDraft[];
}

/** One dynasty league's data for a single owner — 5 Sleeper calls. */
async function fetchOwnerLeagueIntel(league: SleeperLeague, ownerId: string): Promise<LeagueIntelFetch> {
  const [leagueRosters, t0, t1, t2, draftsData] = await Promise.all([
    sleeperApi.getLeagueRosters(league.league_id),
    sleeperApi.getLeagueTransactions(league.league_id, 0),
    sleeperApi.getLeagueTransactions(league.league_id, 1),
    sleeperApi.getLeagueTransactions(league.league_id, 2),
    sleeperApi.getLeagueDrafts(league.league_id),
  ]);
  const ownerRoster = leagueRosters.find((roster) => String(roster.owner_id) === ownerId) || null;
  return { ownerRoster, trades: [...t0, ...t1, ...t2], draftsData };
}

/** Pure aggregation — no network. Turns one owner's per-league fetch results into their
 *  CrossLeagueIntel profile. `leagueResults` must be every dynasty league that owner is in;
 *  a partial list would silently understate their true cross-league activity while looking
 *  complete, so callers only reach this once every league for the owner has succeeded. */
function buildIntelFromLeagueResults(
  dynastyLeagueCount: number,
  leagueResults: LeagueIntelFetch[],
  players: Record<string, SleeperPlayer>
): CrossLeagueIntel {
  const ownedPlayerCounts: Record<string, number> = {};
  const ownedPositionCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const allSkillPlayers: SleeperPlayer[] = [];
  const acquiredPositionCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const acquiredPlayerCounts: Record<string, number> = {};
  let crossLeagueTradeCount30d = 0;
  let crossLeaguePickBuys30d = 0;
  let crossLeaguePickSells30d = 0;
  let youngQbWrBuys = 0;
  let veteranRbBuys = 0;
  let totalSkillBuys = 0;

  leagueResults.forEach(({ ownerRoster }) => {
    if (!ownerRoster) return;
    (ownerRoster.players || []).forEach((playerId: string) => {
      const player = players[playerId];
      if (!player || !["QB", "RB", "WR", "TE"].includes(player.position)) return;
      ownedPlayerCounts[playerId] = (ownedPlayerCounts[playerId] || 0) + 1;
      ownedPositionCounts[player.position] = (ownedPositionCounts[player.position] || 0) + 1;
      allSkillPlayers.push(player);
    });
  });

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  leagueResults.forEach(({ ownerRoster, trades, draftsData }) => {
    if (!ownerRoster) return;
    const startupDraft = draftsData
      .filter((d) => (d.settings?.rounds ?? 0) > 6)
      .sort((a, b) => (b.settings?.rounds ?? 0) - (a.settings?.rounds ?? 0))[0];
    const startupStart = startupDraft?.start_time ?? 0;
    const startupEnd = startupDraft?.last_picked
      ?? (startupStart ? startupStart + 60 * 24 * 60 * 60 * 1000 : 0);

    trades
      .filter((trade) =>
        trade?.type === "trade" &&
        trade?.status === "complete" &&
        Number(trade?.created || 0) >= thirtyDaysAgo &&
        (trade.roster_ids || []).includes(ownerRoster!.roster_id) &&
        !(startupStart > 0 && trade.created >= startupStart && trade.created <= startupEnd)
      )
      .forEach((trade) => {
        crossLeagueTradeCount30d += 1;

        (Object.entries(trade.adds || {}) as [string, number][]).forEach(([playerId, rosterId]) => {
          if (Number(rosterId) !== Number(ownerRoster!.roster_id)) return;
          const player = players[playerId];
          if (!player || !["QB", "RB", "WR", "TE"].includes(player.position)) return;
          acquiredPositionCounts[player.position] = (acquiredPositionCounts[player.position] || 0) + 1;
          acquiredPlayerCounts[String(playerId)] = (acquiredPlayerCounts[String(playerId)] || 0) + 1;
          totalSkillBuys += 1;
          if (["QB", "WR"].includes(player.position) && Number(player.age || 99) <= 24) youngQbWrBuys += 1;
          if (player.position === "RB" && Number(player.age || 0) >= 26) veteranRbBuys += 1;
        });

        (trade.draft_picks || []).forEach((pick) => {
          if (Number(pick?.owner_id) === Number(ownerRoster!.roster_id)) crossLeaguePickBuys30d += 1;
          if (Number(pick?.previous_owner_id) === Number(ownerRoster!.roster_id)) crossLeaguePickSells30d += 1;
        });
      });
  });

  const totalSkillPlayers = allSkillPlayers.length || 1;
  const sortedPositions = (Object.entries(ownedPositionCounts) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([pos]) => pos);
  const tradePreferredPositions = (Object.entries(acquiredPositionCounts) as [string, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([pos]) => pos);
  const repeatedPlayers = (Object.entries(ownedPlayerCounts) as [string, number][])
    .map(([playerId, count]) => {
      const player = players[playerId];
      return player ? { playerId, count, name: player.full_name, position: player.position } : null;
    })
    .filter((x): x is CrossLeagueIntelPlayer => x !== null)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3);
  const acquiredPlayers = (Object.entries(acquiredPlayerCounts) as [string, number][])
    .map(([playerId, count]) => {
      const player = players[playerId];
      return player ? { playerId, count, name: player.full_name, position: player.position } : null;
    })
    .filter((x): x is CrossLeagueIntelPlayer => x !== null)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 3);
  const averageAgeAllLeagues = average(
    allSkillPlayers.map((player) => Number(player.age)).filter(Boolean)
  );
  const youngQbWrRate = allSkillPlayers.filter((player) =>
    ["QB", "WR"].includes(player.position) && Number(player.age || 99) <= 24
  ).length / totalSkillPlayers;
  const veteranRbRate = allSkillPlayers.filter((player) =>
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
  const repeatedNames = repeatedPlayers.filter((player) => player.count >= 2).map((player) => player.name);
  const crossLeagueSummary = repeatedNames.length > 0
    ? `Across ${dynastyLeagueCount} dynasty leagues, leans ${topPos}/${secondPos} and repeatedly holds ${repeatedNames.join(", ")}.`
    : `Across ${dynastyLeagueCount} dynasty leagues, leans ${topPos}/${secondPos} with an average skill-player age of ${averageAgeAllLeagues || "-"}.`;
  const acquiredNames = acquiredPlayers.filter((player) => player.count >= 2).map((player) => player.name);
  const crossLeagueTradeSummary =
    crossLeagueTradeCount30d === 0
      ? "No strong cross-league trade tendency in the last 30 days."
      : acquiredNames.length > 0
      ? `Over the last 30 days, they made ${crossLeagueTradeCount30d} cross-league trades and kept buying ${acquiredNames.join(", ")}.`
      : `Over the last 30 days, they made ${crossLeagueTradeCount30d} cross-league trades, leaning ${tradePreferredPositions.slice(0, 2).join("/") || "best-player"} while moving picks ${crossLeaguePickBuys30d}-${crossLeaguePickSells30d}.`;

  return {
    totalDynastyLeagues: dynastyLeagueCount,
    ownedPositionCounts,
    ownedPlayerCounts,
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
  };
}

/**
 * Builds intel for a batch of owners in two phases, so the real Sleeper-call burst stays
 * capped by CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY regardless of how many owners are in the
 * batch (a per-owner cap alone still multiplies: live testing against a 36-league account
 * showed 4 owners x a per-owner cap of 3 producing 60 concurrent calls and 429s):
 *   1. Resolve each owner's OTHER dynasty leagues (1 cheap call per owner, all in parallel).
 *   2. Flatten every (owner, league) pair across the WHOLE batch and fetch them through one
 *      globally-bounded queue.
 * An owner is only included in the result once every one of their leagues has succeeded — a
 * failed owner (or one with a failed league) is left out entirely so the caller doesn't cache
 * a wrong-but-confident partial profile; the next pass retries them.
 */
async function loadOwnerIntelBatch(
  ownerIds: string[],
  players: Record<string, SleeperPlayer>
): Promise<{ ownerId: string; intel: CrossLeagueIntel }[]> {
  const ownerLeagueResults = await Promise.all(
    ownerIds.map(async (ownerId) => {
      try {
        const ownerLeagues = await sleeperApi.getUserLeagues(ownerId, CURRENT_YEAR);
        return { ownerId, dynastyLeagues: ownerLeagues.filter(isCrossLeagueDynasty), failed: false };
      } catch (err) {
        log.warn("cross-league intel: getUserLeagues failed — will retry next pass", { ownerId, err: String(err) });
        return { ownerId, dynastyLeagues: [] as SleeperLeague[], failed: true };
      }
    })
  );

  const failedOwnerIds = new Set(ownerLeagueResults.filter((r) => r.failed).map((r) => r.ownerId));
  const leagueResultsByOwner = new Map<string, LeagueIntelFetch[]>();
  const pairs = ownerLeagueResults.flatMap((r) =>
    r.failed ? [] : r.dynastyLeagues.map((league) => ({ ownerId: r.ownerId, league }))
  );

  for (let i = 0; i < pairs.length; i += CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY) {
    const slice = pairs.slice(i, i + CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY);
    const sliceResults = await Promise.allSettled(
      slice.map(({ league, ownerId }) => fetchOwnerLeagueIntel(league, ownerId))
    );
    sliceResults.forEach((res, idx) => {
      const { ownerId } = slice[idx];
      if (failedOwnerIds.has(ownerId)) return; // already dropped — no point bookkeeping more
      if (res.status === "rejected") {
        log.warn("cross-league intel: a league fetch failed — dropping the whole owner this pass", {
          ownerId, err: String(res.reason),
        });
        failedOwnerIds.add(ownerId);
        leagueResultsByOwner.delete(ownerId);
        return;
      }
      const existing = leagueResultsByOwner.get(ownerId) ?? [];
      existing.push(res.value);
      leagueResultsByOwner.set(ownerId, existing);
    });
  }

  return ownerLeagueResults
    .filter((r) => !failedOwnerIds.has(r.ownerId))
    .map((r) => ({
      ownerId: r.ownerId,
      intel: buildIntelFromLeagueResults(r.dynastyLeagues.length, leagueResultsByOwner.get(r.ownerId) ?? [], players),
    }));
}

export function useCrossLeagueMateIntel({
  leagueId,
  rosters,
  userId,
  players,
  mainTab,
  tradeHubSection,
}: UseCrossLeagueMateIntelOptions): UseCrossLeagueMateIntelReturn {
  const [crossLeagueMateIntel, setCrossLeagueMateIntel] = useState<Record<string, CrossLeagueIntel>>({});
  const [loadingCrossLeagueMateIntel, setLoadingCrossLeagueMateIntel] = useState(false);

  useEffect(() => {
    const shouldLoadCrossLeagueIntel =
      !!leagueId &&
      !!rosters.length &&
      !!userId &&
      !!Object.keys(players || {}).length &&
      mainTab === "TRADE_HUB" && tradeHubSection === "FINDER";

    if (!shouldLoadCrossLeagueIntel) return;

    const ownerIds = rosters
      .filter((r) => r.owner_id && r.owner_id !== userId)
      .map((r) => String(r.owner_id));
    const missingOwnerIds = ownerIds.filter((ownerId) => !crossLeagueMateIntel[ownerId]);
    if (missingOwnerIds.length === 0) return;

    // Only a bounded batch is computed per pass — the rest stay "missing" and this effect
    // re-fires (crossLeagueMateIntel is a dependency) once setCrossLeagueMateIntel below
    // lands, picking up the next batch automatically.
    const batch = missingOwnerIds.slice(0, CROSS_LEAGUE_INTEL_OWNER_BATCH);
    let cancelled = false;

    const loadCrossLeagueMateIntel = async () => {
      setLoadingCrossLeagueMateIntel(true);
      try {
        const succeeded = await loadOwnerIntelBatch(batch, players);
        if (cancelled) return;

        const failedCount = batch.length - succeeded.length;
        if (failedCount > 0) {
          log.warn("cross-league intel: some owners failed this pass", { failedCount, leagueId });
        }
        if (missingOwnerIds.length > batch.length) {
          log.info("cross-league intel: deferring remaining owners to a later pass", {
            deferred: missingOwnerIds.length - batch.length, leagueId,
          });
        }
        if (succeeded.length > 0) {
          setCrossLeagueMateIntel((prev) => ({
            ...prev,
            ...Object.fromEntries(succeeded.map((r) => [r.ownerId, r.intel])),
          }));
        }
      } finally {
        if (!cancelled) setLoadingCrossLeagueMateIntel(false);
      }
    };

    loadCrossLeagueMateIntel();
    return () => { cancelled = true; };
  }, [leagueId, rosters, userId, players, mainTab, tradeHubSection, crossLeagueMateIntel]);

  return { crossLeagueMateIntel, loadingCrossLeagueMateIntel };
}
