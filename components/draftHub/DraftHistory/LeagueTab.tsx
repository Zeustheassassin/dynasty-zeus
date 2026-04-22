"use client";
import type { HistoryDraftEntry } from "../shared";
import type { SleeperUser } from "../../../lib/types";
import { posColor, closestPickEquiv, pickEquivColor, valueGrade } from "../shared";

interface LeagueTabProps {
  currentLeagueDraft: HistoryDraftEntry | null;
  user: SleeperUser | null;
  selectedHistoryYear: string;
  selectedLeagueName: string | undefined;
  pickFcValues: Record<string, number>;
}

export default function LeagueTab({
  currentLeagueDraft,
  user,
  selectedHistoryYear,
  selectedLeagueName,
  pickFcValues,
}: LeagueTabProps) {
  return (
    <div>
      {currentLeagueDraft ? (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">{currentLeagueDraft.season} Rookie Draft</div>
              <div className="text-base font-semibold text-white mt-0.5">{currentLeagueDraft.leagueName}</div>
            </div>
            <div className="flex items-center gap-4 text-right">
              <span className="text-[10px] text-blue-400 font-semibold">■ Your pick</span>
              <span className="text-xs text-gray-500">{currentLeagueDraft.picks.length} picks</span>
            </div>
          </div>
          <div className="divide-y divide-gray-800/40">
            {currentLeagueDraft.picks.map((pick) => {
              const { label, cls } = valueGrade(pick.value);
              const isMine = pick.pickedByUserId === user?.user_id;
              const { label: equivLabel, pickNo: equivPickNo } = closestPickEquiv(pick.value, pickFcValues);
              const equivColor = pickEquivColor(equivPickNo, pick.pickNo);
              return (
                <div key={pick.slot} className={`flex items-center gap-2 px-4 py-1.5 ${isMine ? "bg-blue-950/20" : ""}`}>
                  <span className="text-[11px] font-bold text-gray-500 w-8 shrink-0">{pick.slot}</span>
                  <span className={`text-[10px] font-bold w-6 shrink-0 ${posColor[pick.position] || "text-gray-400"}`}>{pick.position}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className={`text-sm font-medium truncate ${isMine ? "text-blue-200" : "text-white"}`}>{pick.name}</span>
                    {pick.team && <span className="text-[10px] text-gray-500 shrink-0">{pick.team}</span>}
                    {isMine && <span className="text-[9px] font-bold text-blue-400 shrink-0 border border-blue-800 px-1 rounded">YOUR PICK</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-semibold ${isMine ? "text-blue-200" : "text-white"}`}>
                      {pick.value > 0 ? pick.value.toLocaleString() : "—"}
                    </span>
                    <span className={`text-[9px] font-semibold border px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
                    {equivLabel !== "—" && (
                      <span className={`text-[9px] font-semibold ${equivColor}`}>≈{equivLabel}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/40 p-6 text-sm text-gray-400">
          No completed rookie draft found for <span className="text-white">{selectedLeagueName}</span> in {selectedHistoryYear}.
        </div>
      )}
    </div>
  );
}
