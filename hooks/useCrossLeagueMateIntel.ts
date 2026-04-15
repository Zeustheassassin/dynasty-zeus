"use client";
import { useState, useEffect } from "react";
import { CURRENT_YEAR, average } from "../lib/helpers";
import type { CrossLeagueIntel, CrossLeagueIntelPlayer, SleeperRoster, SleeperPlayer, SleeperLeague, SleeperTransaction, SleeperDraft, LeagueHubTab } from "../lib/types";

interface UseCrossLeagueMateIntelOptions {
  leagueId: string | null | undefined;
  rosters: SleeperRoster[];
  userId: string | null | undefined;
  players: Record<string, SleeperPlayer>;
  mainTab: string;
  leagueHubTab: LeagueHubTab;
  tradeHubSection: string;
}

export function useCrossLeagueMateIntel({
  leagueId,
  rosters,
  userId,
  players,
  mainTab,
  leagueHubTab,
  tradeHubSection,
}: UseCrossLeagueMateIntelOptions) {
  const [crossLeagueMateIntel, setCrossLeagueMateIntel] = useState<Record<string, CrossLeagueIntel>>({});
  const [loadingCrossLeagueMateIntel, setLoadingCrossLeagueMateIntel] = useState(false);

  useEffect(() => {
    const shouldLoadCrossLeagueIntel =
      !!leagueId &&
      !!rosters.length &&
      !!userId &&
      !!Object.keys(players || {}).length &&
      (
        (mainTab === "LEAGUES" && leagueHubTab === "LEAGUE_MATES") ||
        (mainTab === "TRADE_HUB" && (tradeHubSection === "FINDER" || tradeHubSection === "RECOMMENDATIONS"))
      );

    if (!shouldLoadCrossLeagueIntel) return;

    const ownerIds = rosters
      .filter((r) => r.owner_id && r.owner_id !== userId)
      .map((r) => String(r.owner_id));
    const missingOwnerIds = ownerIds.filter((ownerId) => !crossLeagueMateIntel[ownerId]);
    if (missingOwnerIds.length === 0) return;

    let cancelled = false;

    const loadCrossLeagueMateIntel = async () => {
      setLoadingCrossLeagueMateIntel(true);
      try {
        const entries = await Promise.all(
          missingOwnerIds.map(async (ownerId) => {
            const ownerLeagues = await fetch(`https://api.sleeper.app/v1/user/${ownerId}/leagues/nfl/${CURRENT_YEAR}`)
              .then((r) => r.json() as Promise<SleeperLeague[]>)
              .then((data) => Array.isArray(data) ? data : [])
              .catch((): SleeperLeague[] => []);

            const dynastyLeagues = ownerLeagues.filter((league) =>
              ((league.settings?.taxi_slots ?? 0) > 0 || (league.roster_positions?.length ?? 0) > 20) &&
              (league.settings?.best_ball ?? 0) === 0
            );

            const rosterResults = await Promise.all(
              dynastyLeagues.map(async (league) => {
                const leagueRosters = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`)
                  .then((r) => r.json() as Promise<SleeperRoster[]>)
                  .catch((): SleeperRoster[] => []);
                return (Array.isArray(leagueRosters) ? leagueRosters : []).find((roster) => String(roster.owner_id) === ownerId) || null;
              })
            );

            const tradeLeagueResults = await Promise.all(
              dynastyLeagues.map(async (league) => {
                const [leagueRosters, t0, t1, t2, draftsData] = await Promise.all([
                  fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then((r) => r.json() as Promise<SleeperRoster[]>).catch((): SleeperRoster[] => []),
                  fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/0`).then((r) => r.json() as Promise<SleeperTransaction[]>).catch((): SleeperTransaction[] => []),
                  fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/1`).then((r) => r.json() as Promise<SleeperTransaction[]>).catch((): SleeperTransaction[] => []),
                  fetch(`https://api.sleeper.app/v1/league/${league.league_id}/transactions/2`).then((r) => r.json() as Promise<SleeperTransaction[]>).catch((): SleeperTransaction[] => []),
                  fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then((r) => r.json() as Promise<SleeperDraft[]>).catch((): SleeperDraft[] => []),
                ]);
                const ownerRoster = (Array.isArray(leagueRosters) ? leagueRosters : []).find((roster) => String(roster.owner_id) === ownerId) || null;
                return {
                  ownerRoster,
                  trades: [
                    ...(Array.isArray(t0) ? t0 : []),
                    ...(Array.isArray(t1) ? t1 : []),
                    ...(Array.isArray(t2) ? t2 : []),
                  ] as SleeperTransaction[],
                  draftsData: (Array.isArray(draftsData) ? draftsData : []) as SleeperDraft[],
                };
              })
            );

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

            rosterResults.filter(Boolean).forEach((ownerRoster) => {
              (ownerRoster!.players || []).forEach((playerId: string) => {
                const player = players[playerId];
                if (!player || !["QB", "RB", "WR", "TE"].includes(player.position)) return;
                ownedPlayerCounts[playerId] = (ownedPlayerCounts[playerId] || 0) + 1;
                ownedPositionCounts[player.position] = (ownedPositionCounts[player.position] || 0) + 1;
                allSkillPlayers.push(player);
              });
            });

            const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
            tradeLeagueResults.forEach(({ ownerRoster, trades, draftsData }) => {
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
              ? `Across ${dynastyLeagues.length} dynasty leagues, leans ${topPos}/${secondPos} and repeatedly holds ${repeatedNames.join(", ")}.`
              : `Across ${dynastyLeagues.length} dynasty leagues, leans ${topPos}/${secondPos} with an average skill-player age of ${averageAgeAllLeagues || "-"}.`;
            const acquiredNames = acquiredPlayers.filter((player) => player.count >= 2).map((player) => player.name);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, rosters, userId, players, mainTab, leagueHubTab, tradeHubSection, crossLeagueMateIntel]);

  return { crossLeagueMateIntel, loadingCrossLeagueMateIntel };
}
