"use client";
import { useState, useEffect, useRef } from "react";
import { CURRENT_YEAR, average, isDynastyLeague } from "../lib/helpers";
import { sleeperApi } from "../lib/sleeperApi";
import { withConcurrency } from "../lib/concurrency";
import { CROSS_LEAGUE_INTEL_OWNER_BATCH, CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY, CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS } from "../lib/constants";
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


/** One dynasty league's OWNER-INDEPENDENT data — the 5 Sleeper calls a league costs. Every
 *  owner in that league derives their own view from this one fetch (see ownerViewOfLeague),
 *  so a league shared by N owners in a batch costs 5 calls, not 5N. */
interface LeagueSharedFetch {
  rosters: SleeperRoster[];
  trades: SleeperTransaction[];
  draftsData: SleeperDraft[];
}

/** One owner's view of a league: which roster in it is theirs, plus the league-wide trades and
 *  drafts BY REFERENCE. buildIntelFromLeagueResults only ever reads those two (its `.filter()`
 *  chains allocate a new array before any `.sort()`), so sharing the references across the
 *  owners in a league is safe — there is no per-owner mutation to isolate. */
interface LeagueIntelFetch {
  ownerRoster: SleeperRoster | null;
  trades: SleeperTransaction[];
  draftsData: SleeperDraft[];
}

/** One dynasty league's shared data — 5 Sleeper calls, fetched once per unique league_id. */
async function fetchLeagueIntel(leagueId: string): Promise<LeagueSharedFetch> {
  const [rosters, t0, t1, t2, draftsData] = await Promise.all([
    sleeperApi.getLeagueRosters(leagueId),
    sleeperApi.getLeagueTransactions(leagueId, 0),
    sleeperApi.getLeagueTransactions(leagueId, 1),
    sleeperApi.getLeagueTransactions(leagueId, 2),
    sleeperApi.getLeagueDrafts(leagueId),
  ]);
  return { rosters, trades: [...t0, ...t1, ...t2], draftsData };
}

/** Narrow a shared league fetch to one owner. The roster lookup is the ONLY owner-specific
 *  part of a league's intel, which is what makes the shared fetch above correct. */
function ownerViewOfLeague(shared: LeagueSharedFetch, ownerId: string): LeagueIntelFetch {
  return {
    ownerRoster: shared.rosters.find((roster) => String(roster.owner_id) === ownerId) || null,
    trades: shared.trades,
    draftsData: shared.draftsData,
  };
}

/** Pure aggregation — no network. Turns one owner's per-league fetch results into their
 *  CrossLeagueIntel profile. Every count here is across the owner's leagues OTHER than the one
 *  being traded in (loadOwnerIntelBatch filters the current league out), so nothing double-counts
 *  data the caller can already see directly. `leagueResults` may cover fewer leagues than `dynastyLeagueCount`
 *  (the owner has one or more still-outstanding leagues) — callers pass `isPartial` in that
 *  case so the summary text says so explicitly rather than looking confidently complete when
 *  it's actually an understatement of the owner's true cross-league activity. */
function buildIntelFromLeagueResults(
  dynastyLeagueCount: number,
  leagueResults: LeagueIntelFetch[],
  players: Record<string, SleeperPlayer>,
  isPartial: boolean
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
  const partialNote = isPartial
    ? ` (partial — ${leagueResults.length}/${dynastyLeagueCount} leagues loaded so far)`
    : "";
  const repeatedNames = repeatedPlayers.filter((player) => player.count >= 2).map((player) => player.name);
  const crossLeagueSummary = (repeatedNames.length > 0
    ? `Across ${dynastyLeagueCount} other dynasty leagues, leans ${topPos}/${secondPos} and repeatedly holds ${repeatedNames.join(", ")}.`
    : `Across ${dynastyLeagueCount} other dynasty leagues, leans ${topPos}/${secondPos} with an average skill-player age of ${averageAgeAllLeagues || "-"}.`) + partialNote;
  const acquiredNames = acquiredPlayers.filter((player) => player.count >= 2).map((player) => player.name);
  const crossLeagueTradeSummary = (
    crossLeagueTradeCount30d === 0
      ? "No strong cross-league trade tendency in the last 30 days."
      : acquiredNames.length > 0
      ? `Over the last 30 days, they made ${crossLeagueTradeCount30d} trades outside this league and kept buying ${acquiredNames.join(", ")}.`
      : `Over the last 30 days, they made ${crossLeagueTradeCount30d} trades outside this league, leaning ${tradePreferredPositions.slice(0, 2).join("/") || "best-player"} while moving picks ${crossLeaguePickBuys30d}-${crossLeaguePickSells30d}.`
  ) + partialNote;

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
    isPartial,
  };
}

/**
 * Builds intel for a batch of owners in two phases, so the real Sleeper-call burst stays
 * capped by CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY regardless of how many owners are in the
 * batch (a per-owner cap alone still multiplies: live testing against a 36-league account
 * showed 4 owners x a per-owner cap of 3 producing 60 concurrent calls and 429s):
 *   1. Resolve each owner's dynasty leagues (1 cheap call per owner, all in parallel).
 *   2. Collect the UNIQUE league_ids across the WHOLE batch — skipping any league already in
 *      `leagueIntelCache` from a prior pass — and fetch the rest through one globally-bounded
 *      queue (`withConcurrency`, the same shared helper every other fan-out in the app uses).
 *
 * Phase 2 is keyed by league, not by (owner, league) pair, because a league's rosters,
 * transactions and drafts are entirely owner-independent — only "which roster is mine" differs,
 * and that is derived from the shared fetch. Leaguemates who share OTHER leagues with each other
 * is this hook's whole use case, so the pair-keyed version this replaced re-fetched those shared
 * leagues once per owner in them. The browser cache in lib/clientFetch.ts absorbed much of that
 * in the happy path — but only while localStorage is healthy, and it is exactly the
 * localStorage-under-eviction-pressure case (many leagues, large payloads) where those duplicate
 * calls became real duplicate network calls, and real 429 risk on this specific hook.
 *
 * `currentLeagueId` is excluded from every owner's league list: this is CROSS-league intel, and
 * the league being traded in is already fully visible to the caller (rosters, and in-league
 * trades via leagueMateTradeIntel). Counting it here double-counted it into the 30-day trade
 * tendencies and made a player an owner holds here plus in one other league look like a
 * repeatedly-hoarded asset.
 *
 * Sept 22 code-review 50-league-scalability finding, Tier 1 #5 (Batch 4): an owner used to be
 * dropped entirely if even ONE of their leagues failed, which got specifically worse as an
 * owner's league count grew toward 50 (higher odds at least one flakes on any given pass) — a
 * persistently-unlucky high-league-count owner could effectively never load. `ownerLeagueCache`
 * (owned by the caller, persisted across passes/retries) now keeps every league that HAS
 * succeeded, so:
 *   - an owner is reported here as soon as they have data for at least one more league than
 *     `ownerLeagueCache` already held for them before this call (real forward progress) — not
 *     only once every league has succeeded. `buildIntelFromLeagueResults` is told `isPartial`
 *     whenever the cached count is still short of their true dynasty-league count, so the
 *     profile is never presented as more complete than it actually is (preserving the original
 *     "never cache a wrong-but-confident profile" intent, just at league granularity instead of
 *     owner granularity).
 *   - a later pass only re-fetches the leagues still missing from the cache — a league that
 *     already succeeded is never re-fetched, so retrying a stuck owner gets cheaper each time
 *     rather than repeating their whole league list forever.
 *   - an owner with zero real progress this call (every still-outstanding league failed again)
 *     is left out of the result entirely, same as before — the caller's per-owner cooldown
 *     throttles how soon they're retried.
 */
async function loadOwnerIntelBatch(
  ownerIds: string[],
  players: Record<string, SleeperPlayer>,
  leagueIntelCache: Map<string, LeagueSharedFetch>,
  currentLeagueId: string
): Promise<{ ownerId: string; intel: CrossLeagueIntel }[]> {
  const ownerLeagueResults = await Promise.all(
    ownerIds.map(async (ownerId) => {
      try {
        const ownerLeagues = await sleeperApi.getUserLeagues(ownerId, CURRENT_YEAR);
        const dynastyLeagues = ownerLeagues.filter(
          (league) => isDynastyLeague(league) && league.league_id !== currentLeagueId
        );
        return { ownerId, dynastyLeagues, failed: false };
      } catch (err) {
        log.warn("cross-league intel: getUserLeagues failed — will retry next pass", { ownerId, err: String(err) });
        return { ownerId, dynastyLeagues: [] as SleeperLeague[], failed: true };
      }
    })
  );

  // How many of each owner's leagues were already cached BEFORE this call, so the result step
  // below can tell real progress (something new landed in the cache) apart from an owner whose
  // still-outstanding league(s) just failed again — only the former gets reported.
  const priorCachedCount = new Map<string, number>();
  ownerLeagueResults.forEach((r) => {
    if (r.failed) return;
    priorCachedCount.set(
      r.ownerId,
      r.dynastyLeagues.filter((l) => leagueIntelCache.has(l.league_id)).length
    );
  });

  // De-duplicated queue: one entry per league_id still missing from the cache, however many
  // owners in this batch are waiting on it.
  const missingLeagues = new Map<string, SleeperLeague>();
  ownerLeagueResults.forEach((r) => {
    if (r.failed) return;
    r.dynastyLeagues.forEach((league) => {
      if (leagueIntelCache.has(league.league_id)) return;
      if (!missingLeagues.has(league.league_id)) missingLeagues.set(league.league_id, league);
    });
  });

  // withConcurrency is fail-fast WITHIN a batch (Promise.all), so per-league fault isolation
  // has to live inside fn — one league 429ing must still leave the others cached, exactly as
  // the hand-rolled Promise.allSettled loop this replaced did.
  await withConcurrency(
    [...missingLeagues.values()],
    async (league) => {
      try {
        leagueIntelCache.set(league.league_id, await fetchLeagueIntel(league.league_id));
      } catch (err) {
        log.warn("cross-league intel: a league fetch failed — will retry just this league next pass", {
          leagueId: league.league_id, err: String(err),
        });
      }
    },
    CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY
  );

  return ownerLeagueResults
    .filter((r) => !r.failed)
    .map((r) => {
      const cachedResults = r.dynastyLeagues
        .map((league) => leagueIntelCache.get(league.league_id))
        .filter((shared): shared is LeagueSharedFetch => shared !== undefined)
        .map((shared) => ownerViewOfLeague(shared, r.ownerId));
      const isComplete = cachedResults.length === r.dynastyLeagues.length;
      const madeProgress = cachedResults.length > (priorCachedCount.get(r.ownerId) ?? 0);
      if (!isComplete && !madeProgress) return null; // nothing new to report this pass
      return {
        ownerId: r.ownerId,
        intel: buildIntelFromLeagueResults(r.dynastyLeagues.length, cachedResults, players, !isComplete),
      };
    })
    .filter((x): x is { ownerId: string; intel: CrossLeagueIntel } => x !== null);
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
  // Bumped on a cooldown when nothing is currently eligible to fetch (either a pass made no
  // progress, or every still-incomplete owner is on its own per-owner cooldown below), so
  // persistently-failing owners get retried instead of being stuck forever (crossLeagueMateIntel
  // is otherwise the only dependency below that advances the effect, and neither case changes it).
  const [retryNonce, setRetryNonce] = useState(0);
  // Successful per-league fetch results, kept across passes so a retry only re-fetches the
  // leagues that failed rather than an owner's whole league list — see loadOwnerIntelBatch.
  // Keyed by league_id rather than by owner, so a league one owner has already loaded is free
  // for every other owner in it, on this pass and on every later one.
  const leagueIntelCacheRef = useRef<Map<string, LeagueSharedFetch>>(new Map());
  // Last attempt time per owner, so a still-incomplete owner (one with a persistently failing
  // league) isn't re-selected into every batch the moment OTHER owners' progress re-triggers
  // this effect — throttled to the same cadence as the all-failed retry above.
  const ownerLastAttemptRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const shouldLoadCrossLeagueIntel =
      !!leagueId &&
      !!rosters.length &&
      !!userId &&
      !!Object.keys(players || {}).length &&
      mainTab === "TRADE_HUB" && tradeHubSection === "FINDER";

    if (!shouldLoadCrossLeagueIntel) return;
    // Redundant at runtime (shouldLoadCrossLeagueIntel already requires it) — this is what
    // narrows leagueId to string for the async closure below.
    if (!leagueId) return;
    const currentLeagueId: string = leagueId;

    const ownerIds = rosters
      .filter((r) => r.owner_id && r.owner_id !== userId)
      .map((r) => String(r.owner_id));
    const stillIncompleteOwnerIds = ownerIds.filter((ownerId) => {
      const existing = crossLeagueMateIntel[ownerId];
      return !existing || existing.isPartial;
    });
    if (stillIncompleteOwnerIds.length === 0) return; // every owner is fully loaded

    const now = Date.now();
    const eligibleOwnerIds = stillIncompleteOwnerIds.filter((ownerId) => {
      const lastAttempt = ownerLastAttemptRef.current.get(ownerId);
      return lastAttempt === undefined || now - lastAttempt >= CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS;
    });

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    if (eligibleOwnerIds.length === 0) {
      // Everyone still incomplete is on cooldown right now — nothing else will change
      // crossLeagueMateIntel to naturally re-trigger this effect, so check back once the
      // cooldown has had a chance to clear instead of staying stuck.
      retryTimer = setTimeout(() => {
        if (!cancelled) setRetryNonce((n) => n + 1);
      }, CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS);
      return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
    }

    // Only a bounded batch is computed per pass — the rest stay eligible and this effect
    // re-fires (crossLeagueMateIntel is a dependency) once setCrossLeagueMateIntel below
    // lands, picking up the next batch automatically.
    const batch = eligibleOwnerIds.slice(0, CROSS_LEAGUE_INTEL_OWNER_BATCH);
    batch.forEach((ownerId) => ownerLastAttemptRef.current.set(ownerId, now));

    const loadCrossLeagueMateIntel = async () => {
      setLoadingCrossLeagueMateIntel(true);
      try {
        const succeeded = await loadOwnerIntelBatch(batch, players, leagueIntelCacheRef.current, currentLeagueId);
        if (cancelled) return;

        const noProgressCount = batch.length - succeeded.length;
        if (noProgressCount > 0) {
          log.warn("cross-league intel: some owners made no progress this pass", { noProgressCount, leagueId });
        }
        if (stillIncompleteOwnerIds.length > batch.length) {
          log.info("cross-league intel: deferring remaining owners to a later pass", {
            deferred: stillIncompleteOwnerIds.length - batch.length, leagueId,
          });
        }
        if (succeeded.length > 0) {
          setCrossLeagueMateIntel((prev) => ({
            ...prev,
            ...Object.fromEntries(succeeded.map((r) => [r.ownerId, r.intel])),
          }));
        } else {
          // Nothing changed, so nothing below will re-trigger this effect on its own — force a
          // retry on a cooldown instead of leaving this batch stuck for the rest of the session.
          retryTimer = setTimeout(() => {
            if (!cancelled) setRetryNonce((n) => n + 1);
          }, CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS);
        }
      } finally {
        if (!cancelled) setLoadingCrossLeagueMateIntel(false);
      }
    };

    loadCrossLeagueMateIntel();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [leagueId, rosters, userId, players, mainTab, tradeHubSection, crossLeagueMateIntel, retryNonce]);

  return { crossLeagueMateIntel, loadingCrossLeagueMateIntel };
}
