"use client";
import { useEffect, useState } from "react";
import { cachedFetch } from "../../lib/clientFetch";
import { logger } from "../../lib/logger";
import { buildInjurySummary } from "../../lib/helpers/injurySummary";
import type { InjuryDetail } from "../../lib/helpers/espnInjuryDetail";
import type { SleeperPlayer } from "../../lib/types";

const log = logger("InjurySummaryPanel");
const DETAIL_TTL_MS = 30 * 60_000;

// The plain-English injury summary at the top of an expanded Injury Report
// row. Mounts only when the row is opened, so it's one small request per
// player looked at. Sleeper's own fields render immediately; ESPN's record
// (injury detail, projected return, news) replaces them when it arrives, and
// if ESPN has nothing or fails, the Sleeper version simply stays.
export default function InjurySummaryPanel({ player }: { player: SleeperPlayer }) {
  const params = new URLSearchParams({ name: player.full_name });
  if (player.team) params.set("team", player.team);
  if (player.position) params.set("pos", player.position);
  if (player.last_name) params.set("last", player.last_name);
  const url = `/api/injuries/detail?${params}`;

  const [result, setResult] = useState<{ url: string; detail: InjuryDetail | null } | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    cachedFetch<InjuryDetail>(url, { ttlMs: DETAIL_TTL_MS, timeoutMs: 10_000, retries: 2 })
      .then((detail) => { if (!cancelled) setResult({ url, detail }); })
      .catch((err) => {
        log.warn("ESPN injury detail unavailable — showing Sleeper's", { name: player.full_name, err: String(err) });
        if (!cancelled) setResult({ url, detail: null });
      });
    return () => { cancelled = true; };
  }, [url, player.full_name]);

  const loading = result?.url !== url;
  const summary = buildInjurySummary(player.full_name, player, loading ? null : result!.detail);

  return (
    <section aria-label={`Injury report for ${player.full_name}`} className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Injury report</span>
        <span className="text-[10px] text-slate-500">
          {loading
            ? "Checking ESPN…"
            : summary.source === "ESPN"
            ? `ESPN${summary.reportedOn ? ` · updated ${summary.reportedOn}` : ""}`
            : "Sleeper · no ESPN report found"}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-200">{summary.headline}</p>
      {summary.returnLine && <p className="mt-0.5 text-xs font-medium text-amber-300">{summary.returnLine}</p>}
      {summary.latestNews && <p className="mt-2 text-xs text-slate-400">&ldquo;{summary.latestNews}&rdquo;</p>}
      {summary.moreNews && (
        <>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="mt-1 text-[11px] font-medium text-blue-400 hover:text-blue-300"
          >
            {showMore ? "Less" : "More"}
          </button>
          {showMore && <p className="mt-1 text-xs leading-relaxed text-slate-400">{summary.moreNews}</p>}
        </>
      )}
    </section>
  );
}
