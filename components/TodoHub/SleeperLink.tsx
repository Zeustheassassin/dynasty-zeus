"use client";
import { sleeperLeagueUrl } from "../../lib/helpers/actionQueue";

/** "Open in Sleeper" — every To-Do move ends in Sleeper (its public API is read-only). */
export default function SleeperLink({ leagueId, compact = false }: { leagueId: string; compact?: boolean }) {
  return (
    <a
      href={sleeperLeagueUrl(leagueId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {compact ? "Sleeper" : "Open in Sleeper"}
      <span aria-hidden="true">↗</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
