"use client";
import type { BeatItem } from "./alertsPageHelpers";
import { relTime } from "./alertsPageHelpers";

type WireTabProps = {
  wireItems: BeatItem[];
  loadingWire: boolean;
};

export default function WireTab({ wireItems, loadingWire }: WireTabProps) {
  return (
    <div>
      <p className="text-[11px] text-slate-500 mb-3">
        Real NFL moves — cuts, signings, IR designations, extensions, and suspensions — filtered from beat writer feeds.
      </p>
      {loadingWire ? (
        <p className="text-sm text-blue-400 py-4">Loading transaction wire…</p>
      ) : wireItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No transactions detected right now. Check back during the season when roster moves are frequent.
        </div>
      ) : (
        <div className="space-y-2">
          {wireItems.map((item) => {
            const pub = item.published ? new Date(item.published) : null;
            const timeAgo = pub && !isNaN(pub.getTime()) ? relTime(pub.getTime()) : null;
            const isPFT = item.source === "pft";
            return (
              <div key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3.5">
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${isPFT ? "bg-orange-500" : "bg-blue-500"}`}
                    title={item.sourceLabel}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white leading-snug">{item.title}</div>
                    {item.summary && (
                      <div className="mt-0.5 text-xs text-slate-400 line-clamp-2">{item.summary}</div>
                    )}
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                      {item.author && (
                        <span className="text-[10px] font-semibold text-slate-400">{item.author}</span>
                      )}
                      <span className="text-[10px] text-slate-600">{item.sourceLabel}</span>
                      {timeAgo && <span className="text-[10px] text-slate-600 ml-auto">{timeAgo}</span>}
                    </div>
                  </div>
                </div>
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 ml-[18px] inline-block text-xs text-blue-400 hover:text-blue-300 transition"
                  >
                    Full story →
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
