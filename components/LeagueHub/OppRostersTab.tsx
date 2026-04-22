"use client";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { CURRENT_YEAR, YEARS } from "../../lib/helpers";
import type { SleeperUser, SleeperTradedPick, SleeperPlayer } from "../../lib/types";

interface OppRostersTabProps {
  user: SleeperUser | null;
  allPicks: SleeperTradedPick[];
  oppRosterTab: string;
  setOppRosterTab: (tab: string) => void;
  oppRosterOwnerId: string;
  setOppRosterOwnerId: (id: string) => void;
  oppRosterSearch: string;
  setOppRosterSearch: (s: string) => void;
}

export default function OppRostersTab({
  user,
  allPicks,
  oppRosterTab,
  setOppRosterTab,
  oppRosterOwnerId,
  setOppRosterOwnerId,
  oppRosterSearch,
  setOppRosterSearch,
}: OppRostersTabProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();

  if (!selectedLeague || !rosters.length) return (
    <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view opponent rosters.</p>
  );

  const oppRolePriority: Record<string, number> = { starter: 0, bench: 1, taxi: 2 };

  const oppRoster = rosters.find((r) => r.owner_id === oppRosterOwnerId);
  const oppPlayerIds: string[] = oppRoster?.players || [];
  const oppTaxiIds = new Set<string>(oppRoster?.taxi || []);
  const oppStarterIds = new Set<string>(oppRoster?.starters || []);

  const getOppRole = (id: string) => {
    if (oppStarterIds.has(id)) return "starter";
    if (oppTaxiIds.has(id)) return "taxi";
    return "bench";
  };

  const oppGrouped: Record<string, Array<SleeperPlayer & { role: string }>> = { QB: [], RB: [], WR: [], TE: [] };
  oppPlayerIds.forEach((id) => {
    const p = players[id];
    if (!p || !oppGrouped[p.position]) return;
    oppGrouped[p.position].push({ ...p, role: getOppRole(id) });
  });
  Object.keys(oppGrouped).forEach((pos) => {
    oppGrouped[pos].sort((a, b) => {
      const rd = oppRolePriority[a.role] - oppRolePriority[b.role];
      return rd !== 0 ? rd : (b.value || 0) - (a.value || 0);
    });
  });

  const oppFilteredPlayers = (["QB","RB","WR","TE"].includes(oppRosterTab) ? oppGrouped[oppRosterTab] : [])
    ?.filter((p) => p.full_name?.toLowerCase().includes(oppRosterSearch.toLowerCase()));

  const oppPicksForOwner = allPicks.filter((p) => p.owner_id === oppRoster?.roster_id);

  const roleColors: Record<string, string> = {
    starter: "bg-green-800/60",
    bench: "bg-blue-800/40",
    taxi: "bg-purple-800/60",
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-400">{selectedLeague.name}</span>
        <select
          value={oppRosterOwnerId}
          onChange={(e) => { setOppRosterOwnerId(e.target.value); setOppRosterTab("QB"); setOppRosterSearch(""); }}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
        >
          <option value="">— select an owner —</option>
          {rosters
            .filter((r) => r.owner_id && r.owner_id !== user?.user_id)
            .map((r) => (
              <option key={r.roster_id} value={r.owner_id}>
                {users[r.owner_id] || r.owner_id}
              </option>
            ))}
        </select>
      </div>

      {oppRosterOwnerId && !oppRoster && (
        <p className="text-sm text-gray-500">Roster not found.</p>
      )}

      {oppRoster && (
        <>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-4">
            <div className="flex flex-wrap gap-2 mb-3">
              {["ROSTER","QB","RB","WR","TE","PICKS"].map((pos) => (
                <button
                  key={pos}
                  onClick={() => setOppRosterTab(pos)}
                  className={`px-3 py-1 rounded text-sm ${oppRosterTab === pos ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"}`}
                >
                  {pos}
                </button>
              ))}
            </div>
            {["QB","RB","WR","TE"].includes(oppRosterTab) && (
              <input
                className="w-full p-2.5 rounded bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search players..."
                value={oppRosterSearch}
                onChange={(e) => setOppRosterSearch(e.target.value)}
              />
            )}
          </div>

          {["QB","RB","WR","TE"].includes(oppRosterTab) && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
              <div className="text-sm font-semibold mb-3 text-gray-300">{oppRosterTab}</div>
              {oppFilteredPlayers?.map((p) => (
                <div key={p.player_id} className={`flex items-center justify-between px-3 py-1.5 mb-1 rounded text-sm ${roleColors[p.role]}`}>
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-medium">{p.full_name}</span>
                    <span className="text-xs text-gray-400">{p.team}</span>
                    <span className="text-xs text-gray-500">{p.role.toUpperCase()}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                    <span className="text-gray-400">Age {p.age || "—"}</span>
                    <span className="text-blue-400 font-semibold">{p.value || 0}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {oppRosterTab === "ROSTER" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {["QB","RB","WR","TE"].map((pos) => {
                const posPlayers = oppGrouped[pos];
                const starters = posPlayers.filter((p) => p.role === "starter");
                const bench = posPlayers.filter((p) => p.role === "bench");
                const totalVal = posPlayers.reduce((s: number, p) => s + (p.value || 0), 0);
                return (
                  <div key={pos} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                    <div className="flex justify-between mb-3">
                      <div className="font-semibold text-sm">{pos} {posPlayers.length} TOTAL</div>
                      <div className="text-xs text-gray-400">TOTAL {pos} VAL {totalVal}</div>
                    </div>
                    {starters.map((p, i) => (
                      <div key={`s-${i}`} className="flex justify-between items-center bg-green-900/30 border border-green-700 rounded p-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="text-xs px-2 py-1 rounded bg-green-700">STARTER</div>
                          <div>{p.full_name}</div>
                        </div>
                        <div className="text-xs text-gray-300">VAL {p.value || 0}</div>
                      </div>
                    ))}
                    {bench.map((p, i) => (
                      <div key={`b-${i}`} className="flex justify-between items-center bg-blue-900/30 border border-blue-700 rounded p-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="text-xs px-2 py-1 rounded bg-blue-700">{pos}{starters.length + i + 1}</div>
                          <div>{p.full_name}</div>
                        </div>
                        <div className="text-xs text-gray-300">VAL {p.value || 0}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {oppTaxiIds.size > 0 && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                  <div className="font-semibold text-sm text-purple-400 mb-3">TAXI {oppTaxiIds.size} TOTAL</div>
                  {[...oppTaxiIds].map((id, i) => {
                    const p = players[id];
                    if (!p) return null;
                    return (
                      <div key={id} className="flex justify-between items-center bg-purple-900/30 border border-purple-700 rounded p-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="text-xs px-2 py-1 rounded bg-purple-700">TX{i+1}</div>
                          <div>{p.full_name}</div>
                        </div>
                        <div className="text-xs text-gray-400">VAL {p.value || 0}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {oppRosterTab === "PICKS" && (
            <div className="mt-2">
              {YEARS.map((year) => {
                const yearPicks = oppPicksForOwner
                  .filter((p) => p.season === year)
                  .sort((a, b) => a.round - b.round);
                if (!yearPicks.length) return null;
                return (
                  <div key={year} className="mb-4 bg-gray-900 border border-gray-700 rounded-lg p-4">
                    <div className="font-semibold text-sm mb-2">{year} Picks — {yearPicks.length} TOTAL</div>
                    <div className="flex flex-wrap gap-2">
                      {yearPicks.map((pick) => {
                        const label = pick.season === CURRENT_YEAR ? pick.slot : `${pick.round}${["th","st","nd","rd"][pick.round] || "th"}`;
                        const originalOwner = users[pick.roster_id] || "";
                        return (
                          <div key={`${pick.season}-${pick.round}-${pick.roster_id}-${pick.owner_id}`} className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1 ${
                            pick.round === 1 ? "bg-yellow-900/40 border-yellow-600 text-yellow-300"
                            : pick.round === 2 ? "bg-green-900/40 border-green-600 text-green-300"
                            : pick.round === 3 ? "bg-blue-900/40 border-blue-600 text-blue-300"
                            : "bg-orange-900/40 border-orange-600 text-orange-300"
                          }`}>
                            <span className="font-semibold">{label}</span>
                            {originalOwner && pick.roster_id !== oppRoster.roster_id && (
                              <span className="text-[10px] text-gray-300">via {originalOwner}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
