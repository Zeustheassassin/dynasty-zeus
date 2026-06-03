"use client";
import type { SleeperPlayer } from "../../../lib/types";
import type { ExposureData } from "../../../hooks/useUserExposure";
import ErrorBanner from "../../../components/ErrorBanner";
import { useModalBehavior } from "../../../lib/hooks/useModalBehavior";

interface Props {
  selectedUserId: string;
  users: Record<string, string>;
  loadingShares: boolean;
  exposureError: string | null;
  externalShares: ExposureData | null;
  players: Record<string, SleeperPlayer>;
  myPlayerSet: Set<string>;
  onClose: () => void;
}

export function ExposureModal({ selectedUserId, users, loadingShares, exposureError, externalShares, players, myPlayerSet, onClose }: Props) {
  useModalBehavior(onClose);
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exposure-modal-title"
        tabIndex={-1}
        className="bg-gray-900 p-6 rounded w-96"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="exposure-modal-title" className="text-lg font-bold mb-4">
          {users[selectedUserId]}&apos;s Top Owned Players
        </div>

        {loadingShares ? (
          <div className="text-sm text-gray-400">Loading exposure...</div>
        ) : exposureError ? (
          <ErrorBanner message={exposureError} />
        ) : (
          externalShares?.players?.map((entry) => {
            const p = players[entry.playerId];
            if (!p) return null;
            const isMine = myPlayerSet.has(entry.playerId);
            return (
              <div
                key={entry.playerId}
                className={`flex items-center justify-between text-sm py-1 px-2 ${
                  isMine ? "bg-green-900/30 border border-green-700 rounded" : ""
                }`}
              >
                <div className="truncate">
                  {p.full_name}
                  {isMine && <span className="ml-2 text-green-400 text-xs">🔥</span>}
                </div>
                <div className="text-gray-400 text-xs whitespace-nowrap ml-2">
                  {entry.count} • {entry.percent}%
                </div>
              </div>
            );
          })
        )}

        <button
          onClick={onClose}
          aria-label="Close exposure modal"
          className="mt-4 w-full bg-blue-600 p-2 rounded"
        >
          Close
        </button>
      </div>
    </div>
  );
}
