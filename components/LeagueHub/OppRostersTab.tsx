"use client";
import { memo, useMemo } from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { CURRENT_YEAR, rankAgainstLeague } from "../../lib/helpers";
import type { SleeperUser, SleeperTradedPick, SleeperPlayer } from "../../lib/types";

const ROLE_PRIORITY: Record<string, number> = { starter: 0, bench: 1, taxi: 2 };
const ROLE_LABEL: Record<string, string> = { starter: "Starter", bench: "Bench", taxi: "Taxi" };
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type Position = typeof POSITIONS[number];

interface OppRostersTabProps {
  user: SleeperUser | null;
  allPicks: SleeperTradedPick[];
  oppRosterOwnerId: string;
  setOppRosterOwnerId: (id: string) => void;
}

function OppRostersTab({
  user,
  allPicks,
  oppRosterOwnerId,
  setOppRosterOwnerId,
}: OppRostersTabProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();

  const oppRoster = useMemo(
    () => rosters.find((r) => r.owner_id === oppRosterOwnerId),
    [rosters, oppRosterOwnerId]
  );

  const oppGrouped = useMemo(() => {
    const g: Record<Position, Array<SleeperPlayer & { role: string }>> = { QB: [], RB: [], WR: [], TE: [] };
    if (!oppRoster || !players) return g;
    const starterIds = new Set<string>(oppRoster.starters || []);
    const taxiIds = new Set<string>(oppRoster.taxi || []);
    const getRole = (id: string) => {
      if (starterIds.has(id)) return "starter";
      if (taxiIds.has(id)) return "taxi";
      return "bench";
    };
    (oppRoster.players || []).forEach((id: string) => {
      const p = players[id];
      if (!p) return;
      const pos = p.position as Position;
      if (!g[pos]) return;
      g[pos].push({ ...p, role: getRole(id) });
    });
    (Object.keys(g) as Position[]).forEach((pos) => {
      g[pos].sort((a, b) => {
        const rd = ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        return rd !== 0 ? rd : (b.value || 0) - (a.value || 0);
      });
    });
    return g;
  }, [oppRoster, players]);

  const positionRankByPos = useMemo(() => {
    const map: Partial<Record<Position, number>> = {};
    if (!oppRoster || !rosters.length || !players) return map;
    POSITIONS.forEach((pos) => {
      const totals = rosters.map((r) =>
        (r.players || []).reduce((s: number, id: string) => {
          const p = players[id];
          return p && p.position === pos ? s + (p.value || 0) : s;
        }, 0)
      );
      const oppTotal = (oppRoster.players || []).reduce((s: number, id: string) => {
        const p = players[id];
        return p && p.position === pos ? s + (p.value || 0) : s;
      }, 0);
      map[pos] = rankAgainstLeague(totals, oppTotal);
    });
    return map;
  }, [oppRoster, rosters, players]);

  const oppPicksByYear = useMemo(() => {
    if (!oppRoster) return [] as Array<{ year: string; list: SleeperTradedPick[] }>;
    const owned = allPicks.filter((p) => p.owner_id === oppRoster.roster_id);
    const years = Array.from(new Set(owned.map((p) => String(p.season)))).sort();
    return years
      .map((year) => ({
        year,
        list: owned
          .filter((p) => p.season === year)
          .sort((a, b) => {
            if (a.round !== b.round) return a.round - b.round;
            return (a.pick_no || 0) - (b.pick_no || 0);
          }),
      }))
      .filter((g) => g.list.length > 0);
  }, [oppRoster, allPicks]);

  if (!selectedLeague || !rosters.length) return (
    <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view opponent rosters.</p>
  );

  const totalPicks = oppPicksByYear.reduce((s, g) => s + g.list.length, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-400">{selectedLeague.name}</span>
        <select
          value={oppRosterOwnerId}
          onChange={(e) => setOppRosterOwnerId(e.target.value)}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {POSITIONS.map((pos) => {
            const list = oppGrouped[pos];
            const totalValue = list.reduce((s, p) => s + (p.value || 0), 0);
            const ages = list.map((p) => Number(p.age)).filter((a) => Number.isFinite(a) && a > 0);
            const avgAge = ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : null;
            const rank = positionRankByPos[pos];
            return (
              <div key={pos} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="border-b border-gray-800 pb-2 mb-2">
                  <div className="text-xs text-gray-400">
                    {pos} Rank: <span className="font-semibold text-emerald-400">{rank ?? "—"}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    Value: <span className="text-gray-200 font-medium">{totalValue.toLocaleString()}</span>
                    {avgAge != null && (
                      <> {" | "}Age: <span className="text-gray-200 font-medium">{avgAge.toFixed(1)}</span></>
                    )}
                  </div>
                </div>
                <div className="space-y-0.5">
                  {list.length === 0 ? (
                    <div className="text-[11px] text-gray-600 italic">No players</div>
                  ) : (
                    list.map((p) => (
                      <div key={p.player_id} className="flex items-center justify-between gap-2 text-xs py-0.5">
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-gray-200">{p.full_name}</div>
                          <div className="text-[10px] text-gray-500">{ROLE_LABEL[p.role] ?? ""}</div>
                        </div>
                        <span className="text-emerald-400 font-medium whitespace-nowrap">{(p.value || 0).toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="border-b border-gray-800 pb-2 mb-2">
              <div className="text-xs text-gray-400">Picks: <span className="font-semibold text-emerald-400">{totalPicks}</span></div>
            </div>
            <div className="space-y-2">
              {oppPicksByYear.length === 0 ? (
                <div className="text-[11px] text-gray-600 italic">No picks</div>
              ) : (
                oppPicksByYear.map(({ year, list }) => (
                  <div key={year}>
                    <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{year}</div>
                    <div className="space-y-0.5">
                      {list.map((pick) => {
                        const originalOwner = users[pick.roster_id] || "";
                        const label = pick.season === CURRENT_YEAR
                          ? pick.slot
                          : `${pick.round}${["th", "st", "nd", "rd"][pick.round] || "th"}`;
                        const showVia = originalOwner && pick.roster_id !== oppRoster.roster_id;
                        return (
                          <div
                            key={`${pick.season}-${pick.round}-${pick.roster_id}-${pick.owner_id}`}
                            className="flex items-center justify-between gap-2 text-xs py-0.5"
                          >
                            <span className="text-gray-200 font-medium whitespace-nowrap">{label}</span>
                            {showVia && (
                              <span className="text-[10px] text-gray-500 truncate">via {originalOwner}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(OppRostersTab);
