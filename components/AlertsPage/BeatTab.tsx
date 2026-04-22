"use client";
import type { BeatItem } from "./alertsPageHelpers";
import { relTime } from "./alertsPageHelpers";

type BeatTabProps = {
  beatItems: BeatItem[];
  loadingBeat: boolean;
};

export default function BeatTab({ beatItems, loadingBeat }: BeatTabProps) {
  return (
    <div>
      {loadingBeat ? (
        <p className="text-sm text-blue-400 py-4">Loading beat writer reports…</p>
      ) : beatItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No beat writer reports available right now. Sources: Pro Football Talk, CBS Sports.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-[10px] text-slate-500 flex-wrap pb-1">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
              Pro Football Talk
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              CBS Sports
            </span>
            <span className="ml-auto italic">Owned players highlighted</span>
          </div>

          {beatItems.map((item) => {
            const pub = item.published ? new Date(item.published) : null;
            const timeAgo = pub && !isNaN(pub.getTime()) ? relTime(pub.getTime()) : null;
            const isPFT = item.source === "pft";
            const borderCls = item.impact
              ? "border-amber-700/50 bg-amber-950/10"
              : "border-slate-800 bg-slate-900/40";
            const sourceDot = isPFT ? "bg-orange-500" : "bg-blue-500";
            return (
              <div key={item.id} className={`rounded-2xl border p-4 ${borderCls}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-1.5 shrink-0 inline-block w-2 h-2 rounded-full ${sourceDot}`} title={item.sourceLabel} />
                  <div className="min-w-0 flex-1">
                    {item.playerNames && item.playerNames.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {item.playerNames.map((name: string) => (
                          <span key={name} className="text-[10px] font-semibold bg-amber-900/50 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded-lg">
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-sm font-semibold text-white leading-snug">{item.title}</div>
                    {item.summary && (
                      <div className="mt-1 text-xs text-slate-400 line-clamp-3">{item.summary}</div>
                    )}
                    <div className="mt-2 flex items-center gap-3 flex-wrap">
                      {item.author && (
                        <span className="text-[10px] font-semibold text-slate-400">{item.author}</span>
                      )}
                      <span className="text-[10px] text-slate-600">{item.sourceLabel}</span>
                      {timeAgo && (
                        <span className="text-[10px] text-slate-600 ml-auto">{timeAgo}</span>
                      )}
                    </div>
                  </div>
                </div>
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 ml-5 inline-block text-xs text-blue-400 hover:text-blue-300 transition"
                  >
                    Read full article →
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
