"use client";
// The Prospect Data sheet's Measured sizes panel (migration 108): the two
// ways in (the combine from nflverse, or a pasted list with its source and
// day), progress, then every change (the ticked ones are saved) and what
// didn't land. State lives in useSizeFill; the rules in measuredSize.ts.

import { useState } from "react";
import { PASTE_SOURCES, sizeSourceInfo, type SizeChange, type SizeProspect } from "../../../lib/scouting/measuredSize";
import type { SizeSource } from "../../../lib/types";
import { STATUS_CLASSES } from "../../../lib/uiTheme";
import type { SizeFillSummary, UseSizeFillReturn } from "./useSizeFill";

const btn = "rounded border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40";
const go = "rounded bg-violet-700 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50";

/** Today as YYYY-MM-DD, in the user's own time zone. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ChangeRow({ c, on, onToggle }: { c: SizeChange; on: boolean; onToggle: () => void }) {
  const info = sizeSourceInfo(c.source);
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-slate-800/60">
        <input type="checkbox" checked={on} onChange={onToggle} className="mt-0.5 accent-violet-500" />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-white">{c.name}</span>{" "}
          <span className="text-slate-500">{c.position}</span>{" "}
          <span className="text-slate-500">{c.from}</span>
          <span className="text-slate-500" aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <span className="text-white">{c.to}</span>
          <span className={`ml-1.5 rounded border px-1 text-[10px] font-semibold ${STATUS_CLASSES.good}`}>{info?.label ?? c.source}</span>
          {c.note && (
            <span className={`ml-1.5 rounded border px-1 text-[10px] font-semibold ${STATUS_CLASSES.warning}`} title="Check before saving">
              {c.note}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

function Lines({ label, lines }: { label: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-slate-300">{label} ({lines.length})</summary>
      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pl-3 font-mono text-[11px]">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </details>
  );
}

function Summary({ s }: { s: SizeFillSummary }) {
  return (
    <div className="space-y-1 text-slate-400">
      {s.years?.map((y) => (
        <p key={y.year}>
          <span className="text-slate-300">{y.year}:</span>{" "}
          {y.matched == null ? "the combine isn't out yet (it's in the data by early March of the draft year)" : `combine ${y.matched} matched`}
        </p>
      ))}
      {s.pasted && (
        <p>
          {s.pasted.sized} line{s.pasted.sized === 1 ? "" : "s"} with a size read as {sizeSourceInfo(s.pasted.source)?.label}
          {s.pasted.source === "combine" ? "" : `, ${s.pasted.measuredOn}`}.
        </p>
      )}
      {s.unchanged > 0 && <p>{s.unchanged} already on file with these numbers.</p>}
      {s.notFound && s.notFound.length > 0 && (
        <details>
          <summary className="cursor-pointer text-slate-300">
            Not in the combine data ({s.notFound.length}): not invited, or a name spelled differently. Paste those with the source set to Combine.
          </summary>
          <p className="mt-1 pl-3">{s.notFound.map((n) => `${n.name} (${n.position}, ${n.year})`).join(", ")}</p>
        </details>
      )}
      {s.kept.length > 0 && (
        <details>
          <summary className="cursor-pointer text-slate-300">Kept as they are ({s.kept.length}): the combine, then the latest measurement, outrank the rest</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {s.kept.map((k) => <li key={k.id}><span className="text-slate-300">{k.name}</span>: {k.why}</li>)}
          </ul>
        </details>
      )}
      {s.pasted && (
        <>
          {s.pasted.repeated.length > 0 && (
            <p><span className="text-slate-300">On more than one line, left out:</span> {s.pasted.repeated.map((r) => r.name).join(", ")}</p>
          )}
          <Lines label="Lines that fit two of your prospects, left out" lines={s.pasted.ambiguous} />
          <Lines label="Lines that matched no one in the classes shown (a skill player, or no position given): check the spelling" lines={s.pasted.unmatched} />
        </>
      )}
      <p className="text-slate-500">
        A measured size replaces the listed one in every score (frame, light-inside, role-fit size, Speed Score without a weigh-in), and Fill from PFF leaves it alone.
        The listed size is kept; the chip after the weight puts it back.
      </p>
    </div>
  );
}

export default function SizeFillPanel({ fill, pool, classes }: {
  fill: UseSizeFillReturn;
  /** Every QB / RB / WR / TE in the classes shown. */
  pool: readonly SizeProspect[];
  /** "2027" or "2026–2029", for the labels. */
  classes: string;
}) {
  const { phase, progress, changes, selected, summary, error } = fill;
  const [text, setText] = useState("");
  const [source, setSource] = useState<SizeSource>("senior_bowl");
  const [measuredOn, setMeasuredOn] = useState(today);
  if (phase === "idle" && !error) return null;

  return (
    <section aria-label="Measured sizes" className="mb-3 space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
      {error && <p className="text-red-400" role="alert">{error}</p>}

      {phase === "choose" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <p className="font-semibold text-slate-200">The combine</p>
            <p className="text-slate-400">
              Heights (whole inches) and weights from nflverse&apos;s combine data, for every QB, RB, WR and TE in the {classes} class{classes.includes("–") ? "es" : ""} ({pool.length} prospects).
              In the data by early March of the draft year.
            </p>
            <button onClick={() => fill.readCombine(pool)} disabled={pool.length === 0} className={go}>Read the combine</button>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold text-slate-200">Paste a list</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-slate-400">
                Source
                <select value={source} onChange={(e) => setSource(e.target.value as SizeSource)}
                  className="rounded bg-slate-950 px-1 py-0.5 text-white focus:outline-none">
                  {PASTE_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              {source === "combine" ? (
                <span className="text-slate-500">The combine outranks every other measurement, whenever it was.</span>
              ) : (
                <label className="flex items-center gap-1 text-slate-400">
                  Measured on
                  <input type="date" value={measuredOn} onChange={(e) => setMeasuredOn(e.target.value)}
                    className="rounded bg-slate-950 px-1 py-0.5 text-white focus:outline-none" />
                </label>
              )}
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label="Pasted measurements"
              placeholder={"One player per line: name, height, weight (any order, extra columns are fine)\nJordan Doe  RB  Florida  6003  228\nC.J. Roe, WR, Georgia, 5'11 1/4\", 197 lbs"}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-white placeholder-slate-600 focus:border-violet-500 focus:outline-none" />
            <p className="text-slate-500">Heights as 6003, 6&apos;0 3/8&quot;, 6-0 3/8 or 72.375; matched by name across every position in the {classes} class{classes.includes("–") ? "es" : ""}.</p>
            <button onClick={() => fill.readPaste(pool, text, source, measuredOn)} disabled={!text.trim() || !measuredOn || pool.length === 0} className={go}>
              Read the list
            </button>
          </div>
          <div className="md:col-span-2"><button onClick={fill.close} className={btn}>Close</button></div>
        </div>
      )}

      {(phase === "reading" || phase === "saving") && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-300" aria-live="polite">
            {phase === "saving" ? "Saving…" : `Reading the combine${progress ? ` for ${progress}` : ""}…`}
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
                : "Nothing to change."}
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
              {changes.map((c) => <ChangeRow key={c.key} c={c} on={selected.has(c.key)} onToggle={() => fill.toggle(c.key)} />)}
            </ul>
          )}
          <Summary s={summary} />
          <div className="flex flex-wrap gap-2">
            {changes.length > 0 && (
              <button onClick={fill.apply} disabled={selected.size === 0} className={go}>
                Save {selected.size} change{selected.size === 1 ? "" : "s"}
              </button>
            )}
            <button onClick={fill.open} className={btn + " py-1"}>Back</button>
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
