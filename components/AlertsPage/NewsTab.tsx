"use client";
import type { NewsItem } from "./alertsPageHelpers";
import { relTime } from "./alertsPageHelpers";

type NewsTabProps = {
  newsItems: NewsItem[];
  loadingNews: boolean;
};

export default function NewsTab({ newsItems, loadingNews }: NewsTabProps) {
  return (
    <div>
      {loadingNews ? (
        <p className="text-sm text-blue-400 py-4">Loading NFL news…</p>
      ) : newsItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          No news articles available right now. Check back soon.
        </div>
      ) : (
        <div className="space-y-3">
          {newsItems.map((item) => {
            const pub = item.published ? new Date(item.published) : null;
            const timeAgo = pub ? relTime(pub.getTime()) : null;
            return (
              <div
                key={item.id}
                className={`rounded-2xl border p-4 ${item.playerNames && item.playerNames.length > 0 ? "border-blue-800/50 bg-blue-950/10" : "border-slate-800 bg-slate-900/40"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {item.playerNames && item.playerNames.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {item.playerNames.map((name: string) => (
                          <span key={name} className="text-[10px] font-semibold bg-blue-900/50 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-lg">
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-sm font-semibold text-white leading-snug">{item.title}</div>
                    {item.summary && (
                      <div className="mt-1 text-xs text-slate-400 line-clamp-2">{item.summary}</div>
                    )}
                  </div>
                  {timeAgo && (
                    <span className="text-[11px] text-slate-500 shrink-0">{timeAgo}</span>
                  )}
                </div>
                {item.link && (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs text-blue-400 hover:text-blue-300 transition"
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
