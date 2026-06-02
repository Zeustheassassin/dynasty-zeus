"use client";
// ── PickValuesTab ─────────────────────────────────────────────────────────────
// Displays a grid of rookie draft pick values for the current season.
// Highlights any picks owned by the current user.
import type { SleeperDraft, AugmentedPick } from "../../lib/types";
import { BASE_YEAR } from "../../lib/helpers";
// Rookie-draft class year tracks the CALENDAR (upcoming class), not the NFL season.
const ROOKIE_YEAR = String(BASE_YEAR);
const ROUNDS = Array.from({ length: 6 }, (_, i) => i + 1);

interface PickValuesTabProps {
  pickFcValues: Record<string, number>;
  allPicks: AugmentedPick[];
  draftSettings: SleeperDraft | null;
  numSlots: number;
  myRosterId: number | undefined;
}

export default function PickValuesTab({
  pickFcValues,
  allPicks,
  draftSettings,
  numSlots,
  myRosterId,
}: PickValuesTabProps) {
  const roundCount = Number(
    draftSettings?.settings?.rounds ?? draftSettings?.rounds ?? 4
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">{ROOKIE_YEAR} Rookie Draft Pick Values</h2>
        <p className="text-sm text-gray-400 mt-1">
          Dynasty superflex values from FantasyCalc.
          {allPicks.length > 0 && " Your picks are highlighted in blue."}
        </p>
      </div>

      {Object.keys(pickFcValues).length === 0 ? (
        <div className="text-gray-400 text-sm">Pick values are loading…</div>
      ) : (
        ROUNDS.slice(0, roundCount).map((round) => {
          const slots = numSlots || 12;
          return (
            <div key={round} className="mb-6">
              <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Round {round}</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {Array.from({ length: slots }, (_, i) => {
                  const slot = i + 1;
                  const slotStr = `${round}.${String(slot).padStart(2, "0")}`;
                  const value =
                    pickFcValues[`${ROOKIE_YEAR}-${slotStr}`] ??
                    pickFcValues[`${ROOKIE_YEAR}-${round}`] ??
                    0;
                  const overallPick = (round - 1) * slots + slot;
                  const isMyPick = allPicks.some(
                    (p) => p.slot === slotStr && String(p.owner_id) === String(myRosterId)
                  );
                  return (
                    <div
                      key={slotStr}
                      className={`rounded-xl border px-3 py-2.5 ${
                        isMyPick
                          ? "border-blue-600 bg-blue-950/30"
                          : "border-gray-700 bg-gray-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className={`text-xs font-bold ${isMyPick ? "text-blue-300" : "text-gray-300"}`}>
                          {slotStr}
                        </span>
                        {isMyPick && <span className="text-[9px] text-blue-400 font-bold">YOURS</span>}
                      </div>
                      <div className="text-[10px] text-gray-600 mb-1">Pick {overallPick}</div>
                      <div
                        className={`text-sm font-semibold ${
                          value > 6000
                            ? "text-emerald-400"
                            : value > 4000
                            ? "text-green-400"
                            : value > 2000
                            ? "text-yellow-400"
                            : value > 500
                            ? "text-orange-400"
                            : "text-gray-500"
                        }`}
                      >
                        {value > 0 ? value.toLocaleString() : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
