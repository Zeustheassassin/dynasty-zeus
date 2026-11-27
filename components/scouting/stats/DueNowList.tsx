"use client";
// Analysis → Grading checks → Due now (lib/scouting/dueNow.ts): every re-check
// that comes due on a date or once the data is there. Due and coming-up checks
// show in full; waiting checks show their progress; later and done ones fold
// away. Done marks save to scouting_due_marks (migration 106).

import { useState } from "react";
import { sortDue, type DueItem, type DueState } from "../../../lib/scouting/dueNow";

export type DueMarksState = "loading" | "ok" | "missing" | "failed";

interface Props {
  items: readonly DueItem[];
  /** The data checks are in (the plays have loaded). */
  dataReady: boolean;
  marksState: DueMarksState;
  /** Saves a done mark (value = a choice, or null); resolves to an error message, or null. */
  onMark: (key: string, cycle: string, value: string | null) => Promise<string | null>;
  /** Removes a done mark; resolves to an error message, or null. */
  onUnmark: (key: string, cycle: string) => Promise<string | null>;
}

/** Re-checks HANDOFF §23 names with no trigger the app can read: shown so they stay on the list. */
const NO_TRIGGER: readonly string[] = [
  "RB / WR blocking field time: re-check who it moves once more RB pass blocks and WR games are charted.",
  "TE route × coverage table: refit from WR's once WR charting has grown a lot.",
  "Game context: re-read the tests below as charting grows (OPPONENT_SP, WEATHER_ON), including PFF CC%'s own weather test.",
  "Sub-route × coverage and × slot / outside: eventually, after the sub-routes themselves.",
  "RB route tree and catch difficulty: graded once there's enough (months; a few hundred tagged targets).",
];

const STATE_STYLE: Record<DueState, string> = {
  due: "border-amber-600/70 bg-amber-950/20",
  soon: "border-sky-800/70 bg-slate-900/40",
  waiting: "border-slate-800 bg-slate-900/30",
  later: "border-slate-800 bg-slate-900/30",
  watch: "border-slate-800 bg-slate-900/30",
  done: "border-slate-800 bg-slate-900/30",
};

const btn = "rounded px-2 py-0.5 text-[11px] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";

function doneText(i: DueItem): string {
  if (!i.done) return "";
  const d = new Date(i.done.doneAt);
  const when = Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const choice = i.choices?.find((c) => c.value === i.done?.value)?.label;
  return [when && `done ${when}`, choice].filter(Boolean).join(" · ");
}

export default function DueNowList({ items, dataReady, marksState, onMark, onUnmark }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const sorted = sortDue(items);
  const by = (s: DueState) => sorted.filter((i) => i.state === s);
  const due = by("due"), soon = by("soon"), waiting = by("waiting"), later = by("later"), watch = by("watch"), done = by("done");
  const canMark = marksState === "ok";

  async function run(i: DueItem, act: () => Promise<string | null>) {
    const id = `${i.key}|${i.cycle}`;
    setPending(id);
    const err = await act();
    setPending(null);
    setErrors((prev) => {
      const next = new Map(prev);
      if (err) next.set(id, err); else next.delete(id);
      return next;
    });
  }

  const actions = (i: DueItem) => {
    const id = `${i.key}|${i.cycle}`;
    const busy = pending === id;
    const off = !canMark || busy;
    const why = marksState === "missing" ? "Needs migration 106" : marksState === "loading" ? "Loading your marks…" : marksState === "failed" ? "Your marks didn't load" : undefined;
    if (i.state === "done") {
      return i.mark ? (
        <button onClick={() => run(i, () => onUnmark(i.key, i.cycle))} disabled={off} title={why}
          className={`${btn} bg-slate-800 text-slate-300 hover:bg-slate-700`}>
          Undo
        </button>
      ) : null;
    }
    if (i.mark === "choice") {
      return (i.choices ?? []).map((c) => (
        <button key={c.value} onClick={() => run(i, () => onMark(i.key, i.cycle, c.value))} disabled={off} title={why}
          className={`${btn} bg-blue-600/80 text-white hover:bg-blue-500`}>
          {c.label}
        </button>
      ));
    }
    if (i.mark === "done") {
      return (
        <button onClick={() => run(i, () => onMark(i.key, i.cycle, null))} disabled={off} title={why}
          className={`${btn} bg-blue-600/80 text-white hover:bg-blue-500`}>
          Mark done
        </button>
      );
    }
    return null;
  };

  const card = (i: DueItem) => {
    const id = `${i.key}|${i.cycle}`;
    const err = errors.get(id);
    return (
      <li key={id} className={`rounded border px-3 py-2 ${STATE_STYLE[i.state]}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold text-slate-100">{i.title}</span>
          <span className={`text-[11px] ${i.state === "due" ? "text-amber-300" : "text-slate-400"}`}>{i.when}</span>
          {i.state === "done" && <span className="text-[11px] text-emerald-400">{doneText(i)}</span>}
          <span className="ml-auto flex flex-wrap gap-1.5">{actions(i)}</span>
        </div>
        <p className="mt-0.5 text-slate-400">{i.detail}</p>
        {i.progress && <Progress p={i.progress} />}
        {i.note && <p className="mt-0.5 text-slate-500">{i.note}</p>}
        {err && <p className="mt-0.5 text-red-400" role="alert">{err}</p>}
      </li>
    );
  };

  return (
    <section className="mb-6" aria-label="Due now">
      <h3 className="text-sm font-semibold text-slate-200 mb-1">Due now</h3>
      <p className="text-xs text-slate-500 mb-2 max-w-3xl">
        Every re-check that comes due on a date (the scouting plan&apos;s checkpoints for the class being scouted) or once the
        data is there (HANDOFF §23). Due ones stay until marked done; data checks clear on their own when switched on.
        {" "}<span className="text-slate-400">
          {due.length} due · {soon.length} coming up · {waiting.length} waiting on data
        </span>
      </p>
      {marksState === "missing" && (
        <p className="mb-2 rounded border border-amber-800 bg-amber-950/30 px-3 py-1.5 text-amber-300">
          Mark done needs migration 106 (scouting_due_marks). Until it&apos;s applied, nothing can be marked and Chart Next keeps the slow-tape conferences hidden.
        </p>
      )}
      {marksState === "failed" && (
        <p className="mb-2 rounded border border-red-800 bg-red-900/30 px-3 py-1.5 text-red-300">
          Your done marks didn&apos;t load, so marked checks may show as due. Reload the page to try again.
        </p>
      )}
      {!dataReady && <p className="mb-2 text-slate-500">Loading the plays for the data checks…</p>}

      {due.length + soon.length > 0 && <ul className="space-y-1.5 mb-2">{[...due, ...soon].map(card)}</ul>}
      {due.length + soon.length === 0 && <p className="mb-2 text-slate-500">Nothing due or coming up in the next 30 days.</p>}

      {waiting.length > 0 && (
        <div className="mb-2">
          <h4 className="mb-1 font-medium text-slate-300">Waiting on data</h4>
          <ul className="space-y-1.5">{waiting.map(card)}</ul>
        </div>
      )}
      {watch.length > 0 && <ul className="space-y-1.5 mb-2">{watch.map(card)}</ul>}

      {later.length > 0 && (
        <details className="mb-2">
          <summary className="cursor-pointer text-slate-300">Later ({later.length})</summary>
          <ul className="mt-1.5 space-y-1.5">{later.map(card)}</ul>
        </details>
      )}
      {done.length > 0 && (
        <details className="mb-2">
          <summary className="cursor-pointer text-slate-300">Done ({done.length})</summary>
          <ul className="mt-1.5 space-y-1.5">{done.map(card)}</ul>
        </details>
      )}
      <details>
        <summary className="cursor-pointer text-slate-500">No trigger the app can read ({NO_TRIGGER.length})</summary>
        <ul className="mt-1 list-disc pl-5 text-slate-500 space-y-0.5">
          {NO_TRIGGER.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </details>
    </section>
  );
}

function Progress({ p }: { p: NonNullable<DueItem["progress"]> }) {
  const share = p.need > 0 ? Math.min(1, p.have / p.need) : 0;
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="inline-block h-1.5 w-24 rounded bg-slate-800" aria-hidden>
        <span className={`block h-1.5 rounded ${share >= 1 ? "bg-amber-400" : "bg-sky-500"}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span className="text-slate-400 tabular-nums">{p.have.toLocaleString()} / {p.need.toLocaleString()} {p.unit}</span>
    </div>
  );
}
