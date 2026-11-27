"use client";
// Big Board → Consensus board (stage 6 of the 2026-11-26 scouting plan,
// migration 109): upload a class's consensus big board CSV, review who it
// matched, and save. Each ticked player's rank is his projected pick in
// Dynasty+ until his real one is set; the class's other QB / RB / WR / TE
// show "not on consensus". Rules in lib/scouting/consensusBoard.ts.

import { useMemo, useState } from "react";
import type { ProspectWithStats } from "../../../lib/types";
import { projectedPickWindow, type DynastyBreakdown, type DynastyWeights } from "../../../lib/scouting/dynastyScore";
import {
  classConsensusAt, classFromFileName, consensusDayText, consensusRankOf, consensusSaveRanks, parseConsensusCsv,
  projectedCapital, reviewConsensus, type ConsensusMatch, type ConsensusRow,
} from "../../../lib/scouting/consensusBoard";
import { scoutingClassYear } from "../../../lib/scouting/chartNext";
import { STATUS_CLASSES } from "../../../lib/uiTheme";

const btn = "rounded border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40";
const go = "rounded bg-sky-700 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50";
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

/** A file's text (FileReader where Blob.text is missing). */
function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("couldn't read the file"));
    r.readAsText(file);
  });
}

interface Props {
  prospects: readonly ProspectWithStats[];
  /** The classes on the board. */
  years: readonly number[];
  /** The Big Board's class filter, if one is picked. */
  defaultYear: number | null;
  dynasty: ReadonlyMap<string, DynastyBreakdown>;
  weights: DynastyWeights;
  /** Saves { prospect id: rank } for the class; resolves to an error message, or null. */
  onSave: (year: number, ranks: ReadonlyMap<string, number>) => Promise<string | null>;
  onClose: () => void;
}

function startYear(years: readonly number[], filter: number | null): number {
  if (filter != null && years.includes(filter)) return filter;
  const scouting = scoutingClassYear(new Date());
  if (years.includes(scouting)) return scouting;
  return years[years.length - 1] ?? scouting;
}

export default function ConsensusPanel({ prospects, years, defaultYear, dynasty, weights, onSave, onClose }: Props) {
  const [year, setYear] = useState(() => startYear(years, defaultYear));
  const [file, setFile] = useState<{ name: string; rows: ConsensusRow[]; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const review = useMemo(() => (file ? reviewConsensus(file.rows, prospects, year) : null), [file, prospects, year]);
  // Ticks the user changed, over each match's default; a new review starts over.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [seenReview, setSeenReview] = useState(review);
  if (review !== seenReview) { setSeenReview(review); setToggled(new Map()); }
  const isOn = (m: ConsensusMatch) => toggled.get(m.prospectId) ?? m.on;
  const toggle = (m: ConsensusMatch) => setToggled((prev) => new Map(prev).set(m.prospectId, !isOn(m)));

  const uploads = useMemo(() => {
    const at = classConsensusAt(prospects);
    return [...at.entries()].sort((a, b) => a[0] - b[0]).map(([y, when]) => ({
      year: y, when, ranked: prospects.filter((p) => p.draft_class_year === y && consensusRankOf(p) != null).length,
    }));
  }, [prospects]);

  async function choose(f: File | undefined) {
    setError(null);
    setSaved(null);
    if (!f) return;
    try {
      const parsed = parseConsensusCsv(await readText(f));
      if (parsed.rows.length === 0) throw new Error("No players in it: every line needs a rank and a name.");
      setFile({ name: f.name, ...parsed });
      const named = classFromFileName(f.name, years);
      if (named != null) setYear(named);
    } catch (e) {
      setFile(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const ticked = review ? new Set(review.matches.filter(isOn).map((m) => m.prospectId)) : new Set<string>();
  const poolSize = review ? review.matches.length + review.missing.length : 0;

  async function save() {
    if (!review) return;
    setSaving(true);
    setError(null);
    const ranks = consensusSaveRanks(review, ticked);
    const err = await onSave(review.year, ranks);
    setSaving(false);
    if (err) { setError(err); return; }
    setSaved(`Saved the ${review.year} consensus: ${ranks.size} ranked (Dynasty+ projects their picks), ${poolSize - ranks.size} not on it.`);
    setFile(null);
  }

  const projectedPlus = (m: ConsensusMatch): string => {
    if (m.drafted) return "his pick";
    const d = dynasty.get(m.prospectId);
    if (!d) return "—";
    return signed(d.dynasty - (d.qbDiscount?.value ?? 0) + weights.draft * projectedCapital(m.row.rank, m.position));
  };
  const showWas = review?.matches.some((m) => m.was != null) ?? false;
  const toCheck = review?.matches.filter((m) => !m.on) ?? [];
  const sure = review?.matches.filter((m) => m.on) ?? [];

  const table = (list: readonly ConsensusMatch[]) => (
    <div className="max-h-96 overflow-y-auto rounded border border-slate-800 bg-slate-950/60">
      <table className="w-full border-collapse text-[11px]">
        <thead className="sticky top-0 bg-slate-900 text-slate-500">
          <tr>
            <th className="px-1.5 py-1 text-left font-medium"><span className="sr-only">Save</span></th>
            <th className="px-1.5 py-1 text-right font-medium">#</th>
            {showWas && <th className="px-1.5 py-1 text-right font-medium" title="His rank on the last upload">Move</th>}
            <th className="px-1.5 py-1 text-left font-medium">Name</th>
            <th className="px-1.5 py-1 text-left font-medium">Pos</th>
            <th className="px-1.5 py-1 text-left font-medium">School</th>
            <th className="px-1.5 py-1 text-right font-medium" title="The picks within 25% of his rank, averaged (past pick 257 = undrafted)">Picks</th>
            <th className="px-1.5 py-1 text-right font-medium" title={`Projected draft capital × the Draft slider (${weights.draft})`}>Capital</th>
            <th className="px-1.5 py-1 text-right font-medium" title="His Dynasty+ once saved, at the current sliders">Dynasty+</th>
          </tr>
        </thead>
        <tbody>
          {list.map((m) => {
            const w = projectedPickWindow(m.row.rank);
            const on = isOn(m);
            return (
              <tr key={m.prospectId} className={`border-t border-slate-800/60 ${on ? "" : "text-slate-500"}`}>
                <td className="px-1.5 py-0.5">
                  <input type="checkbox" checked={on} onChange={() => toggle(m)} className="accent-sky-500"
                    aria-label={`Save ${m.name} at consensus #${m.row.rank}`} />
                </td>
                <td className="px-1.5 py-0.5 text-right tabular-nums text-slate-300">{m.row.rank}</td>
                {showWas && (
                  <td className="px-1.5 py-0.5 text-right tabular-nums" title={m.was != null ? `was #${m.was}` : "not ranked on the last upload"}>
                    {m.was == null ? <span className="text-slate-500">new</span>
                      : m.was === m.row.rank ? <span className="text-slate-600">=</span>
                      : m.was > m.row.rank ? <span className="text-emerald-400">▲{m.was - m.row.rank}</span>
                      : <span className="text-red-400">▼{m.row.rank - m.was}</span>}
                  </td>
                )}
                <td className="px-1.5 py-0.5">
                  <span className={on ? "text-white" : ""}>{m.name}</span>
                  {m.note && <span className={`ml-1.5 rounded border px-1 text-[10px] font-semibold ${STATUS_CLASSES.warning}`}>{m.note}</span>}
                  {m.drafted && <span className="ml-1.5 text-[10px] text-slate-500">(round set: Dynasty+ keeps his pick)</span>}
                </td>
                <td className="px-1.5 py-0.5 text-slate-400">{m.position}</td>
                <td className="px-1.5 py-0.5 text-slate-400">{m.school || "—"}</td>
                <td className="px-1.5 py-0.5 text-right tabular-nums text-slate-400">{w.from === w.to ? w.from : `${w.from}–${w.to}`}</td>
                <td className="px-1.5 py-0.5 text-right tabular-nums">{signed(weights.draft * projectedCapital(m.row.rank, m.position))}</td>
                <td className="px-1.5 py-0.5 text-right tabular-nums">{projectedPlus(m)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <section aria-label="Consensus board" className="mb-3 space-y-2 rounded-lg border border-sky-900 bg-slate-900/60 p-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-slate-200">Consensus big board</span>
        <span className="text-slate-500">
          {uploads.length > 0
            ? `Last uploads: ${uploads.map((u) => `${u.year} ${consensusDayText(u.when)} (${u.ranked} ranked)`).join(" · ")}`
            : "No upload saved yet."}
        </span>
        <button onClick={onClose} className={`${btn} ml-auto`}>Close</button>
      </div>
      <p className="max-w-4xl text-slate-400">
        Upload the consensus big board CSV (Rank, Player Name, Position, College; the same source as Nov 5) for one class.
        Until his real pick is set, each matched QB / RB / WR / TE&apos;s rank is his projected pick in Dynasty+: draft capital on his
        position&apos;s curve averaged over the picks within 25% of it (#40 → 30–50, #12 → 9–15), undrafted past pick 257. Capital only:
        the landing spot waits for the real pick. Saving replaces the class&apos;s consensus ranks; the players it doesn&apos;t name show NC
        (not on consensus) and no Dynasty+.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1 text-slate-400">
          Class
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="rounded bg-slate-950 px-1 py-0.5 text-white focus:outline-none">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-400">
          CSV
          <input type="file" accept=".csv,text/csv" aria-label="Consensus big board CSV"
            onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }}
            className="text-[11px] text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-0.5 file:text-slate-200" />
        </label>
        {file && <span className="text-slate-500">{file.name}</span>}
      </div>

      {error && <p className="text-red-400" role="alert">{error}</p>}
      {saved && <p className="font-semibold text-emerald-400" role="status">{saved}</p>}

      {review && file && (
        <>
          <p className="text-slate-300">
            {review.rows.toLocaleString()} players read ({review.skillRows} QB / RB / WR / TE{file.skipped ? `; ${file.skipped} lines skipped` : ""}).
            {" "}Your {review.year} class: <span className="font-semibold text-white">{review.matches.length}</span> of {poolSize} matched
            {toCheck.length > 0 ? ` (${toCheck.length} to check, unticked)` : ""}; {review.missing.length} not on it.
          </p>
          {toCheck.length > 0 && (
            <div className="space-y-1">
              <p className="font-semibold text-amber-300">To check ({toCheck.length}): tick the ones that are him</p>
              {table(toCheck)}
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-slate-300">Matched by name at his position ({sure.length}), ticked</summary>
            <div className="mt-1">{table(sure)}</div>
          </details>
          {review.missing.length > 0 && (
            <details>
              <summary className="cursor-pointer text-slate-300">On your {review.year} board, not on the list ({review.missing.length}): NC, no Dynasty+</summary>
              <p className="mt-1 pl-3 text-slate-400">
                {review.missing.map((m) => `${m.name} (${m.position}${m.was != null ? `, was #${m.was}` : ""})`).join(", ")}
              </p>
            </details>
          )}
          {review.otherClass.length > 0 && (
            <details>
              <summary className="cursor-pointer text-slate-300">On the list, in another of your classes ({review.otherClass.length}): not saved</summary>
              <p className="mt-1 pl-3 text-slate-400">
                {review.otherClass.map((o) => `#${o.row.rank} ${o.name} (${o.classYear})`).join(", ")}.
                {" "}Move one to {review.year} and upload again to give him a projected pick.
              </p>
            </details>
          )}
          {review.unmatched.length > 0 && (
            <details>
              <summary className="cursor-pointer text-slate-300">On the list, not on your board ({review.unmatched.length}): add them, or check the spelling</summary>
              <p className="mt-1 pl-3 text-slate-400">
                {review.unmatched.map((r) => `#${r.rank} ${r.name} (${r.position}, ${r.school ?? "?"})`).join(", ")}
              </p>
            </details>
          )}
          {review.unsettled.length > 0 && (
            <p className="text-amber-300">
              Couldn&apos;t settle (two rows of his name, or one row two of your prospects share), left off:{" "}
              {review.unsettled.map((u) => `${u.name} (${u.position})`).join(", ")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { void save(); }} disabled={saving} className={go}>
              {saving ? "Saving…" : `Save the ${review.year} consensus: ${ticked.size} ranked, ${poolSize - ticked.size} not on it`}
            </button>
            <button onClick={() => { setFile(null); setError(null); }} disabled={saving} className={btn + " py-1"}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}
