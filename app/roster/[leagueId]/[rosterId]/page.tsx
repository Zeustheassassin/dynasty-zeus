// ============================================================
// /roster/{leagueId}/{rosterId} — public, shareable roster page
// ============================================================
// Same URL shape as Sleeper's own roster links. No login: the page renders a read-only view of one
// team (QB/RB/WR/TE in value order + picks) loaded client-side through the app's public proxies —
// see components/PublicRosterView.tsx and lib/helpers/publicRoster.ts. This server half only
// validates the ids and builds the link-preview title (Messages/Discord) from three Data-cached
// Sleeper calls; a failure there just falls back to a generic title.
// ============================================================

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicRosterView from "@/components/PublicRosterView";
import { SLEEPER_ID_RE } from "@/lib/apiHelpers";
import { fetchSleeperJson } from "@/lib/server/sleeperProxy";
import { publicTeamName } from "@/lib/helpers/publicRoster";
import {
  SLEEPER_BASE_URL,
  SLEEPER_LEAGUE_INFO_REVALIDATE_S,
  SLEEPER_LEAGUE_ROSTERS_REVALIDATE_S,
  SLEEPER_LEAGUE_USERS_REVALIDATE_S,
} from "@/lib/constants";
import { logger } from "@/lib/logger";
import type { SleeperLeague, SleeperRoster, SleeperUser } from "@/lib/types";

const log = logger("app/roster");

interface RosterPageProps {
  params: Promise<{ leagueId: string; rosterId: string }>;
}

/** Valid ids, or null for a malformed link. */
async function readIds(params: RosterPageProps["params"]): Promise<{ leagueId: string; rosterId: number } | null> {
  const { leagueId, rosterId } = await params;
  if (!SLEEPER_ID_RE.test(leagueId) || !/^\d{1,4}$/.test(rosterId)) return null;
  return { leagueId, rosterId: Number(rosterId) };
}

const FALLBACK_TITLE = "Dynasty roster · DynastyZeus";
const DESCRIPTION = "Dynasty roster ranked by value: QB, RB, WR, TE and draft picks.";

export async function generateMetadata({ params }: RosterPageProps): Promise<Metadata> {
  // Shared links are for the people they're sent to, not for search engines.
  const base: Metadata = { title: FALLBACK_TITLE, description: DESCRIPTION, robots: { index: false, follow: false } };
  const ids = await readIds(params);
  if (!ids) return base;
  try {
    const [league, rosters, users] = await Promise.all([
      fetchSleeperJson<SleeperLeague | null>(`${SLEEPER_BASE_URL}/league/${ids.leagueId}`, { revalidate: SLEEPER_LEAGUE_INFO_REVALIDATE_S }),
      fetchSleeperJson<SleeperRoster[] | null>(`${SLEEPER_BASE_URL}/league/${ids.leagueId}/rosters`, { revalidate: SLEEPER_LEAGUE_ROSTERS_REVALIDATE_S }),
      fetchSleeperJson<SleeperUser[] | null>(`${SLEEPER_BASE_URL}/league/${ids.leagueId}/users`, { revalidate: SLEEPER_LEAGUE_USERS_REVALIDATE_S }),
    ]);
    const roster = rosters?.find((r) => Number(r.roster_id) === ids.rosterId);
    if (!league?.name || !roster) return base;
    const owner = users?.find((u) => u.user_id === roster.owner_id);
    const title = `${publicTeamName(roster, owner)} · ${league.name}`;
    return { ...base, title, openGraph: { title, description: DESCRIPTION, siteName: "DynastyZeus" } };
  } catch (err) {
    log.warn("roster link preview lookup failed", { leagueId: ids.leagueId, err: String(err) });
    return base;
  }
}

export default async function RosterPage({ params }: RosterPageProps) {
  const ids = await readIds(params);
  if (!ids) notFound();
  return <PublicRosterView leagueId={ids.leagueId} rosterId={ids.rosterId} />;
}
