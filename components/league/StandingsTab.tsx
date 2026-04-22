"use client";
// ── StandingsTab ──────────────────────────────────────────────────────────────
// Displays the win-loss standings for the selected league with playoff cut line.
import { useLeague } from "../../lib/LeagueContext";
import { useMyRoster } from "../../lib/RosterContext";

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
}

export default function StandingsTab({ standings }: StandingsTabProps) {
  const { selectedLeague, rosters, users } = useLeague();
  const { myRoster: roster } = useMyRoster();

  if (!selectedLeague || !roster) {
    return (
      <p className="text-sm text-gray-500">
        Select a league from Rosters &amp; Rules first to see its standings.
      </p>
    );
  }

  const playoffTeams =
    selectedLeague.settings?.playoff_teams ?? Math.min(Math.ceil(rosters.length / 2), 6);

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 shadow-md">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">
        {selectedLeague.name} — Standings
      </h3>
      {standings.map((team, index) => {
        const isMe = team.roster_id === roster.roster_id;
        const isCutLine = index === playoffTeams - 1;
        const efficiency = team.max_pf > 0 ? Math.round((team.fpts / team.max_pf) * 100) : null;
        return (
          <div key={team.roster_id}>
            <div
              className={`flex justify-between p-2 rounded mb-1 ${
                isMe ? "bg-blue-800/40" : "bg-gray-800"
              }`}
            >
              <div className="text-sm">
                {index + 1}.{" "}
                <span>{users[team.owner_id] || "Team"}</span>
              </div>
              <div className="text-xs text-gray-400">
                {team.wins}-{team.losses}
                {team.ties ? `-${team.ties}` : ""} •{" "}
                {Math.round(team.fpts)} pts • Max {Math.round(team.max_pf)}
                {efficiency !== null ? (
                  <span
                    className={`ml-1.5 ${
                      efficiency >= 85
                        ? "text-green-500"
                        : efficiency >= 70
                        ? "text-gray-400"
                        : "text-red-500"
                    }`}
                  >
                    ({efficiency}% eff)
                  </span>
                ) : null}
              </div>
            </div>
            {isCutLine && (
              <div className="border-t border-yellow-500 my-2 text-center text-xs text-yellow-400">
                Playoff Cut Line
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
