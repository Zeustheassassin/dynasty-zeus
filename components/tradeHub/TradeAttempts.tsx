"use client";
import React, { useState } from "react";
import { getStoredPickValue } from "../../lib/helpers";
import type {
  TradeAttempt, TradeAttemptStatus, TradeAttemptAsset, TradeAttemptPick,
  SleeperRoster, SleeperPlayer, SleeperUser, AugmentedPick,
} from "../../lib/types";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";

interface CounterDraft {
  givePlayers: TradeAttemptAsset[];
  givePicks: TradeAttemptPick[];
  receivePlayers: TradeAttemptAsset[];
  receivePicks: TradeAttemptPick[];
}

interface TradeAttemptsProps {
  tradeAttempts: TradeAttempt[];
  loadingTradeAttempts: boolean;
  tradeAttemptsLeagueId: string | null;
  onUpdateAttemptStatus: (id: string, status: TradeAttemptStatus, counterDetails?: string) => Promise<void>;
  onDeleteAttempt: (id: string) => Promise<void>;
  onLoadTradeAttempts: (leagueId: string) => Promise<void>;
  onMarkAttempted: (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => Promise<void>;
  allPicks: AugmentedPick[];
  user: SleeperUser | null;
}

function TradeAttempts({
  tradeAttempts,
  loadingTradeAttempts,
  tradeAttemptsLeagueId,
  onUpdateAttemptStatus,
  onDeleteAttempt,
  onLoadTradeAttempts,
  onMarkAttempted,
  allPicks,
  user,
}: TradeAttemptsProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();
  const { leagueAdjustedFcValues: calcFcValues, pickFcValues, selectedLeagueDynamicPickValues } = useValues();

  const [showCounterInput, setShowCounterInput] = useState<string | null>(null);
  const [counterDrafts, setCounterDrafts] = useState<Record<string, CounterDraft>>({});
  const [attemptsOwnerSearch, setAttemptsOwnerSearch] = useState("");

  if (!selectedLeague) return (
    <p className="text-gray-400 text-sm">Select a league from the dropdown above to view attempted trades.</p>
  );

  const statusConfig: Record<string, { label: string; color: string; border: string }> = {
    PENDING:     { label: "Pending",     color: "text-yellow-300", border: "border-yellow-700 bg-yellow-950/20" },
    ACCEPTED:    { label: "Accepted",    color: "text-green-300",  border: "border-green-700 bg-green-950/20"  },
    DECLINED:    { label: "Declined",    color: "text-red-300",    border: "border-red-700 bg-red-950/20"      },
    COUNTERED:   { label: "Countered",   color: "text-orange-300", border: "border-orange-700 bg-orange-950/20"},
    NO_RESPONSE: { label: "No Response", color: "text-gray-400",   border: "border-gray-600 bg-gray-800/40"   },
  };

  const leagueAttempts = tradeAttempts
    .filter((a) => a.league_id === selectedLeague.league_id)
    .filter((a) => !attemptsOwnerSearch.trim() || a.partner_name.toLowerCase().includes(attemptsOwnerSearch.toLowerCase()))
    .sort((a, b) => {
      const aPending = a.status === "PENDING" ? 0 : 1;
      const bPending = b.status === "PENDING" ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return new Date(b.attempted_at).getTime() - new Date(a.attempted_at).getTime();
    });

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Attempted Trades</div>
        <div className="mt-1 text-sm text-gray-200">
          Track trades you&apos;ve offered in <strong className="text-gray-100">{selectedLeague.name}</strong>. Mark outcomes to suppress duplicate suggestions and build owner profiles.
        </div>
        <div className="mt-3">
          <input
            type="text"
            value={attemptsOwnerSearch}
            onChange={(e) => setAttemptsOwnerSearch(e.target.value)}
            placeholder="Search by owner…"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {loadingTradeAttempts && <p className="text-sm text-gray-400">Loading…</p>}

      {!loadingTradeAttempts && tradeAttemptsLeagueId !== selectedLeague.league_id && (
        <button
          onClick={() => onLoadTradeAttempts(selectedLeague.league_id)}
          className="w-full rounded-xl border border-orange-700 bg-orange-950/20 py-3 text-sm font-medium text-orange-300 hover:border-orange-500 transition"
        >
          Load Attempted Trades for {selectedLeague.name}
        </button>
      )}

      {!loadingTradeAttempts && tradeAttemptsLeagueId === selectedLeague.league_id && leagueAttempts.length === 0 && (
        <p className="text-sm text-gray-400">No attempted trades recorded for {selectedLeague.name} yet. Use &quot;Mark Attempted&quot; on any trade card in the Finder or Calculator.</p>
      )}

      {!loadingTradeAttempts && leagueAttempts.map((attempt) => {
        const sc = statusConfig[attempt.status] ?? statusConfig.PENDING;
        const isShowingCounter = showCounterInput === attempt.id;

        return (
          <div key={attempt.id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-blue-300">{attempt.partner_name}</span>
              <span className="rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-gray-400 uppercase">
                {attempt.source}
              </span>
              {attempt.initiated_by === "THEM" ? (
                <span className="rounded-full border border-indigo-700 bg-indigo-950/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                  Sent by Them
                </span>
              ) : (
                <span className="rounded-full border border-orange-800 bg-orange-950/20 px-2 py-0.5 text-[10px] font-semibold text-orange-400">
                  Sent by Me
                </span>
              )}
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${sc.border} ${sc.color}`}>
                {sc.label}
              </span>
              <div className="ml-auto flex flex-col items-end text-[10px] text-gray-500">
                <span>{attempt.initiated_by === "THEM" ? "Received" : "Offered"} {formatDate(attempt.attempted_at)}</span>
                {attempt.resolved_at && attempt.status !== "PENDING" && (
                  <span className={sc.color}>{sc.label} {formatDate(attempt.resolved_at)}</span>
                )}
              </div>
            </div>

            {/* Trade columns */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Give</div>
                <div className="space-y-1">
                  {attempt.give_players.map((p) => (
                    <div key={p.player_id} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-white truncate">{p.name}</span>
                        <span className="text-[10px] text-gray-500 shrink-0 uppercase">{p.position}</span>
                      </div>
                      {p.value > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{p.value.toLocaleString()}</span>}
                    </div>
                  ))}
                  {attempt.give_picks.map((pk) => (
                    <div key={pk.key} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-white truncate">{pk.label}</span>
                        <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                      </div>
                      {pk.value > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{pk.value.toLocaleString()}</span>}
                    </div>
                  ))}
                  {attempt.give_players.length === 0 && attempt.give_picks.length === 0 && <p className="text-xs text-gray-600">—</p>}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-green-400 mb-1.5">You Receive</div>
                <div className="space-y-1">
                  {attempt.receive_players.map((p) => (
                    <div key={p.player_id} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-white truncate">{p.name}</span>
                        <span className="text-[10px] text-gray-500 shrink-0 uppercase">{p.position}</span>
                      </div>
                      {p.value > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{p.value.toLocaleString()}</span>}
                    </div>
                  ))}
                  {attempt.receive_picks.map((pk) => (
                    <div key={pk.key} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-white truncate">{pk.label}</span>
                        <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                      </div>
                      {pk.value > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{pk.value.toLocaleString()}</span>}
                    </div>
                  ))}
                  {attempt.receive_players.length === 0 && attempt.receive_picks.length === 0 && <p className="text-xs text-gray-600">—</p>}
                </div>
              </div>
            </div>

            {/* Counter trade builder */}
            {isShowingCounter && (() => {
              const draft = counterDrafts[attempt.id] ?? {
                givePlayers: [], givePicks: [], receivePlayers: [], receivePicks: [],
              };
              const patch = (updates: Partial<CounterDraft>) =>
                setCounterDrafts((prev) => ({ ...prev, [attempt.id]: { ...draft, ...updates } }));

              const oppRoster = rosters.find((r) => Number(r.roster_id) === Number(attempt.partner_roster_id));
              const myRosterC = rosters.find((r) => r.owner_id === user?.user_id);
              const SKILL_POS = ["QB", "RB", "WR", "TE"];
              const calcValC = (id: string) => (calcFcValues as Record<string, number>)[id] ?? players[id]?.value ?? 0;

              const buildRosterAssets = (roster: SleeperRoster | undefined) =>
                (roster?.players ?? [])
                  .map((id: string) => players[id])
                  .filter((p): p is SleeperPlayer => !!p && SKILL_POS.includes(p.position))
                  .sort((a, b) => calcValC(b.player_id) - calcValC(a.player_id));

              const buildPickAssets = (roster: SleeperRoster | undefined): TradeAttemptPick[] =>
                allPicks
                  .filter((p) => Number(p.owner_id) === Number(roster?.roster_id))
                  .map((p) => {
                    const val = selectedLeagueDynamicPickValues[`${p.season}-${p.round}-${p.roster_id}`]?.expectedValue
                      ?? getStoredPickValue(pickFcValues, p);
                    const origOwner = p.roster_id !== p.owner_id
                      ? rosters.find((r) => Number(r.roster_id) === Number(p.roster_id))
                      : null;
                    const origName = origOwner ? (users[origOwner.owner_id] || `Team ${p.roster_id}`) : null;
                    const via = origName ? ` (via ${origName})` : "";
                    const isSlotted = p.slot && String(p.slot).includes(".");
                    const label = isSlotted ? `${p.season} ${p.slot}${via}` : `${p.season} Rd ${p.round}${via}`;
                    const key = `${p.season}-${p.round}-${p.roster_id}`;
                    return { key, label, value: val };
                  })
                  .filter((p) => p.value > 0)
                  .sort((a, b) => b.value - a.value);

              const oppPlayers = buildRosterAssets(oppRoster);
              const myPlayers  = buildRosterAssets(myRosterC);
              const oppPicks   = buildPickAssets(oppRoster);
              const myPicks    = buildPickAssets(myRosterC);

              const addPlayer = (p: SleeperPlayer, side: "give" | "receive") => {
                const asset: TradeAttemptAsset = { player_id: p.player_id, name: p.full_name, position: p.position, value: calcValC(p.player_id) };
                if (side === "give") patch({ givePlayers: [...draft.givePlayers, asset] });
                else patch({ receivePlayers: [...draft.receivePlayers, asset] });
              };
              const removePlayer = (pid: string, side: "give" | "receive") => {
                if (side === "give") patch({ givePlayers: draft.givePlayers.filter((p) => p.player_id !== pid) });
                else patch({ receivePlayers: draft.receivePlayers.filter((p) => p.player_id !== pid) });
              };
              const addPick = (pk: TradeAttemptPick, side: "give" | "receive") => {
                if (side === "give") patch({ givePicks: [...draft.givePicks, pk] });
                else patch({ receivePicks: [...draft.receivePicks, pk] });
              };
              const removePick = (key: string, side: "give" | "receive") => {
                if (side === "give") patch({ givePicks: draft.givePicks.filter((p) => p.key !== key) });
                else patch({ receivePicks: draft.receivePicks.filter((p) => p.key !== key) });
              };

              const canSave = draft.givePlayers.length + draft.givePicks.length + draft.receivePlayers.length + draft.receivePicks.length > 0;

              const renderColumn = (
                side: "give" | "receive",
                label: string,
                _headerColor: string,
                availPlayers: SleeperPlayer[],
                availPicks: TradeAttemptPick[],
              ) => {
                const chosenPlayers = side === "give" ? draft.givePlayers : draft.receivePlayers;
                const chosenPicks   = side === "give" ? draft.givePicks   : draft.receivePicks;
                const chosenPids    = new Set(chosenPlayers.map((p) => p.player_id));
                const chosenPkeys   = new Set(chosenPicks.map((p) => p.key));
                const availP = availPlayers.filter((p) => !chosenPids.has(p.player_id));
                const availK = availPicks.filter((p) => !chosenPkeys.has(p.key));
                const accentBg = side === "give" ? "bg-green-900/20 border-green-800/50" : "bg-red-900/20 border-red-800/50";
                const accentText = side === "give" ? "text-green-400" : "text-red-400";
                const hoverBg = side === "give" ? "hover:bg-green-900/30" : "hover:bg-red-900/30";
                return (
                  <div className="flex flex-col gap-2">
                    <div className={`text-[10px] font-bold uppercase tracking-widest ${accentText}`}>{label}</div>

                    {(chosenPlayers.length > 0 || chosenPicks.length > 0) && (
                      <div className="space-y-1">
                        {chosenPlayers.map((p) => (
                          <div key={p.player_id} className={`flex items-center justify-between rounded-lg border px-2 py-1.5 ${accentBg}`}>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs text-white truncate">{p.name}</span>
                              <span className="text-[10px] text-gray-400 uppercase">{p.position}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-1">
                              {p.value > 0 && <span className="text-[10px] font-mono text-gray-400">{p.value.toLocaleString()}</span>}
                              <button onClick={() => removePlayer(p.player_id, side)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                            </div>
                          </div>
                        ))}
                        {chosenPicks.map((pk) => (
                          <div key={pk.key} className={`flex items-center justify-between rounded-lg border px-2 py-1.5 ${accentBg}`}>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs text-white truncate">{pk.label}</span>
                              <span className="text-[10px] text-gray-400">PICK</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-1">
                              {pk.value > 0 && <span className="text-[10px] font-mono text-gray-400">{pk.value.toLocaleString()}</span>}
                              <button onClick={() => removePick(pk.key, side)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="rounded-lg border border-gray-700 bg-gray-800/40 overflow-hidden max-h-52 overflow-y-auto">
                      {availP.length === 0 && availK.length === 0 && (
                        <p className="text-xs text-gray-600 px-2 py-2">Nothing available</p>
                      )}
                      {availP.map((p) => (
                        <button
                          key={p.player_id}
                          onClick={() => addPlayer(p, side)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 text-left transition border-b border-gray-700/50 last:border-0 ${hoverBg}`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{p.full_name}</span>
                            <span className="text-[10px] text-gray-500 uppercase">{p.position}</span>
                            {p.team && <span className="text-[10px] text-gray-600">{p.team}</span>}
                          </div>
                          <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{calcValC(p.player_id).toLocaleString()}</span>
                        </button>
                      ))}
                      {availK.length > 0 && (
                        <div className="border-t border-gray-700 mt-0.5">
                          {availK.map((pk) => (
                            <button
                              key={pk.key}
                              onClick={() => addPick(pk, side)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-left transition border-b border-gray-700/50 last:border-0 ${hoverBg}`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-xs text-white truncate">{pk.label}</span>
                                <span className="text-[10px] text-blue-400">PICK</span>
                              </div>
                              <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{pk.value.toLocaleString()}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              };

              return (
                <div className="mb-3 rounded-xl border border-orange-800 bg-orange-950/10 p-3 space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-orange-400">
                    Their Counter Offer — Build the Trade
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {renderColumn("give",    "They Give",    "text-green-400", oppPlayers, oppPicks)}
                    {renderColumn("receive", "They Receive", "text-red-400",   myPlayers,  myPicks)}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      disabled={!canSave}
                      onClick={async () => {
                        await onUpdateAttemptStatus(attempt.id, "COUNTERED");
                        await onMarkAttempted({
                          league_id: attempt.league_id,
                          partner_roster_id: attempt.partner_roster_id,
                          partner_name: attempt.partner_name,
                          give_players: draft.receivePlayers,
                          give_picks:   draft.receivePicks,
                          receive_players: draft.givePlayers,
                          receive_picks:   draft.givePicks,
                          source: attempt.source,
                          initiated_by: "THEM",
                          status: "PENDING",
                          counter_details: null,
                        });
                        setShowCounterInput(null);
                        setCounterDrafts((prev) => { const n = { ...prev }; delete n[attempt.id]; return n; });
                      }}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-orange-700 text-orange-300 hover:border-orange-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Save Counter
                    </button>
                    <button
                      onClick={() => { setShowCounterInput(null); setCounterDrafts((prev) => { const n = { ...prev }; delete n[attempt.id]; return n; }); }}
                      className="text-xs text-gray-500 hover:text-gray-300 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Status buttons */}
            <div className="flex flex-wrap gap-2 mt-1">
              {(["ACCEPTED", "DECLINED", "COUNTERED", "NO_RESPONSE"] as TradeAttemptStatus[]).map((s) => {
                const cfg = statusConfig[s];
                const isActive = attempt.status === s;
                return (
                  <button
                    key={s}
                    onClick={async () => {
                      if (s === "COUNTERED") {
                        setShowCounterInput((prev) => prev === attempt.id ? null : attempt.id);
                      } else {
                        setShowCounterInput(null);
                        await onUpdateAttemptStatus(attempt.id, s);
                      }
                    }}
                    className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition ${
                      isActive
                        ? `${cfg.border} ${cfg.color} ring-1 ring-current`
                        : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {cfg.label}
                  </button>
                );
              })}
              <button
                onClick={() => { if (window.confirm("Delete this trade attempt? This cannot be undone.")) onDeleteAttempt(attempt.id); }}
                className="ml-auto text-[11px] text-gray-600 hover:text-red-400 transition"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(TradeAttempts);
