"use client";
// Scouting → Chart Next: who to chart next against the goal (OVR top 60 at a
// full sample, 61–150 at half), in four lists (lib/scouting/chartNext.ts). The
// header shows progress and the weeks left at the user's pace in sample plays
// (chartNextPace.ts). Slow-tape conferences (Big Ten, Big 12, Independents,
// FCS) are hidden until the Conference filter shows them: the user charts the
// "good" Catapult tape first (2026-11-26). A name opens his board; his tape in
// hand opens the newest unwatched game on Chart Game.

import { useEffect, useMemo, useState } from "react";
import type { Prospect, ProspectWithStats, ScoutingGame } from "../../lib/types";
import type { PffTotals } from "../../lib/pff/totals";
import type { SamplePlays } from "../../lib/scouting/aggregateMerge";
import type { GameSnapCount } from "../../lib/scouting/unwatchedGames";
import { POS_COLOR } from "../../lib/uiTheme";
import { SAMPLE_TIERS } from "../../lib/scouting/sampleTiers";
import { PFF_GRADE } from "../../lib/scouting/readyToChart";
import {
  CHART_NEXT_POSITIONS,
  GOAL_FULL_THROUGH,
  GOAL_HALF_THROUGH,
  PACE_DAYS,
  buildChartNext,
  chartNextDefaultClass,
  pacePerWeek,
  weeksAtPace,
  weeksToGoal,
  type ChartNextPos,
  type ChartNextRow,
  type GoalBand,
  type PaceCounts,
} from "../../lib/scouting/chartNext";
import { fetchChartingPace } from "./chartNextPace";

/** What each position's sample counts. */
const UNIT: Record<ChartNextPos, string> = { QB: "throws", RB: "runs", WR: "routes", TE: "routes" };

const SLOW_LABEL = "Big Ten, Big 12, Independents, FCS";
const GOOD = "__good";
const ALL = "__all";
const SLOW = "__slow";
const NO_CONF = "__none";

type PaceState = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; counts: PaceCounts };

interface Props {
  prospects: ProspectWithStats[];
  games: ScoutingGame[];
  /** prospect_game_snap_stats; null when it didn't load (tape in hand unknown). */
  snapCounts: GameSnapCount[] | null;
  samplePlays: ReadonlyMap<string, SamplePlays>;
  pffTotals: ReadonlyMap<string, PffTotals>;
  routeCounts: readonly { game_id: string; routes: number }[];
  /** Every class on the board, ascending. */
  years: number[];
  loading: boolean;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
  onOpenProspect: (p: Prospect) => void;
  onOpenGame: (p: Prospect, gameId: string) => void;
  /** The pace read; tests pass their own. */
  loadPace?: () => Promise<PaceCounts | null>;
  /** The Catapult call is made for this class (Due now): show the slow-tape conferences by default. */
  slowTapeShown?: (year: number) => boolean;
}

const chip = (on: boolean) =>
  `px-3 py-1 rounded text-xs font-medium transition ${on ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`;

const fmt = (n: number) => Math.round(n).toLocaleString();
const weeksText = (w: number | null) => (w == null ? "—" : w === 0 ? "done" : `~${w < 10 ? w.toFixed(1) : Math.round(w)} wk`);

export default function ChartNextTab({
  prospects, games, snapCounts, samplePlays, pffTotals, routeCounts, years, loading,
  draftYearFilter, setDraftYearFilter, onOpenProspect, onOpenGame, loadPace = fetchChartingPace, slowTapeShown,
}: Props) {
  const [position, setPosition] = useState<ChartNextPos | null>(null);
  // Null until picked: good tape only, or every conference once the Catapult
  // call is made for the class.
  const [confPick, setConfPick] = useState<string | null>(null);
  const [pace, setPace] = useState<PaceState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void loadPace().then(
      (counts) => { if (!cancelled) setPace(counts ? { kind: "ok", counts } : { kind: "failed" }); },
      () => { if (!cancelled) setPace({ kind: "failed" }); },
    );
    return () => { cancelled = true; };
  }, [loadPace]);

  const year = draftYearFilter != null && years.includes(draftYearFilter) ? draftYearFilter : chartNextDefaultClass(years);
  const catapultMade = year != null && (slowTapeShown?.(year) ?? false);
  const conf = confPick ?? (catapultMade ? ALL : GOOD);

  const board = useMemo(
    () => (year == null ? null : buildChartNext(year, { prospects, games, snapCounts, samplePlays, pffTotals, routeCounts })),
    [year, prospects, games, snapCounts, samplePlays, pffTotals, routeCounts],
  );

  const conferences = useMemo(() => {
    if (!board) return [];
    const all = [...board.top, ...board.half, ...board.firstLooks, ...board.rechart];
    return [...new Set(all.map((r) => r.conference ?? NO_CONF))].sort((a, b) =>
      a === NO_CONF ? 1 : b === NO_CONF ? -1 : a.localeCompare(b));
  }, [board]);

  const confOk = (r: ChartNextRow) =>
    conf === ALL ? true
      : conf === GOOD ? !r.slowTape
        : conf === SLOW ? r.slowTape
          : (r.conference ?? NO_CONF) === conf;
  const keep = (r: ChartNextRow) => (position == null || r.pos === position) && confOk(r);

  if (loading && prospects.length === 0) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!board || year == null) return <p className="text-sm text-slate-500">No prospects on the board yet.</p>;

  const perWeek = pace.kind === "ok" ? pacePerWeek(pace.counts) : null;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <GoalHeader year={year} full={board.goals.full} half={board.goals.half} pace={pace} perWeek={perWeek} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Class:</span>
          {years.map((y) => (
            <button key={y} onClick={() => setDraftYearFilter(y)} aria-pressed={year === y} className={chip(year === y)}>{y}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Pos:</span>
          <button onClick={() => setPosition(null)} aria-pressed={position == null} className={chip(position == null)}>All</button>
          {CHART_NEXT_POSITIONS.map((pos) => (
            <button key={pos} onClick={() => setPosition(pos)} aria-pressed={position === pos} className={chip(position === pos)}>{pos}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          Conference:
          <select
            value={conf}
            onChange={(e) => setConfPick(e.target.value)}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
          >
            <option value={GOOD}>Good tape (hides {SLOW_LABEL})</option>
            <option value={ALL}>All conferences</option>
            <option value={SLOW}>Slow tape only ({SLOW_LABEL})</option>
            {conferences.map((c) => <option key={c} value={c}>{c === NO_CONF ? "No conference" : c}</option>)}
          </select>
        </label>
      </div>

      {catapultMade && confPick == null && (
        <p className="text-xs text-slate-500">
          Every conference shows: the Catapult call for {year} is made (Analysis → Grading checks → Due now).
        </p>
      )}

      {!board.chartedKnown && (
        <div className="rounded border border-red-800 bg-red-900/30 px-3 py-2 text-xs text-red-300">
          Couldn&apos;t load the play counts per game, so tape in hand and first looks are unknown. Reload the page to try again.
        </div>
      )}

      <ListSection
        title={`Finish the top ${GOAL_FULL_THROUGH}`}
        blurb={`OVR 1–${GOAL_FULL_THROUGH} still short of a full sample, in OVR order.`}
        rows={board.top} keep={keep} kind="full" known={board.chartedKnown}
        empty={board.goals.full.ranked > 0 ? `Every ranked prospect in the top ${GOAL_FULL_THROUGH} has a full sample.` : "No one is ranked in the top 60 yet."}
        onOpenProspect={onOpenProspect} onOpenGame={onOpenGame}
      />
      <ListSection
        title={`${GOAL_FULL_THROUGH + 1}–${GOAL_HALF_THROUGH} to half`}
        blurb={`OVR ${GOAL_FULL_THROUGH + 1}–${GOAL_HALF_THROUGH} still short of half a sample, in OVR order.`}
        rows={board.half} keep={keep} kind="half" known={board.chartedKnown}
        empty={board.goals.half.ranked > 0 ? `Every ranked prospect in ${GOAL_FULL_THROUGH + 1}–${GOAL_HALF_THROUGH} has half a sample.` : `No one is ranked ${GOAL_FULL_THROUGH + 1}–${GOAL_HALF_THROUGH} yet.`}
        onOpenProspect={onOpenProspect} onOpenGame={onOpenGame}
      />
      <ListSection
        title="First looks"
        blurb={`No OVR rank, games logged, none charted yet: best PFF grade first (the Prospects lists' ready-to-chart order). To go = half a sample.${board.unrankedNoGames > 0 ? ` ${board.unrankedNoGames} more unranked in ${year} have no game logged.` : ""}`}
        rows={board.firstLooks} keep={keep} kind="first" known={board.chartedKnown}
        empty="No unranked prospect has logged games waiting for a first look."
        onOpenProspect={onOpenProspect} onOpenGame={onOpenGame}
      />
      <ListSection
        title="Re-chart imported"
        blurb={`Ranked WRs with routes from imported games (before May 1, 2026), still short of a full sample charted in the app, in OVR order. To go = routes in the app to a full sample. From half a sample in the app (80 routes) his board's Chart Game list can set the imported games aside ("switch open").${board.rechartFullInApp > 0 ? ` ${board.rechartFullInApp} more already have a full sample in the app.` : ""}`}
        rows={board.rechart} keep={keep} kind="rechart" known={board.chartedKnown}
        empty="No ranked WR leans on imported games."
        onOpenProspect={onOpenProspect} onOpenGame={onOpenGame}
      />
    </div>
  );
}

function GoalHeader({ year, full, half, pace, perWeek }: {
  year: number; full: GoalBand; half: GoalBand; pace: PaceState; perWeek: number | null;
}) {
  const goal = weeksToGoal(year);
  const both = full.toGo + half.toGo;
  const good = both - full.toGoSlow - half.toGoSlow;
  const unrankedSlots = Math.max(0, half.slots - half.ranked) + Math.max(0, full.slots - full.ranked);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-white">{year} goal</h2>
        {goal && (
          <span className="text-xs text-slate-400">
            Top {GOAL_FULL_THROUGH} done by mid-Feb to early March:{" "}
            <span className="text-slate-200 font-medium">{goal.from === goal.to ? goal.to : `${goal.from}–${goal.to}`} weeks</span> away
          </span>
        )}
      </div>
      <GoalLine
        label={`Top ${GOAL_FULL_THROUGH} at a full sample`} band={full}
        note={full.ranked < full.slots ? `${full.slots - full.ranked} of the top ${GOAL_FULL_THROUGH} slots unranked` : null}
      />
      <GoalLine
        label={`${GOAL_FULL_THROUGH + 1}–${GOAL_HALF_THROUGH} at half a sample`} band={half}
        note={half.ranked < half.slots ? `${half.slots - half.ranked} of ${half.slots} slots unranked (first looks fill them)` : null}
      />
      <p className="text-xs text-slate-400" aria-live="polite">
        {pace.kind === "loading" && "Pace: loading…"}
        {pace.kind === "failed" && "Pace: couldn't load the recent plays."}
        {pace.kind === "ok" && perWeek != null && (<>
          Pace <span className="font-semibold text-slate-200">{fmt(perWeek)}</span> sample plays a week
          <span className="text-slate-500"> (last {PACE_DAYS / 7} weeks, every class)</span>
          {" · "}top {GOAL_FULL_THROUGH}: <span className="font-semibold text-slate-200">{weeksText(weeksAtPace(full.toGo, perWeek))}</span>
          {" · "}both goals: <span className="font-semibold text-slate-200">{weeksText(weeksAtPace(both, perWeek))}</span>
          {" · "}both without slow tape: <span className="font-semibold text-slate-200">{weeksText(weeksAtPace(good, perWeek))}</span>
          {unrankedSlots > 0 && <span className="text-slate-500"> (ranked players only)</span>}
        </>)}
      </p>
    </div>
  );
}

function GoalLine({ label, band, note }: { label: string; band: GoalBand; note: string | null }) {
  const share = band.ranked > 0 ? band.done / band.ranked : 0;
  const byPos = CHART_NEXT_POSITIONS.filter((p) => band.byPos[p] > 0).map((p) => `${p} ${fmt(band.byPos[p])}`).join(" · ");
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
        <span className="font-medium text-slate-200 min-w-[11rem]">{label}</span>
        <span className="text-slate-300">
          <span className="font-semibold text-emerald-400">{band.done}</span> / {band.ranked} done
        </span>
        <span className="text-slate-300">
          <span className="font-semibold text-amber-300">{fmt(band.toGo)}</span> plays to go
        </span>
        {byPos && <span className="text-slate-500">{byPos}</span>}
        {band.toGoSlow > 0 && <span className="text-red-400/90">{fmt(band.toGoSlow)} slow tape</span>}
        {note && <span className="text-slate-500">{note}</span>}
      </div>
      <div
        className="h-1.5 rounded-full bg-slate-800 overflow-hidden"
        role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={band.ranked} aria-valuenow={band.done}
      >
        <div className="h-full bg-emerald-500" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  );
}

type ListKind = "full" | "half" | "first" | "rechart";

const TO_GO_HEAD: Record<ListKind, string> = { full: "To full", half: "To half", first: "To half", rechart: "To full in app" };

function ListSection({ title, blurb, rows, keep, kind, known, empty, onOpenProspect, onOpenGame }: {
  title: string; blurb: string; rows: ChartNextRow[]; keep: (r: ChartNextRow) => boolean; kind: ListKind;
  known: boolean; empty: string; onOpenProspect: (p: Prospect) => void; onOpenGame: (p: Prospect, gameId: string) => void;
}) {
  const shown = rows.filter(keep);
  const hidden = rows.length - shown.length;
  const toGo = shown.reduce((s, r) => s + r.toGo, 0);
  return (
    <section aria-label={title} className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="text-xs text-slate-400">
          {shown.length} {shown.length === 1 ? "prospect" : "prospects"}
          {kind !== "first" && shown.length > 0 && <> · {fmt(toGo)} plays to go</>}
          {hidden > 0 && <span className="text-slate-500"> · {hidden} hidden by the filters</span>}
        </span>
      </div>
      <p className="text-xs text-slate-500">{blurb}</p>
      {shown.length === 0 ? (
        <p className="text-xs text-slate-500 italic">{rows.length > 0 ? "None with these filters." : empty}</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-2 py-1.5 text-right font-medium">{kind === "first" ? "PFF" : "OVR"}</th>
                <th className="px-1 py-1.5 font-medium"><span className="sr-only">Sample</span></th>
                <th className="px-2 py-1.5 text-left font-medium">Name</th>
                <th className="px-2 py-1.5 text-left font-medium">School</th>
                <th className="px-2 py-1.5 text-right font-medium">{kind === "rechart" ? "In app" : "Sample"}</th>
                {kind === "rechart" && <th className="px-2 py-1.5 text-right font-medium">Imported</th>}
                <th className="px-2 py-1.5 text-right font-medium">{TO_GO_HEAD[kind]}</th>
                <th className="px-2 py-1.5 text-left font-medium">Tape in hand</th>
                <th className="px-2 py-1.5 text-right font-medium" title="About how many more games of charting the plays to go take">≈ Games</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {shown.map((r) => (
                <Row key={r.prospect.id} r={r} kind={kind} known={known} onOpenProspect={onOpenProspect} onOpenGame={onOpenGame} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ r, kind, known, onOpenProspect, onOpenGame }: {
  r: ChartNextRow; kind: ListKind; known: boolean;
  onOpenProspect: (p: Prospect) => void; onOpenGame: (p: Prospect, gameId: string) => void;
}) {
  const p = r.prospect;
  const tier = SAMPLE_TIERS.find((t) => t.tier === r.tier)!;
  const unit = UNIT[r.pos];
  const sampleTitle = `${r.n} of ${r.full} ${unit} for a full sample (${r.pct}%)`;
  return (
    <tr className="hover:bg-slate-900/60">
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
        {kind === "first"
          ? (r.pffGrade != null
            ? <span className="text-sky-400" title={`${PFF_GRADE[r.pos].label} over his logged games`}>{r.pffGrade.toFixed(1)}</span>
            : <span className="text-slate-600" title="No PFF grade on his logged games yet">—</span>)
          : p.overall_rank ?? "—"}
      </td>
      <td className="px-1 py-1.5 text-center">
        <span role="img" aria-label={`Sample: ${tier.label}`} title={sampleTitle} className={`inline-block w-2.5 h-2.5 rounded-full align-middle ${tier.dot}`} />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <button onClick={() => onOpenProspect(p)} className="font-medium text-white hover:text-blue-300 hover:underline" title="Open his board">
          {p.name}
        </button>
        <span className={`ml-1.5 font-semibold ${POS_COLOR[r.pos] ?? "text-slate-400"}`}>{r.pos}</span>
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-slate-400">
        {p.school}
        {r.conference && <span className={r.slowTape ? "text-red-400 font-medium" : "text-slate-500"}> · {r.conference}</span>}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-slate-300">
        {kind === "rechart" && r.imported
          ? <span title={`${r.imported.inApp} of ${r.full} routes charted in the app`}>{r.imported.inApp}<span className="text-slate-500"> / {r.full}</span></span>
          : <span title={sampleTitle}>{r.n}<span className="text-slate-500"> / {r.full}</span> <span className="text-slate-500">{r.pct}%</span></span>}
      </td>
      {kind === "rechart" && (
        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-slate-400" title="Routes from games imported before May 1, 2026">
          {r.imported ? <>{r.imported.routes} <span className="text-slate-500">in {r.imported.games} G</span></> : "—"}
          {r.imported && r.imported.setAside > 0 && (
            <span className="ml-1.5 text-amber-300" title="Imported games set aside: not in his sample">{r.imported.setAside} set aside</span>
          )}
          {r.imported && r.imported.setAside === 0 && r.imported.switchOpen && (
            <span className="ml-1.5 text-emerald-400" title="Half a sample in the app: his imported games can be set aside (Chart Game)">switch open</span>
          )}
        </td>
      )}
      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-amber-300" title={`${r.toGo} ${unit} to go`}>{r.toGo}</td>
      <td className="px-2 py-1.5 whitespace-nowrap"><TapeInHand r={r} known={known} onOpenGame={onOpenGame} /></td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap"><GamesNeeded r={r} known={known} /></td>
    </tr>
  );
}

function gameLabel(g: ScoutingGame): string {
  return `${g.season_year} ${g.opponent || "Unknown opponent"}`;
}

function TapeInHand({ r, known, onOpenGame }: { r: ChartNextRow; known: boolean; onOpenGame: (p: Prospect, gameId: string) => void }) {
  if (!known) return <span className="text-slate-600">—</span>;
  const n = r.unwatched.length;
  if (n === 0) {
    return (
      <span className="text-rose-400" title={r.logged > 0 ? "Every logged game has charted plays: log more of his games to keep going" : "No games logged"}>
        none
      </span>
    );
  }
  const newest = r.unwatched[0];
  return (
    <button
      onClick={() => onOpenGame(r.prospect, newest.id)}
      title={`Logged, not charted: ${r.unwatched.map(gameLabel).join(", ")}. Opens ${gameLabel(newest)} on Chart Game.`}
      className="group inline-flex items-baseline gap-1.5 rounded border border-amber-800/60 bg-amber-950/20 px-1.5 py-0.5 text-amber-200 transition hover:border-amber-500 hover:text-white"
    >
      {n} {n === 1 ? "game" : "games"}
      <span className="rounded bg-blue-600/80 px-1 text-[10px] font-semibold text-white group-hover:bg-blue-500">Chart →</span>
    </button>
  );
}

function GamesNeeded({ r, known }: { r: ChartNextRow; known: boolean }) {
  if (r.gamesNeeded == null || r.perGame == null) return <span className="text-slate-600">—</span>;
  const own = r.charted != null && r.charted > 0 && r.n > 0;
  const rate = `${r.perGame.toFixed(0)} ${UNIT[r.pos]} a game (${own ? "his charted games" : `the ${r.pos} average`})`;
  const short = known ? Math.max(0, r.gamesNeeded - r.unwatched.length) : 0;
  return (
    <span title={`About ${r.gamesNeeded} more ${r.gamesNeeded === 1 ? "game" : "games"} at ${rate}`}>
      <span className="tabular-nums text-slate-300">≈{r.gamesNeeded}</span>
      {short > 0 && (
        <span className="ml-1.5 text-[11px] text-rose-400" title={`Tape in hand covers ${r.unwatched.length}: about ${short} more ${short === 1 ? "game" : "games"} to find and log`}>
          find {short}
        </span>
      )}
    </span>
  );
}
