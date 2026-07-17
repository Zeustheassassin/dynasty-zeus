"use client";
// ── StandingsTab ──────────────────────────────────────────────────────────────
// Displays the win-loss standings for the selected league with playoff cut line.
import { useMemo } from "react";
import { useLeague } from "../../lib/LeagueContext";
import { useMyRoster } from "../../lib/RosterContext";
import { getDynastyTier, type DynastyTier } from "../../lib/helpers/direction/bucket";
import { CHART_STATUS, CHART_DIVERGING } from "../../lib/chartTheme";
import type { LeagueMateView } from "../../lib/types";

interface StandingRow {
  roster_id: number;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  max_pf: number;
  owner_id: string;
}

interface StandingsTabProps {
  standings: StandingRow[];
  /** Omitted in read-only contexts (e.g. spying on another user's league)
   *  where per-roster direction profiles aren't computed — bands just don't render. */
  selectedLeagueMateProfilesView?: LeagueMateView[];
}

const TIER_COLOR: Record<DynastyTier, string> = {
  Contender: CHART_STATUS.good,
  Middle: CHART_DIVERGING.neutral,
  Rebuilding: CHART_STATUS.critical,
};

const TIER_LABEL: Record<DynastyTier, string> = {
  Contender: "Contending (top dynasty tier)",
  Middle: "Middle of the pack",
  Rebuilding: "Rebuilding (bottom dynasty tier)",
};

export default function StandingsTab({ standings, selectedLeagueMateProfilesView = [] }: StandingsTabProps) {
  const { selectedLeague, rosters, users } = useLeague();
  const { myRoster: roster } = useMyRoster();

  const profileByRosterId = useMemo(
    () => new Map(selectedLeagueMateProfilesView.map((v) => [v.rosterId, v])),
    [selectedLeagueMateProfilesView]
  );

  if (!selectedLeague || !roster) {
    return (
      <p className="text-sm text-slate-500">
        Select a league from Rosters &amp; Rules first to see its standings.
      </p>
    );
  }

  const playoffTeams =
    selectedLeague.settings?.playoff_teams ?? Math.min(Math.ceil(rosters.length / 2), 6);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-md">
      <h3 className="text-sm font-semibold text-slate-200 mb-2">
        {selectedLeague.name} — Standings
      </h3>
      {profileByRosterId.size > 0 && (
        <div className="flex flex-wrap gap-3 mb-3 text-[10px] text-slate-500">
          {(Object.keys(TIER_LABEL) as DynastyTier[]).map((tier) => (
            <span key={tier} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: TIER_COLOR[tier] }} />
              {TIER_LABEL[tier]}
            </span>
          ))}
        </div>
      )}
      {standings.map((team, index) => {
        const isMe = team.roster_id === roster.roster_id;
        const isCutLine = index === playoffTeams - 1;
        const efficiency = team.max_pf > 0 ? Math.round((team.fpts / team.max_pf) * 100) : null;
        const profile = profileByRosterId.get(team.roster_id)?.directionProfile;
        const tier = profile ? getDynastyTier(profile.dynRank, rosters.length) : null;
        return (
          <div key={team.roster_id}>
            <div
              className={`flex justify-between items-center p-2 rounded mb-1 border-l-4 ${
                isMe ? "bg-blue-800/40" : "bg-slate-800"
              }`}
              style={{ borderLeftColor: tier ? TIER_COLOR[tier] : "transparent" }}
            >
              <div className="text-sm flex items-center gap-2 min-w-0">
                <span className="shrink-0">
                  {index + 1}.{" "}
                  <span>{users[team.owner_id] || "Team"}</span>
                </span>
                {profile && (
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${profile.bucketColor}`}
                    title={profile.summary}
                  >
                    {profile.bucket}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 shrink-0">
                {team.wins}-{team.losses}
                {team.ties ? `-${team.ties}` : ""} •{" "}
                {Math.round(team.fpts)} pts • Max {Math.round(team.max_pf)}
                {efficiency !== null ? (
                  <span
                    className={`ml-1.5 ${
                      efficiency >= 85
                        ? "text-emerald-500"
                        : efficiency >= 70
                        ? "text-slate-400"
                        : "text-red-500"
                    }`}
                  >
                    ({efficiency}% eff)
                  </span>
                ) : null}
              </div>
            </div>
            {isCutLine && (
              <div className="border-t border-amber-500 my-2 text-center text-xs text-amber-400">
                Playoff Cut Line
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
