"use client";
// The Prospect Data sheet's Fill 40s panel: progress while it reads, then
// every change (the ticked ones are saved), each class's sources, and who
// neither source had. State lives in useFortyFill.

import type { FortyChange } from "../../../lib/scouting/fortyFill";
import { PROJECTED_FROM } from "../../../lib/scouting/fortyFill";
import { STATUS_CLASSES } from "../../../lib/uiTheme";
import type { FortyFillSummary, UseFortyFillReturn } from "./useFortyFill";

const btn = "rounded border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40";

function ChangeRow({ c, on, onToggle }: { c: FortyChange; on: boolean; onToggle: () => void }) {
  const to = c.kind === "combine"
    ? `${c.time.toFixed(2)} combine${c.weight != null ? ` at ${c.weight} lb` : ""}`
    : `~${c.time.toFixed(2)} projected`;
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-slate-800/60">
        <input type="checkbox" checked={on} onChange={onToggle} className="mt-0.5 accent-sky-500" />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-white">{c.name}</span>{" "}
          <span className="text-slate-500">{c.from}</span>
          <span className="text-slate-500" aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <span className={c.kind === "combine" ? "text-white" : "text-slate-300"}>{to}</span>
          <span className={`ml-1.5 rounded border px-1 text-[10px] font-semibold ${c.kind === "combine" ? STATUS_CLASSES.good : "border-slate-700 bg-slate-800/60 text-slate-400"}`}>
            {c.kind === "combine" ? "official" : PROJECTED_FROM}
          </span>
          {c.note && (
            <span className={`ml-1.5 rounded border px-1 text-[10px] font-semibold ${STATUS_CLASSES.warning}`} title="Unticked: check before saving">
              {c.note}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

function Sources({ s }: { s: FortyFillSummary }) {
  return (
    <div className="space-y-1 text-slate-400">
      {s.years.map((y) => (
        <p key={y.year}>
          <span className="text-slate-300">{y.year}:</span>{" "}
          {y.combineError
            ? <span className="text-red-400">combine not read ({y.combineError})</span>
            : y.combine == null ? "the combine isn't out yet (it's in the data by early March of the draft year)" : `combine ${y.combine} matched`}
          {" · "}
          {y.projectedError
            ? <span className="text-red-400">{PROJECTED_FROM} not read ({y.projectedError})</span>
            : `${PROJECTED_FROM} ${y.projected} matched`}
        </p>
      ))}
      {s.notFound.length > 0 && (
        <details>
          <summary className="cursor-pointer text-slate-300">
            No 40 from either source ({s.notFound.length}): {PROJECTED_FROM} projects only the players it ranks, and the combine
            has only the invitees who ran. A name spelled differently lands here too. Type a pro-day time in Edit Bio.
          </summary>
          <p className="mt-1 pl-3">{s.notFound.map((p) => `${p.name} (${p.year})`).join(", ")}</p>
        </details>
      )}
      <p className="text-slate-500">
        Official combine times count in the RB speed floor. Projected times only show (greyed, with ~) until a real 40 is in.
      </p>
    </div>
  );
}

export default function FortyFillPanel({ fill }: { fill: UseFortyFillReturn }) {
  const { phase, progress, changes, selected, summary, error } = fill;
  if (phase === "idle" && !error) return null;

  return (
    <section aria-label="Fill 40s" className="mb-3 space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
      {error && <p className="text-red-400" role="alert">{error}</p>}

      {(phase === "reading" || phase === "saving") && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-300" aria-live="polite">
            {phase === "saving" ? "Saving…" : `Reading 40s${progress ? ` for ${progress}` : ""}…`}
          </span>
          {phase === "reading" && <button onClick={fill.cancel} className={btn}>Stop</button>}
        </div>
      )}

      {phase === "review" && summary && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-200">
              {changes.length > 0
                ? `${changes.length} change${changes.length === 1 ? "" : "s"}. Ticked ones are saved.`
                : "Nothing new: every 40 the sources have is already on file."}
            </span>
            {changes.length > 1 && (
              <>
                <button onClick={() => fill.setAll(true)} className={btn}>Tick all</button>
                <button onClick={() => fill.setAll(false)} className={btn}>Untick all</button>
              </>
            )}
          </div>
          {changes.length > 0 && (
            <ul className="max-h-80 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-1">
              {changes.map((c) => (
                <ChangeRow key={c.key} c={c} on={selected.has(c.key)} onToggle={() => fill.toggle(c.key)} />
              ))}
            </ul>
          )}
          <Sources s={summary} />
          <div className="flex flex-wrap gap-2">
            {changes.length > 0 && (
              <button
                onClick={fill.apply}
                disabled={selected.size === 0}
                className="rounded bg-sky-700 px-3 py-1 font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
              >
                Save {selected.size} change{selected.size === 1 ? "" : "s"}
              </button>
            )}
            <button onClick={fill.close} className={btn + " py-1"}>{changes.length > 0 ? "Cancel" : "Close"}</button>
          </div>
        </>
      )}

      {phase === "done" && summary && (
        <>
          <p className="font-semibold text-slate-200">Saved {summary.saved} change{summary.saved === 1 ? "" : "s"}.</p>
          <button onClick={fill.close} className={btn + " py-1"}>Close</button>
        </>
      )}

      {phase === "idle" && error && <button onClick={fill.close} className={btn}>Dismiss</button>}
    </section>
  );
}
