import { displayConference, isRedConference } from "../../lib/scouting/schoolConferences";
import { PFF_GRADE } from "../../lib/scouting/readyToChart";
import type { CompositePos } from "../../lib/scouting/aeComposite";

/**
 * A Prospects-list row's conference, after the school. Big Ten, Big 12,
 * Independents and FCS are red (isRedConference). Shown from sm up only (with
 * the school); phones are too tight for it. Renders nothing when neither the
 * prospect nor his school gives one.
 */
export function ProspectConference({ conference, school }: { conference?: string | null; school?: string | null }) {
  const conf = displayConference({ conference, school });
  if (!conf) return null;
  return (
    <span className={`text-xs whitespace-nowrap flex-shrink-0 hidden sm:block ${isRedConference(conf) ? "text-red-400 font-medium" : "text-slate-500"}`}>
      {conf}
    </span>
  );
}

/**
 * A Prospects-list row's games: "6/8G" = 6 charted of 8 logged. The charted
 * part shows from sm up only (phones keep the plain "8G") and is amber while
 * some logged games have no plays yet (the Unwatched tab lists them).
 * `charted` null = unknown (the play counts didn't load): logged only.
 * `className` is the list's own color for the games count.
 */
export function ChartedGamesCount({ logged, charted, className = "" }: { logged: number; charted: number | null; className?: string }) {
  if (logged <= 0) return null;
  const c = charted == null ? null : Math.min(charted, logged);
  const title = c == null
    ? `${logged} logged game${logged === 1 ? "" : "s"}`
    : `${c} of ${logged} logged game${logged === 1 ? "" : "s"} charted${c < logged ? ` (${logged - c} unwatched)` : ""}`;
  return (
    <span className={`text-xs whitespace-nowrap ${className}`} title={title}>
      {c != null && <span className={`hidden sm:inline ${c < logged ? "text-amber-400" : ""}`}>{c}/</span>}
      {logged}G
    </span>
  );
}

/**
 * A ready prospect's PFF grade (lib/scouting/readyToChart.ts: unranked, games
 * logged, none charted), where a ranked prospect's "#12" goes. The Rank sort
 * orders the ready prospects by it. `ready` null / absent = not ready: renders
 * nothing, as it does before a grade is imported.
 */
export function ReadyPffGrade({ id, position, ready }: {
  id: string; position: string; ready: ReadonlyMap<string, number | null> | null;
}) {
  const grade = ready?.get(id);
  const g = PFF_GRADE[position as CompositePos];
  if (grade == null || !g) return null;
  return (
    <span
      className="text-xs text-sky-400 whitespace-nowrap"
      title={`${g.label} over his logged games (none charted yet). Unranked prospects with no charted games sort by it, after the ranked ones.`}
    >
      PFF {grade.toFixed(1)}
    </span>
  );
}
