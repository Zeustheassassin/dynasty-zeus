"use client";
import { ROOKIE_YEAR } from "../../../hooks/useRookieBoardState";
import type { DraftScoutLeague } from "../../../hooks/useDraftScout";
import { useModalBehavior } from "../../../lib/hooks/useModalBehavior";

export type DraftScoutPatterns = {
  n: number;
  total: number;
  tendencies: string[];
  sortedPos: [string, number][];
  roundBreakdown: Record<string, Record<string, number>>;
};

interface Props {
  draftScoutUserId: string;
  users: Record<string, string>;
  loadingDraftScout: boolean;
  draftScoutData: DraftScoutLeague[] | null;
  draftScoutPatterns: DraftScoutPatterns | null;
  onClose: () => void;
}

const posColor = (pos: string) =>
  pos === "WR" ? "text-sky-300 bg-sky-900/40" :
  pos === "RB" ? "text-green-300 bg-green-900/40" :
  pos === "QB" ? "text-red-300 bg-red-900/40" :
  pos === "TE" ? "text-yellow-300 bg-yellow-900/40" :
  "text-gray-300 bg-gray-700/40";

const posText = (pos: string) =>
  pos === "WR" ? "text-sky-300" :
  pos === "RB" ? "text-green-300" :
  pos === "QB" ? "text-red-300" :
  pos === "TE" ? "text-yellow-300" :
  "text-gray-400";

export function DraftScoutModal({ draftScoutUserId, users, loadingDraftScout, draftScoutData, draftScoutPatterns, onClose }: Props) {
  useModalBehavior(onClose);
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-scout-modal-title"
        tabIndex={-1}
        className="bg-gray-900 p-6 rounded-xl w-[560px] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="draft-scout-modal-title" className="text-lg font-bold mb-1">
          {users[draftScoutUserId]}&apos;s {ROOKIE_YEAR} Rookie Drafts
        </div>
        <div className="text-xs text-gray-500 mb-4">
          All leagues — patterns based on completed/in-progress picks
        </div>

        {loadingDraftScout ? (
          <div className="text-sm text-gray-400">Loading draft history...</div>
        ) : !draftScoutData?.length ? (
          <div className="text-sm text-gray-400">No {ROOKIE_YEAR} drafts started yet.</div>
        ) : (
          <>
            {draftScoutPatterns && (
              <div className="bg-gray-800/70 rounded-lg p-4 mb-5 border border-gray-700">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Draft Tendencies — {draftScoutPatterns.n} league{draftScoutPatterns.n !== 1 ? "s" : ""} · {draftScoutPatterns.total} picks
                </div>

                {draftScoutPatterns.tendencies.length > 0 && (
                  <ul className="mb-4 space-y-1">
                    {draftScoutPatterns.tendencies.map((t, i) => (
                      <li key={t || i} className="flex items-start gap-1.5 text-xs text-gray-200">
                        <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mb-3">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Overall Position Mix</div>
                  <div className="flex flex-wrap gap-1.5">
                    {draftScoutPatterns.sortedPos.map(([pos, count]) => (
                      <span key={pos} className={`text-[11px] px-2 py-0.5 rounded font-semibold ${posColor(pos)}`}>
                        {pos} {count} ({Math.round(count / draftScoutPatterns.total * 100)}%)
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Round-by-Round</div>
                  <div className="space-y-1.5">
                    {Object.entries(draftScoutPatterns.roundBreakdown)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([round, counts]) => (
                        <div key={round} className="flex items-center gap-2">
                          <span className={`text-[10px] w-10 text-center px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                            round === "1" ? "bg-yellow-900/50 text-yellow-300" :
                            round === "2" ? "bg-green-900/50 text-green-300" :
                            round === "3" ? "bg-blue-900/50 text-blue-300" :
                                            "bg-orange-900/50 text-orange-300"
                          }`}>Rd {round}</span>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(counts)
                              .sort(([, a], [, b]) => (b as number) - (a as number))
                              .map(([pos, cnt]) => (
                                <span key={pos} className={`text-[10px] px-1.5 py-0.5 rounded ${posColor(pos)}`}>
                                  {pos} ×{cnt as number}
                                </span>
                              ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {draftScoutData.map((league) => (
              <div key={league.leagueName} className="mb-5">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  {league.leagueName}
                </div>
                {league.picks.length === 0 ? (
                  <div className="text-xs text-gray-500 italic">No picks made yet</div>
                ) : (
                  league.picks.map((pick) => {
                    const name = pick.player?.full_name || pick.playerName || "Unknown";
                    const pos = pick.player?.position || pick.position || "—";
                    return (
                      <div
                        key={pick.slot ?? `${pick.round}-${name}`}
                        className="flex items-center justify-between bg-gray-800 rounded px-3 py-1.5 mb-1 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                            pick.round === 1 ? "bg-yellow-900/50 text-yellow-300" :
                            pick.round === 2 ? "bg-green-900/50 text-green-300" :
                            pick.round === 3 ? "bg-blue-900/50 text-blue-300" :
                                              "bg-orange-900/50 text-orange-300"
                          }`}>
                            {pick.slot}
                          </span>
                          <span className="font-medium">{name}</span>
                        </div>
                        <span className={`text-xs font-semibold ${posText(pos)}`}>{pos}</span>
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </>
        )}

        <button
          onClick={onClose}
          aria-label="Close draft scout modal"
          className="mt-2 w-full bg-blue-600 p-2 rounded text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
