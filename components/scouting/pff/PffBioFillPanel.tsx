"use client";
// The Roster sheet's Fill from PFF panel: progress while it links and reads,
// then every change PFF would make (the ticked ones are saved), and what's
// left for the user to fill by hand. State lives in usePffBioFill.

import type { BioChange, BioField } from "../../../lib/scouting/pffBio";
import { STATUS_CLASSES } from "../../../lib/uiTheme";
import type { BioFillPhase, BioFillSummary, UsePffBioFillReturn } from "./usePffBioFill";

const FIELD_LABEL: Record<BioField, string> = { height: "Height", weight: "Weight", birthday: "Birthday" };

const RUNNING: Partial<Record<BioFillPhase, string>> = {
  linking: "Linking new prospects to PFF",
  importing: "Importing PFF stats for their charted games",
  reading: "Reading PFF",
  saving: "Saving",
};

const btn = "rounded border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40";

function show(field: BioField, v: string | number | null): string {
  if (v == null || v === "") return "blank";
  return field === "weight" ? `${v} lb` : String(v);
}

function ChangeRow({ c, on, onToggle }: { c: BioChange; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-slate-800/60">
        <input type="checkbox" checked={on} onChange={onToggle} className="mt-0.5 accent-sky-500" />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-white">{c.name}</span>{" "}
          <span className="text-slate-400">{FIELD_LABEL[c.field]}</span>{" "}
          <span className="text-slate-500">{show(c.field, c.from)}</span>
          <span className="text-slate-500" aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <span className="text-white">{show(c.field, c.to)}</span>
          {c.kind === "fill" && (
            <span className={`ml-1.5 rounded border px-1 text-[10px] font-semibold ${STATUS_CLASSES.good}`}>new</span>
          )}
          {c.kind === "differs" && (
            <span
              className={`ml-1.5 rounded border px-1 text-[10px] font-semibold ${STATUS_CLASSES.warning}`}
              title="PFF's birthday disagrees with yours. Yours stays unless you tick it."
            >
              PFF differs
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

function Notes({ s }: { s: BioFillSummary }) {
  return (
    <div className="space-y-1 text-slate-400">
      {s.linked > 0 && <p>Linked {s.linked} new prospect{s.linked === 1 ? "" : "s"} to PFF.</p>}
      {s.noBirthday.length > 0 && (
        <p>
          <span className="text-slate-300">No birthday on file or in PFF ({s.noBirthday.length}), to fill by hand:</span>{" "}
          {s.noBirthday.map((p) => p.name).join(", ")}
        </p>
      )}
      {s.skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer text-slate-300">
            PFF not read for {s.skipped.length} (not linked yet, or the link needs a look in PFF Links)
          </summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {s.skipped.map((p) => <li key={p.id}><span className="text-slate-300">{p.name}</span>: {p.why}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function PffBioFillPanel({ fill }: { fill: UsePffBioFillReturn }) {
  const { phase, progress, changes, selected, summary, error } = fill;
  if (phase === "idle" && !error) return null;
  const running = RUNNING[phase];

  return (
    <section aria-label="Fill from PFF" className="mb-3 space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
      {error && <p className="text-red-400" role="alert">{error}</p>}

      {running && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-300" aria-live="polite">
            {running}
            {progress && progress.total > 0 && ` ${progress.done} / ${progress.total}`}
            {progress && progress.failed > 0 && ` · ${progress.failed} failed`}
            {progress?.note ? ` · ${progress.note}` : "…"}
          </span>
          {phase !== "saving" && <button onClick={fill.cancel} className={btn}>Stop</button>}
        </div>
      )}

      {phase === "review" && summary && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-200">
              {changes.length > 0
                ? `PFF has ${changes.length} change${changes.length === 1 ? "" : "s"}. Ticked ones are saved.`
                : summary.read > 0
                  ? `Height, weight and birthday already match PFF for the ${summary.read} prospect${summary.read === 1 ? "" : "s"} read.`
                  : "Nothing to fill: none of these prospects are linked to PFF."}
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
          <Notes s={summary} />
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
          <Notes s={summary} />
          <button onClick={fill.close} className={btn + " py-1"}>Close</button>
        </>
      )}

      {phase === "idle" && error && <button onClick={fill.close} className={btn}>Dismiss</button>}
    </section>
  );
}
