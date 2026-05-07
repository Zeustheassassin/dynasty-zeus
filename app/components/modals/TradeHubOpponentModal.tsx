"use client";
import { CURRENT_YEAR, formatRelativeDate } from "../../../lib/helpers";
import type { SleeperPlayer, AugmentedPick, SleeperTradedPick } from "../../../lib/types";
import type { AnnotatedTrade } from "../../../hooks/useUserTrades";

interface Props {
  tradeHubUserId: string;
  users: Record<string, string>;
  loadingTradeHub: boolean;
  tradeHubData: AnnotatedTrade[] | null;
  players: Record<string, SleeperPlayer>;
  allPicks: AugmentedPick[];
  onClose: () => void;
}

export function TradeHubOpponentModal({ tradeHubUserId, users, loadingTradeHub, tradeHubData, players, allPicks, onClose }: Props) {
  const pickLabel = (p: SleeperTradedPick) => {
    if (String(p.season) === CURRENT_YEAR) {
      const match = allPicks.find(
        (ap) =>
          String(ap.season) === String(p.season) &&
          Number(ap.round) === Number(p.round) &&
          Number(ap.roster_id) === Number(p.roster_id)
      );
      if (match?.slot?.includes(".")) return `${p.season} ${match.slot}`;
    }
    return `${p.season} Rd ${p.round}`;
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-hub-modal-title"
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        className="bg-gray-900 p-6 rounded-xl w-[560px] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="trade-hub-modal-title" className="text-lg font-bold mb-1">
          {users[tradeHubUserId] || "Manager"}&apos;s Recent Trades
        </div>
        <div className="text-xs text-gray-500 mb-5">
          Past 30 days · All dynasty leagues · Up to 15 trades
        </div>

        {loadingTradeHub ? (
          <div className="text-sm text-gray-400">Loading trades...</div>
        ) : !tradeHubData?.length ? (
          <div className="text-sm text-gray-400">No trades found in the past 30 days.</div>
        ) : (
          tradeHubData.map((trade) => {
            const myRosterId = trade.myRosterId;

            const received = Object.entries(trade.adds || {})
              .filter(([, rid]) => rid === myRosterId)
              .map(([pid]) => players[pid]?.full_name || "Unknown Player");

            const given = Object.entries(trade.adds || {})
              .filter(([, rid]) => rid !== myRosterId)
              .map(([pid]) => players[pid]?.full_name || "Unknown Player");

            const picksReceived = (trade.draft_picks || [])
              .filter((p) => p.owner_id === myRosterId)
              .map(pickLabel);

            const picksGiven = (trade.draft_picks || [])
              .filter((p) => p.previous_owner_id === myRosterId)
              .map(pickLabel);

            const allReceived = [...received, ...picksReceived];
            const allGiven = [...given, ...picksGiven];

            return (
              <div key={trade.transaction_id} className="bg-gray-800 rounded-xl p-4 mb-3">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
                    {trade.leagueName}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatRelativeDate(trade.created)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-green-400 font-semibold uppercase mb-1">Received</div>
                    {allReceived.length ? allReceived.map((item, idx) => (
                      <div key={`${item}-${idx}`} className="text-sm text-white py-0.5">{item}</div>
                    )) : (
                      <div className="text-xs text-gray-500 italic">Nothing</div>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] text-red-400 font-semibold uppercase mb-1">Gave</div>
                    {allGiven.length ? allGiven.map((item, idx) => (
                      <div key={`${item}-${idx}`} className="text-sm text-white py-0.5">{item}</div>
                    )) : (
                      <div className="text-xs text-gray-500 italic">Nothing</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        <button
          onClick={onClose}
          aria-label="Close trades modal"
          className="mt-2 w-full bg-blue-600 p-2 rounded text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
