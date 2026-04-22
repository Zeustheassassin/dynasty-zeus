"use client";
import React, { useState } from "react";
import { getStoredPickValue, formatRelativeDate } from "../../lib/helpers";
import type { TradeAttempt, SleeperUser, SleeperTradedPick } from "../../lib/types";
import type { AnnotatedTrade } from "../../hooks/useUserTrades";
import { usePlayers } from "../../lib/PlayersContext";
import { useValues } from "../../lib/ValuesContext";

interface TradeLogProps {
  tradeHubData: AnnotatedTrade[] | null;
  loadingTradeHub: boolean;
  tradeHubUserId: string | null;
  user: SleeperUser | null;
  loadUserTrades: (ownerId: string) => void;
  onMarkAttempted: (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => Promise<void>;
}

function TradeLog({ tradeHubData, loadingTradeHub, tradeHubUserId, user, loadUserTrades, onMarkAttempted }: TradeLogProps) {
  const players = usePlayers();
  const { leagueAdjustedFcValues: calcFcValues, pickFcValues } = useValues();

  const [tradeLogLogged, setTradeLogLogged] = useState<Set<string>>(new Set());

  const logPickLabel = (p: SleeperTradedPick) => p.resolvedSlot ?? `${p.season} Rd ${p.round}`;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Your Trade Log</div>
        <div className="mt-1 text-sm text-gray-200">
          Your trades from the past 30 days across all dynasty leagues.
        </div>
      </div>

      {loadingTradeHub && (
        <p className="text-sm text-gray-400">Loading your trades…</p>
      )}

      {!loadingTradeHub && tradeHubUserId === user?.user_id && tradeHubData && tradeHubData.length === 0 && (
        <p className="text-sm text-gray-400">No trades found in the past 30 days.</p>
      )}

      {!loadingTradeHub && (!tradeHubData || tradeHubUserId !== user?.user_id) && (
        <button
          onClick={() => { if (user?.user_id) loadUserTrades(user.user_id); }}
          className="w-full rounded-xl border border-blue-700 bg-blue-950/30 py-3 text-sm font-medium text-blue-300 hover:border-blue-500 transition"
        >
          Load My Trades
        </button>
      )}

      {!loadingTradeHub && tradeHubUserId === user?.user_id && (tradeHubData ?? []).map((trade, i) => {
        const myRosterId = trade.myRosterId;

        const received = Object.entries(trade.adds || {})
          .filter(([, rid]) => rid === myRosterId)
          .map(([pid]) => {
            const p = players[pid];
            return { player_id: pid, name: p?.full_name || "Unknown", pos: p?.position || "", val: (calcFcValues as Record<string, number>)[pid] ?? 0 };
          });

        const given = Object.entries(trade.adds || {})
          .filter(([, rid]) => rid !== myRosterId)
          .map(([pid]) => {
            const p = players[pid];
            return { player_id: pid, name: p?.full_name || "Unknown", pos: p?.position || "", val: (calcFcValues as Record<string, number>)[pid] ?? 0 };
          });

        const logPickVal = (p: SleeperTradedPick) => {
          const slotPart = p.resolvedSlot?.match(/(\d+\.\d+)$/)?.[1];
          return getStoredPickValue(pickFcValues, slotPart ? { ...p, slot: slotPart } : p);
        };

        const picksReceived = (trade.draft_picks || [])
          .filter((p) => p.owner_id === myRosterId)
          .map((p) => ({ name: logPickLabel(p), pos: "PICK", val: logPickVal(p) }));

        const picksGiven = (trade.draft_picks || [])
          .filter((p) => p.previous_owner_id === myRosterId)
          .map((p) => ({ name: logPickLabel(p), pos: "PICK", val: logPickVal(p) }));

        const allReceived = [...received, ...picksReceived];
        const allGiven = [...given, ...picksGiven];

        const giveTotal = allGiven.reduce((s, x) => s + x.val, 0);
        const recvTotal = allReceived.reduce((s, x) => s + x.val, 0);
        const net = recvTotal - giveTotal;

        const partnerRosterIds = new Set<number>();
        Object.values(trade.adds || {}).forEach((rid) => {
          if (Number(rid) !== Number(myRosterId)) partnerRosterIds.add(Number(rid));
        });
        (trade.draft_picks || []).forEach((p) => {
          if (p.previous_owner_id && Number(p.previous_owner_id) !== Number(myRosterId)) partnerRosterIds.add(Number(p.previous_owner_id));
          if (p.owner_id && Number(p.owner_id) !== Number(myRosterId)) partnerRosterIds.add(Number(p.owner_id));
        });
        const partnerLabel = [...partnerRosterIds]
          .map((rid) => (trade.rosterToName ?? {})[rid] ?? null)
          .filter(Boolean)
          .join(", ") || null;

        return (
          <div key={trade.transaction_id} className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">{trade.leagueName}</span>
                {partnerLabel && <span className="text-xs text-gray-400 ml-2">with {partnerLabel}</span>}
              </div>
              <div className="flex items-center gap-2">
                {giveTotal > 0 && recvTotal > 0 && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${Math.abs(net) <= 300 ? "bg-yellow-900 text-yellow-300" : net > 0 ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                    {Math.abs(net) <= 300 ? "EVEN" : net > 0 ? `+${net.toLocaleString()}` : `${net.toLocaleString()}`}
                  </span>
                )}
                <span className="text-xs text-gray-500">{formatRelativeDate(trade.created)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Gave</div>
                <div className="space-y-1">
                  {allGiven.map((item) => (
                    <div key={item.name} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-white truncate">{item.name}</span>
                        <span className="text-[10px] text-gray-500 shrink-0 uppercase">{item.pos}</span>
                      </div>
                      {item.val > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{item.val.toLocaleString()}</span>}
                    </div>
                  ))}
                  {allGiven.length === 0 && <p className="text-xs text-gray-600">—</p>}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-green-400 mb-1.5">You Received</div>
                <div className="space-y-1">
                  {allReceived.map((item) => (
                    <div key={item.name} className="flex items-center justify-between rounded-lg bg-gray-800 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs text-white truncate">{item.name}</span>
                        <span className="text-[10px] text-gray-500 shrink-0 uppercase">{item.pos}</span>
                      </div>
                      {item.val > 0 && <span className="text-[10px] font-mono text-gray-400 shrink-0 ml-1">{item.val.toLocaleString()}</span>}
                    </div>
                  ))}
                  {allReceived.length === 0 && <p className="text-xs text-gray-600">—</p>}
                </div>
              </div>
            </div>
            {/* ── Log as Accepted ── */}
            {(() => {
              const txKey = trade.transaction_id ? String(trade.transaction_id) : String(i);
              const alreadyLogged = tradeLogLogged.has(txKey);
              const firstPartnerRosterId = [...partnerRosterIds][0] ?? 0;
              return (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={alreadyLogged}
                    onClick={async () => {
                      await onMarkAttempted({
                        league_id: trade.leagueId,
                        partner_roster_id: firstPartnerRosterId,
                        partner_name: partnerLabel || "Unknown",
                        give_players: given.map((g) => ({ player_id: g.player_id, name: g.name, position: g.pos, value: g.val })),
                        give_picks: picksGiven.map((p) => ({ key: p.name, label: p.name, value: p.val })),
                        receive_players: received.map((r) => ({ player_id: r.player_id, name: r.name, position: r.pos, value: r.val })),
                        receive_picks: picksReceived.map((p) => ({ key: p.name, label: p.name, value: p.val })),
                        source: "FINDER",
                        initiated_by: "ME",
                        status: "ACCEPTED",
                        counter_details: null,
                      });
                      setTradeLogLogged((prev) => new Set([...prev, txKey]));
                    }}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg transition ${
                      alreadyLogged
                        ? "bg-green-900/40 text-green-400 border border-green-700 cursor-default"
                        : "bg-gray-800 text-gray-300 border border-gray-600 hover:border-blue-500 hover:text-blue-300"
                    }`}
                  >
                    {alreadyLogged ? "✓ Logged in Attempts" : "Log in Attempted Trades"}
                  </button>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(TradeLog);
