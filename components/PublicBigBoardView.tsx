"use client";
import { useMemo, useState } from "react";
import {
  boardSharePath, sharedFullSamples, SHARED_SAMPLE_UNIT, type SharedBoardResult, type SharedBoardRow,
} from "../lib/scouting/sharedBoard";
import { SAMPLE_TIERS } from "../lib/scouting/sampleTiers";
import { CHARTED_PLAYS } from "../lib/scouting/chartedCounts";
import { formatGrade, gradeColor, gradeTier, gradeTierRange, GRADE_TIERS } from "../lib/scouting/prospectGrade";
import { parseHeightInches } from "../lib/scouting/prospectAge";
import { POS_COLOR } from "../lib/uiTheme";
import { ShareLinkButton } from "./shared/ShareLinkButton";

type SortKey =
  | "ovr" | "sample" | "name" | "games" | "snaps" | "plays" | "pre" | "post"
  | "posRank" | "pos" | "school" | "age" | "ht" | "wt";

// Most tape, best grade first; every other column opens ascending.
const BEST_FIRST = new Set<SortKey>(["sample", "games", "snaps", "plays", "pre", "post"]);

function sortValue(r: SharedBoardRow, key: SortKey): number | string | null {
  switch (key) {
    case "ovr": return r.ovr;
    case "sample": return r.sample?.pct ?? null;
    case "name": return r.name;
    case "games": return r.games;
    case "snaps": return r.snaps;
    case "plays": return r.plays;
    case "pre": return r.pre;
    case "post": return r.post;
    case "posRank": return r.posRank;
    case "pos": return r.pos || null;
    case "school": return r.school || null;
    case "age": return r.age;
    case "ht": return parseHeightInches(r.ht);
    case "wt": return r.wt;
  }
}

/** Sorted rows; a blank sinks to the bottom either way, ties keep OVR order. */
function sortRows(rows: readonly SharedBoardRow[], key: SortKey, dir: "asc" | "desc"): SharedBoardRow[] {
  return rows
    .map((r, i) => ({ r, i, v: sortValue(r, key) }))
    .sort((a, b) => {
      if (a.v == null || b.v == null) return a.v === b.v ? a.i - b.i : a.v == null ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v));
      return (dir === "asc" ? c : -c) || a.i - b.i;
    })
    .map(({ r }) => r);
}

// Same date on the server and in the browser (no hydration mismatch).
const UPDATED_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

function updatedText(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : UPDATED_FMT.format(d);
}

interface PublicBigBoardViewProps {
  token: string;
  result: SharedBoardResult;
}

/** Read-only Big Board anyone can open from a shared link: one class, all positions. */
export default function PublicBigBoardView({ token, result }: PublicBigBoardViewProps) {
  return (
    <main className="min-h-screen bg-slate-950 text-white px-4 py-6 sm:px-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
      <div className="max-w-[1400px] mx-auto">
        {result.status === "missing" && (
          <Notice title="Board not found" body="This link doesn't point to a shared board. Ask whoever sent it for a fresh link." />
        )}
        {result.status === "error" && (
          <Notice title="Couldn't load this board" body="The board didn't answer. Give it a moment and reload the page." />
        )}
        {result.status === "ready" && (
          <Board token={token} classYear={result.board.classYear} rows={result.board.rows} updatedAt={result.board.updatedAt} />
        )}
      </div>
    </main>
  );
}

function Board({ token, classYear, rows, updatedAt }: { token: string; classYear: number; rows: SharedBoardRow[]; updatedAt: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("ovr");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);
  const full = useMemo(() => sharedFullSamples(rows), [rows]);
  const updated = updatedText(updatedAt);
  const notFull = rows.filter((r) => r.sample && r.sample.pct < 100).length;
  const redacted = rows.filter((r) => r.redacted).length;

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(BEST_FIRST.has(k) ? "desc" : "asc"); }
  }

  const th = (label: string, key: SortKey, cls = "", title?: string, style?: React.CSSProperties) => {
    const active = sortKey === key;
    return (
      <th
        key={key}
        scope="col"
        title={title}
        style={style}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        className={`px-0 py-0 font-medium whitespace-nowrap ${cls}`}
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className={`w-full px-1.5 py-1.5 text-center hover:text-white transition ${active ? "text-blue-400" : "text-slate-500"}`}
        >
          {label}{active ? (sortDir === "asc" ? "↑" : "↓") : ""}
        </button>
      </th>
    );
  };

  const sampleLine = (["QB", "RB", "WR", "TE"] as const).map((pos) => `${pos} ${full[pos]} ${SHARED_SAMPLE_UNIT[pos]}`).join(" · ");
  const playsTooltip = "Each position's own plays: " + (["QB", "RB", "WR", "TE"] as const)
    .map((pos) => `${pos} ${CHARTED_PLAYS[pos].unit}`).join(", ") + ".";
  const td = "px-1.5 py-1.5 text-center whitespace-nowrap";

  return (
    <>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{classYear} Big Board</h1>
          <div className="text-xs text-slate-400">
            {rows.length} prospect{rows.length === 1 ? "" : "s"} · all positions
            {updated && <> · updated {updated}</>}
          </div>
        </div>
        <ShareLinkButton path={boardSharePath(token)} title={`${classYear} Big Board`} />
      </header>

      <section aria-label="About the Sample column" className="mb-3 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
        <p>
          <span className="font-semibold">Still being charted.</span>{" "}
          <span className="font-semibold">Sample</span> is how much of a full sample of tape has been charted for each player
          (a full sample: {sampleLine}). Anything under 100% means his evaluation isn&apos;t finished yet, so his rank and grade can still move.
          {notFull > 0 && <> {notFull} of {rows.length} aren&apos;t at a full sample yet.</>}
        </p>
        {redacted > 0 && (
          <p className="mt-1 text-amber-200/80">
            <span className="italic">Redacted</span>: {redacted === 1 ? "one player is" : `${redacted} players are`} hidden on this link; the rank, sample and grades are real.
          </p>
        )}
      </section>

      <ul aria-label="Sample colours" className="flex flex-wrap gap-x-4 gap-y-1 mb-1.5 text-xs">
        <li className="text-slate-500 whitespace-nowrap">Sample:</li>
        {SAMPLE_TIERS.map((t) => (
          <li key={t.tier} className="flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full ${t.dot}`} />
            <span className="text-slate-400">{t.label}</span>
          </li>
        ))}
      </ul>
      <ul aria-label="Grade tiers" className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs">
        <li className="text-slate-500 whitespace-nowrap">Grade:</li>
        {GRADE_TIERS.map((t) => (
          <li key={t.label} className="flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-sm ${t.swatch}`} />
            <span className={`font-semibold ${t.text}`}>{t.label}</span>
            <span className="text-slate-500">{gradeTierRange(t)}</span>
          </li>
        ))}
      </ul>

      {rows.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-12">No prospects on this board yet.</div>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-800">
          <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
            <caption className="sr-only">{classYear} Big Board, {rows.length} prospects</caption>
            <thead>
              <tr className="border-b border-slate-700 bg-slate-950">
                <th style={{ left: 0, minWidth: 48 }} className="sticky z-20 bg-slate-950" />
                <th style={{ left: 48, minWidth: 64 }} className="sticky z-20 bg-slate-950" />
                <th style={{ left: 112, minWidth: 150 }} className="sticky z-20 bg-slate-950 border-r border-slate-800" />
                <th colSpan={3} className="px-2 py-1 text-center text-slate-600 font-medium border-r border-slate-800">Charted</th>
                <th colSpan={2} className="px-2 py-1 text-center text-amber-900 font-medium border-r border-slate-800">Grade</th>
                <th colSpan={1} className="px-2 py-1 text-center text-slate-600 font-medium border-r border-slate-800">Pos Rank</th>
                <th colSpan={6} className="px-2 py-1 text-center text-slate-600 font-medium">Identity</th>
              </tr>
              <tr className="border-b border-slate-800 bg-slate-950">
                {th("OVR", "ovr", "sticky z-20 bg-slate-950", "Overall rank in the class", { left: 0, minWidth: 48 })}
                {th("Sample", "sample", "sticky z-20 bg-slate-950", `How much of a full sample is charted (${sampleLine})`, { left: 48, minWidth: 64 })}
                {th("Name", "name", "sticky z-20 bg-slate-950 border-r border-slate-800", undefined, { left: 112, minWidth: 150 })}
                {th("Games", "games", "", "Games charted")}
                {th("Snaps", "snaps", "", "Every play charted for him")}
                {th("Thr/Run/Rt", "plays", "border-r border-slate-800", playsTooltip)}
                {th("Pre", "pre", "", "Pre-draft grade (1–100)")}
                {th("Post", "post", "border-r border-slate-800", "Post-draft grade (1–100), once he's drafted")}
                {th("PosRk", "posRank", "border-r border-slate-800", "Rank within his position")}
                {th("Pos", "pos")}
                {th("School", "school")}
                <th scope="col" className="px-1.5 py-1.5 text-center text-slate-500 font-medium whitespace-nowrap">Yr</th>
                {th("Age", "age", "", "~ = estimated from his high-school class")}
                {th("Ht", "ht")}
                {th("Wt", "wt")}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {sorted.map((r, i) => {
                const bg = i % 2 === 0 ? "bg-slate-950" : "bg-slate-900";
                return (
                  <tr key={`${r.ovr ?? "u"}-${r.name}-${i}`} className={bg}>
                    <td style={{ left: 0, minWidth: 48 }} className={`sticky z-10 ${bg} ${td} text-yellow-400 font-bold`}>
                      {r.ovr != null ? `#${r.ovr}` : "—"}
                    </td>
                    <SampleCell row={r} bg={bg} />
                    <td style={{ left: 112, minWidth: 150 }} title={r.redacted ? "Hidden on this link" : undefined}
                      className={`sticky z-10 ${bg} ${td} border-r border-slate-800 font-medium ${r.redacted ? "italic text-slate-500" : "text-white"}`}>
                      {r.name}
                    </td>
                    <CountCell v={r.games} />
                    <CountCell v={r.snaps} />
                    <CountCell v={r.plays} cls="border-r border-slate-800" />
                    <GradeCell g={r.pre} />
                    <GradeCell g={r.post} cls="border-r border-slate-800" />
                    <td className={`${td} text-slate-500 border-r border-slate-800`}>{r.posRank != null ? `#${r.posRank}` : "—"}</td>
                    <td className={`${td} font-semibold ${POS_COLOR[r.pos] ?? "text-slate-400"}`}>{r.pos}</td>
                    <td className={`${td} text-slate-400`}>{r.school || "—"}</td>
                    <td className={`${td} text-slate-400`}>{classYear}</td>
                    <td className={`${td} text-slate-400`} title={r.ageEst ? "Estimated from his high-school class" : undefined}>
                      {r.age != null ? `${r.ageEst ? "~" : ""}${r.age}` : "—"}
                    </td>
                    <td className={`${td} text-slate-400`}>{r.ht ?? "—"}</td>
                    <td className={`${td} text-slate-400`}>{r.wt ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <footer className="mt-6 text-[11px] text-slate-500">
        Ranks, grades and charting from the owner&apos;s own film study.
        <span className="text-slate-600"> · DynastyZeus</span>
      </footer>
    </>
  );
}

/** The sample dot with its percent of a full sample beside it. */
function SampleCell({ row, bg }: { row: SharedBoardRow; bg: string }) {
  const s = row.sample;
  const style = { left: 48, minWidth: 64 };
  const cls = `sticky z-10 ${bg} px-1.5 py-1.5 whitespace-nowrap`;
  if (!s) return <td style={style} className={`${cls} text-center text-slate-600`}>—</td>;
  const t = SAMPLE_TIERS.find((x) => x.tier === s.tier) ?? SAMPLE_TIERS[SAMPLE_TIERS.length - 1];
  const unit = SHARED_SAMPLE_UNIT[row.pos as keyof typeof SHARED_SAMPLE_UNIT] ?? "plays";
  const title = s.n >= s.full ? `Full sample: ${s.n} ${unit} (full at ${s.full})` : `${s.n} of ${s.full} ${unit} charted`;
  return (
    <td style={style} className={cls} title={title}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full ${t.dot}`} />
        <span className={`tabular-nums ${s.pct >= 100 ? "text-emerald-400" : "text-slate-300"}`}>{s.pct}%</span>
        <span className="sr-only">{title}</span>
      </span>
    </td>
  );
}

function CountCell({ v, cls = "" }: { v: number | null; cls?: string }) {
  return (
    <td className={`px-1.5 py-1.5 text-center whitespace-nowrap tabular-nums ${v ? "text-slate-300" : "text-slate-600"} ${cls}`}>
      {v ?? ""}
    </td>
  );
}

function GradeCell({ g, cls = "" }: { g: number | null; cls?: string }) {
  const tier = gradeTier(g);
  return (
    <td className={`px-1.5 py-1.5 text-center whitespace-nowrap ${cls}`} title={tier ? `${tier.label} (${gradeTierRange(tier)})` : undefined}>
      <span className={`font-semibold ${gradeColor(g)}`}>{formatGrade(g)}</span>
    </td>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-md mx-auto mt-16 bg-slate-900 border border-slate-800 rounded-xl p-5 text-center">
      <h1 className="text-base font-semibold text-slate-200">{title}</h1>
      <p className="mt-1 text-xs text-slate-400">{body}</p>
    </div>
  );
}
