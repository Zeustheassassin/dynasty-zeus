"use client";
// ============================================================
// Shared per-league core fetch — rosters + traded picks + drafts + users,
// plus the user_id -> display-name map derived from them.
// ============================================================
// Previously hand-rolled identically in useLeagueOverview.ts and
// useSpyState.ts's loadSpyLeagueCore, with one undocumented divergence:
// useSpyState also aliased userMap[roster_id] to the owner's name (consumed
// by components/shared/RosterSelect.tsx's `users[r.roster_id] || users[r.owner_id]`
// lookup) while useLeagueOverview did not (its only consumer,
// PlayerProfilePanel.tsx, only ever reads userMap[owner_id]). Preserved here
// via `aliasRosterId` rather than silently merging the two behaviors
// (Sept 22 code-review 50-league-scalability, Tier 4 finding #11).
//
// The league-transactions cron (app/api/cron/league-transactions/route.ts)
// deliberately does NOT use this: it fetches through safeFetch (server-side,
// no localStorage cache) rather than sleeperApi, and needs a different shape
// (roster_id -> user_id for pick-slot resolution, transaction-weeks instead
// of traded picks) — folding it in would be a wider behavior change, not
// hygiene.
// ============================================================
import { sleeperApi } from "../lib/sleeperApi";
import type {
  SleeperRoster,
  SleeperTradedPick,
  SleeperDraft,
  SleeperUser,
} from "../lib/types";

export interface LeagueCoreFetchResult {
  rosters: SleeperRoster[];
  tradedPicks: SleeperTradedPick[];
  drafts: SleeperDraft[];
  users: SleeperUser[];
  userMap: Record<string, string>;
}

export async function fetchLeagueCore(
  leagueId: string,
  opts: { aliasRosterId?: boolean } = {}
): Promise<LeagueCoreFetchResult> {
  const [rostersData, tradedPicksData, draftsData, usersData] = await Promise.all([
    sleeperApi.getLeagueRosters(leagueId),
    sleeperApi.getLeagueTradedPicks(leagueId),
    sleeperApi.getLeagueDrafts(leagueId),
    sleeperApi.getLeagueUsers(leagueId),
  ]);

  const rosters = Array.isArray(rostersData) ? rostersData : [];
  const tradedPicks = Array.isArray(tradedPicksData) ? tradedPicksData : [];
  const drafts = Array.isArray(draftsData) ? draftsData : [];
  const users = usersData || [];

  const userMap: Record<string, string> = {};
  users.forEach((u) => {
    userMap[u.user_id] = u.display_name || u.username || u.metadata?.team_name || "Team";
  });
  if (opts.aliasRosterId) {
    rosters.forEach((r) => {
      if (userMap[r.owner_id]) userMap[r.roster_id] = userMap[r.owner_id];
    });
  }

  return { rosters, tradedPicks, drafts, users, userMap };
}
