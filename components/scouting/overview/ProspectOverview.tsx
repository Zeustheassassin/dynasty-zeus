"use client";
import { useEffect, useMemo, type ReactNode } from "react";
import type { ProspectWithStats } from "../../../lib/types";
import type { PffTotals } from "../../../lib/pff/totals";
import type { CompositePos } from "../../../lib/scouting/aeComposite";
import { PRIME_END_AGE } from "../../../lib/scouting/dynastyScore";
import { draftRoundLabel, UNDRAFTED_ROUND } from "../../../lib/draftRound";
import { formatGrade } from "../../../lib/scouting/prospectGrade";
import { roleFitTooltip, roleInfo, roleLabel } from "../../../lib/scouting/roleFit";
import {
  aeScoreMissingReason, dynastyScores, isCompositePos, scoreViewsFrom,
  type AEKey, type ProspectScoresInput, type ScoreView,
} from "../../../lib/scouting/prospectScores";
import {
  ordinal, overviewPagesFor, percentileRanks,
  type OverviewPage, type OverviewSection, type OverviewStat,
} from "../../../lib/scouting/overviewStats";
import { useDynastyWeights, useProspectScores } from "../shared/hooks/useProspectScores";

/** Everything the Overview page reads, all from ScoutingHub (the Big Board's inputs). */
export interface OverviewData extends ProspectScoresInput {
  pffTotals?: Map<string, PffTotals>;
  loadPositionPlays: (pos: "RB" | "QB" | "TE") => void;
  /** Every position's plays have loaded, so the scores are final. */
  scoresReady: boolean;
}

interface Props {
  prospectId: string;
  data: OverviewData;
}

const signed = (v: number, dp: number) => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;
const scoreColor = (v: number) => (v >= 0 ? "text-emerald-400" : "text-red-400");

// The position's own AE metrics and PFF grade, beside the AE Score.
const AE_TILES: Record<CompositePos, { key: AEKey; label: string; what: string }[]> = {
  WR: [
    { key: "csae", label: "cSAE", what: "open % vs expected, core routes" },
    { key: "sae", label: "SAE", what: "open % vs expected, all routes" },
  ],
  QB: [{ key: "aae", label: "AAE", what: "accuracy vs expected, per throw" }],
  RB: [{ key: "srae", label: "SRAE", what: "run success vs expected" }],
  TE: [
    { key: "te_saer", label: "TE-SAER", what: "open % vs expected, routes" },
    { key: "te_saeb", label: "TE-SAEB", what: "block wins vs expected" },
  ],
};
const PFF_GRADE: Record<CompositePos, { key: string; label: string }> = {
  WR: { key: "pff_gr_route", label: "PFF route grade" },
  QB: { key: "pff_gr_pass", label: "PFF pass grade" },
  RB: { key: "pff_gr_run", label: "PFF run grade" },
  TE: { key: "pff_gr_off", label: "PFF offense grade" },
};

/**
 * A prospect's report, page 1: the scores up top, then the numbers that say
 * what he is — his charting's win / loss calls and PFF's box-score numbers over
 * the charted games (lib/scouting/overviewStats.ts), each with where it ranks
 * among every prospect at his position. Scores come from the same hook as the
 * Big Board, so the two always agree.
 */
export default function ProspectOverview({ prospectId, data }: Props) {
  const { prospects, games, rbPlays, qbPlays, tePlays, pffTotals, loadPositionPlays, scoresReady } = data;

  // The AE Score pools every position, so every position's plays are needed
  // (ScoutingHub no-ops a position already loaded).
  useEffect(() => {
    loadPositionPlays("RB");
    loadPositionPlays("QB");
    loadPositionPlays("TE");
  }, [loadPositionPlays]);

  const scores = useProspectScores(data);
  const { weights } = useDynastyWeights();
  const p = prospects.find((x) => x.id === prospectId) ?? null;
  const pos = p && isCompositePos(p.position) ? p.position : null;

  // Live scores (with the draft-day snapshot alongside for drafted classes).
  const views = useMemo(
    () => scoreViewsFrom(prospects, scores.liveScores, "live", new Date()),
    [prospects, scores.liveScores],
  );

  // Every prospect at his position (his page among them), for the percentile chips.
  const pffVals = scores.pffVals;
  const pffGames = useMemo(
    () => new Map([...(pffTotals ?? new Map<string, PffTotals>())].map(([id, t]) => [id, t.games])),
    [pffTotals],
  );
  const pages = useMemo(
    () => overviewPagesFor({ prospectId, prospects, games, qbPlays, rbPlays, tePlays, pffVals, pffGames }),
    [prospectId, prospects, games, qbPlays, rbPlays, tePlays, pffVals, pffGames],
  );
  const ranks = useMemo(() => percentileRanks(pages), [pages]);

  if (!p || !pos) {
    return <div className="text-slate-500 text-sm text-center py-8">Loading…</div>;
  }
  if (!scoresReady) {
    return <div className="text-slate-500 text-sm text-center py-8">Loading every position&apos;s plays for the scores…</div>;
  }
  const page = pages.get(p.id);
  if (!page) return <div className="text-slate-500 text-sm text-center py-8">Loading…</div>;

  const anyChip = [...page.main, ...page.columns].some((s) => s.stats.some((st) => ranks.get(st.key)?.has(p.id)));

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden" aria-label={`${p.name} player report`}>
      <ReportHeader p={p} page={page} scores={scores} />
      <ScoreStrip p={p} prospects={prospects} pos={pos} views={views} weights={weights} scores={scores} />
      {page.main.map((s) => <MainSection key={s.key} section={s} ranks={ranks} id={p.id} />)}
      {page.columns.length > 0 && (
        <div className="border-t border-slate-800 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
          {page.columns.map((s) => <ColumnSection key={s.key} section={s} ranks={ranks} id={p.id} />)}
        </div>
      )}
      <div className="border-t border-slate-800 px-6 py-3 text-xs text-slate-400">
        {anyChip
          ? `Chips: percentile among all ${pos} prospects with enough of a sample.`
          : `Percentile chips appear once 10 ${pos}s have enough of a sample.`}
      </div>
    </article>
  );
}

// ── Header ───────────────────────────────────────────────────

function ReportHeader({ p, page, scores }: { p: ProspectWithStats; page: OverviewPage; scores: ReturnType<typeof useProspectScores> }) {
  const age = scores.ages.get(p.id);
  const fit = scores.roleFits.get(p.id);
  const facts = [
    String(p.draft_class_year), p.position, p.school,
    p.height || null, p.weight ? `${p.weight} lb` : null,
    age ? `Age ${age.estimated ? "~" : ""}${age.years.toFixed(1)}` : null,
    ...page.meta,
  ].filter(Boolean);
  const hasGrade = p.pre_draft_grade != null || p.post_draft_grade != null;
  return (
    <div className="px-6 pt-6 pb-5 flex flex-wrap justify-between gap-4">
      <div className="min-w-0 flex flex-col gap-1.5">
        <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-400">PLAYER REPORT</div>
        <h2 className="text-4xl font-bold leading-tight tracking-tight text-slate-50">{p.name}</h2>
        <div className="text-sm text-slate-400">{facts.join(" · ")}</div>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {fit && (
          <span className="px-2.5 py-1.5 rounded-full border border-blue-900 bg-blue-950 text-blue-300 text-[13px] font-semibold" title={roleFitTooltip(fit)}>
            Projects {roleLabel(fit)}
            {fit.usedAs && fit.usedAs !== fit.best ? ` · used as ${roleInfo(fit.usedAs).label}` : ""}
          </span>
        )}
        {hasGrade && (
          <span className="px-2.5 py-1.5 rounded-full border border-slate-700 bg-slate-800 text-slate-300 text-[13px]">
            Pre {formatGrade(p.pre_draft_grade)} · Post {formatGrade(p.post_draft_grade)}
          </span>
        )}
        {p.draft_round != null && (
          <span className="px-2.5 py-1.5 rounded-full border border-yellow-900 bg-yellow-950 text-yellow-300 text-[13px] font-semibold">
            {p.draft_round === UNDRAFTED_ROUND ? "Undrafted" : `${draftRoundLabel(p.draft_round)} round${p.draft_pick ? `, pick ${p.draft_pick}` : ""}`}
            {p.draft_team ? ` · ${p.draft_team}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Scores ───────────────────────────────────────────────────

function ScoreTile({ label, value, valueClass, lines, title, primary }: {
  label: string; value: string; valueClass: string; lines: string[]; title?: string; primary?: boolean;
}) {
  return (
    <div
      className={`p-4 rounded-lg border flex flex-col gap-1 ${primary ? "border-blue-800 bg-blue-950/30" : "border-slate-800 bg-slate-950/40"}`}
      title={title}
    >
      <div className={`text-[11px] font-semibold tracking-wider ${primary ? "text-blue-300" : "text-slate-400"}`}>{label}</div>
      <div className={`${primary ? "text-[44px]" : "text-3xl"} font-bold leading-none tabular-nums ${valueClass}`}>{value}</div>
      {lines.map((l, i) => (
        <div key={i} className={`text-xs ${i === 0 && primary ? "text-slate-300" : "text-slate-400"}`}>{l}</div>
      ))}
    </div>
  );
}

function ScoreStrip({ p, prospects, pos, views, weights, scores }: {
  p: ProspectWithStats;
  prospects: readonly ProspectWithStats[];
  pos: CompositePos;
  views: Map<string, ScoreView>;
  weights: ReturnType<typeof useDynastyWeights>["weights"];
  scores: ReturnType<typeof useProspectScores>;
}) {
  const sc = views.get(p.id) ?? null;
  // Rank among the scored prospects of his draft class at his position.
  const peers = prospects.filter((x) => x.position === pos && x.draft_class_year === p.draft_class_year && views.has(x.id));
  const rank = sc ? 1 + peers.filter((x) => views.get(x.id)!.score > sc.score).length : null;

  const tiles: ReactNode[] = [];
  if (sc) {
    const primaryKey = scores.composite.positions[pos].metrics[0]?.key;
    const trust = sc.components.find((c) => c.key === primaryKey)?.reliability;
    const lines = [`#${rank} of ${peers.length} · ${p.draft_class_year} ${pos}s`];
    const extra = [
      trust != null ? `Trust ${Math.round(trust * 100)}%` : null,
      sc.atDraft ? `at draft ${signed(sc.atDraft.score, 2)}` : null,
    ].filter(Boolean).join(" · ");
    if (extra) lines.push(extra);
    const title = [
      `${signed(sc.score, 2)} true-talent SDs vs the average charted ${pos}`,
      ...sc.components.map((c) =>
        `${c.label} ${c.text ?? signed(c.ae, c.perPlayer ? 2 : 1)} · ${Math.round(c.reliability * 100)}% taken as real → ${signed(c.z, 2)}`),
      ...(sc.alignment ? [`Alignment: ${sc.alignment.label} → ${signed(sc.alignment.value, 2)}`] : []),
      ...(sc.baseline ? [`${pos} baseline → ${signed(sc.baseline, 2)}`] : []),
    ].join("\n");
    tiles.push(<ScoreTile key="ae" primary label="AE SCORE" value={signed(sc.score, 2)} valueClass={scoreColor(sc.score)} lines={lines} title={title} />);
  } else {
    tiles.push(<ScoreTile key="ae" primary label="AE SCORE" value="—" valueClass="text-slate-500" lines={["Not scored yet", aeScoreMissingReason(scores.composite, pos)]} />);
  }

  const d = sc ? dynastyScores([p], new Map([[p.id, sc]]), scores.hsClass, weights).get(p.id) : undefined;
  if (d) {
    const size = d.flags.reduce((s, f) => s + f.value, 0);
    const parts = [
      d.window != null ? `age ${signed(weights.age * d.window, 2)}` : "age unknown",
      ...(d.flags.length ? [`size ${signed(weights.size * size, 2)}`] : []),
    ];
    const ageTitle = d.rookieAge
      ? `Age ${d.rookieAge.years.toFixed(1)} as a rookie${d.rookieAge.estimated ? " (est. from HS class)" : ""}; ${pos} primes end at ${PRIME_END_AGE[pos]}`
      : "Age unknown";
    tiles.push(<ScoreTile key="dyn" label="DYNASTY" value={signed(d.dynasty, 2)} valueClass={scoreColor(d.dynasty)} lines={[parts.join(" · ")]}
      title={[`AE Score ${signed(d.aeScore, 2)}`, ageTitle, ...d.flags.map((f) => `Size: ${f.label}`), "Weighted by the Big Board's Dynasty sliders."].join("\n")} />);
    tiles.push(d.plus != null && d.draftCapital != null && p.draft_round != null
      ? <ScoreTile key="plus" label="DYNASTY+" value={signed(d.plus, 2)} valueClass={scoreColor(d.plus)} lines={[`${draftRoundLabel(p.draft_round)} capital ${signed(weights.draft * d.draftCapital, 2)}`]} />
      : <ScoreTile key="plus" label="DYNASTY+" value="—" valueClass="text-slate-500" lines={["shows once a round is set"]} />);
  } else {
    tiles.push(<ScoreTile key="dyn" label="DYNASTY" value="—" valueClass="text-slate-500" lines={["needs an AE Score"]} />);
  }

  for (const t of AE_TILES[pos]) {
    const v = scores.aeMaps[t.key].get(p.id) ?? null;
    tiles.push(<ScoreTile key={t.key} label={t.label.toUpperCase()} value={v == null ? "—" : signed(v, 1)} valueClass={v == null ? "text-slate-500" : scoreColor(v)} lines={[v == null ? "under the sample floor" : t.what]} />);
  }
  const g = PFF_GRADE[pos];
  const grade = scores.pffVals.get(p.id)?.[g.key] ?? null;
  const pffGames = scores.pffVals.get(p.id)?.pff_g ?? null;
  tiles.push(<ScoreTile key="pff" label={g.label.toUpperCase()} value={grade == null ? "—" : grade.toFixed(1)} valueClass={grade == null ? "text-slate-500" : "text-slate-50"} lines={[grade == null ? "no PFF stats imported" : `${pffGames} game${pffGames === 1 ? "" : "s"}`]} />);

  return <div className="px-6 pb-6 grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">{tiles}</div>;
}

// ── Sections ─────────────────────────────────────────────────

function fmtStat(s: OverviewStat): string {
  if (s.fmt === "text") return s.text ?? "—";
  if (s.value == null) return "—";
  const v = s.value;
  if (s.fmt === "pct0") return `${Math.round(v)}%`;
  if (s.fmt === "pct1") return `${v.toFixed(1)}%`;
  return `${v.toFixed(s.fmt === "dec1" ? 1 : 2)}${s.unit ?? ""}`;
}

function Chip({ pct }: { pct: number }) {
  const cls = pct >= 67
    ? "border-emerald-800 bg-emerald-950 text-emerald-300"
    : pct <= 33
      ? "border-red-900 bg-red-950 text-red-300"
      : "border-slate-700 bg-slate-800 text-slate-300";
  return (
    <span className={`px-1.5 py-0.5 rounded-full border text-[11px] font-semibold ${cls}`} title={`${ordinal(pct)} percentile`}>
      {ordinal(pct)}
    </span>
  );
}

function Bar({ s, thin }: { s: OverviewStat; thin?: boolean }) {
  if (s.bar == null) return null;
  return (
    <div className={`${thin ? "h-[3px]" : "h-1"} bg-slate-800 rounded overflow-hidden`}>
      <div className={`h-full ${s.tone === "pff" ? "bg-violet-400" : "bg-blue-400"}`} style={{ width: `${s.bar}%` }} />
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">{title}</h3>;
}

function Tile({ s, pct, size }: { s: OverviewStat; pct: number | undefined; size: "lg" | "md" }) {
  return (
    <div className="min-w-0 flex flex-col gap-1.5" title={s.tooltip}>
      <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
        {s.label}{s.note && <span className="ml-1 normal-case tracking-normal font-normal">{s.note}</span>}
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className={`${size === "lg" ? "text-4xl" : "text-3xl"} font-bold leading-none tabular-nums ${s.value == null && s.fmt !== "text" ? "text-slate-500" : "text-slate-50"}`}>
          {fmtStat(s)}
        </span>
        {pct != null && <Chip pct={pct} />}
      </div>
      {s.detail && <div className="text-xs text-slate-400 tabular-nums">{s.detail}</div>}
      <Bar s={s} />
    </div>
  );
}

function MainSection({ section, ranks, id }: { section: OverviewSection; ranks: Map<string, Map<string, number>>; id: string }) {
  const size = section.size === "lg" ? "lg" : "md";
  return (
    <section className={`px-6 pb-6 flex flex-col gap-4 ${section.title ? "border-t border-slate-800 pt-5" : "pt-1"}`}>
      {section.title && <SectionTitle title={section.title} />}
      <div className={`grid gap-6 ${size === "lg" ? "grid-cols-[repeat(auto-fit,minmax(200px,1fr))]" : "grid-cols-[repeat(auto-fit,minmax(160px,1fr))]"}`}>
        {section.stats.map((s) => <Tile key={s.key} s={s} size={size} pct={ranks.get(s.key)?.get(id)} />)}
      </div>
    </section>
  );
}

function ColumnSection({ section, ranks, id }: { section: OverviewSection; ranks: Map<string, Map<string, number>>; id: string }) {
  return (
    <section className="px-6 pt-5 pb-6 flex flex-col gap-3.5 border-slate-800 [&:not(:last-child)]:border-r">
      {section.title && <SectionTitle title={section.title} />}
      {section.size === "list"
        ? section.stats.map((s) => {
          const pct = ranks.get(s.key)?.get(id);
          return (
            <div key={s.key} className="flex flex-col gap-1" title={s.tooltip}>
              <div className="flex justify-between items-baseline gap-3">
                <span className="text-sm font-medium text-slate-200">{s.label}</span>
                <span className="flex items-baseline gap-2">
                  {pct != null && <Chip pct={pct} />}
                  <span className={`text-lg font-bold tabular-nums ${s.value == null && s.fmt !== "text" ? "text-slate-500" : "text-slate-50"}`}>{fmtStat(s)}</span>
                </span>
              </div>
              {s.detail && <div className="text-right text-xs text-slate-400 tabular-nums">{s.detail}</div>}
              <Bar s={s} thin />
            </div>
          );
        })
        : section.stats.map((s) => <Tile key={s.key} s={s} size="lg" pct={ranks.get(s.key)?.get(id)} />)}
    </section>
  );
}
