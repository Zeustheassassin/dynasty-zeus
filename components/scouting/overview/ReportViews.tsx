"use client";
import type { ReactNode } from "react";
import type { ProspectWithStats } from "../../../lib/types";
import type { CompositePos } from "../../../lib/scouting/aeComposite";
import { PRIME_END_AGE } from "../../../lib/scouting/dynastyScore";
import { draftRoundLabel, UNDRAFTED_ROUND } from "../../../lib/draftRound";
import { formatGrade } from "../../../lib/scouting/prospectGrade";
import { roleFitTooltip, roleInfo, roleLabel } from "../../../lib/scouting/roleFit";
import { aeScoreMissingReason, dynastyScores, scorePieces, type AEKey } from "../../../lib/scouting/prospectScores";
import type { OverviewPage } from "../../../lib/scouting/overviewStats";
import { ChipLegend, ColumnSection, MainSection, ReportCard, ScoreTile, SectionTitle, type Ranks } from "./ReportParts";
import { useReportTheme } from "./reportTheme";
import type { UseProspectReportReturn } from "./useProspectReport";

// The report's pages, drawn from useProspectReport. The screen tabs and the
// Print / PDF copy render these same views (dark on screen, light on paper).

const signed = (v: number, dp: number) => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;
const toneOf = (v: number): "pos" | "neg" => (v >= 0 ? "pos" : "neg");

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

function anyChip(page: OverviewPage, ranks: Ranks, id: string): boolean {
  return [...page.main, ...page.columns].some((s) => s.stats.some((st) => ranks.get(st.key)?.has(id)));
}

// ── Header ───────────────────────────────────────────────────

function ReportHeader({ kicker, p, facts, actions, report }: {
  kicker: string; p: ProspectWithStats; facts: string[]; actions?: ReactNode; report: UseProspectReportReturn;
}) {
  const t = useReportTheme();
  const fit = report.scores.roleFits.get(p.id);
  const hasGrade = p.pre_draft_grade != null || p.post_draft_grade != null;
  return (
    <div className="px-6 pt-6 pb-5 flex flex-wrap justify-between gap-4">
      <div className="min-w-0 flex flex-col gap-1.5">
        <div className={`text-[11px] font-semibold tracking-[0.12em] ${t.label}`}>{kicker}</div>
        <h2 className={`text-4xl font-bold leading-tight tracking-tight ${t.title}`}>{p.name}</h2>
        <div className={`text-sm ${t.muted}`}>{facts.join(" · ")}</div>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {fit && (
          <span className={`px-2.5 py-1.5 rounded-full border text-[13px] font-semibold ${t.pill.role}`} title={roleFitTooltip(fit)}>
            Projects {roleLabel(fit)}
            {fit.usedAs && fit.usedAs !== fit.best ? ` · used as ${roleInfo(fit.usedAs).label}` : ""}
          </span>
        )}
        {hasGrade && (
          <span className={`px-2.5 py-1.5 rounded-full border text-[13px] ${t.pill.grade}`}>
            Pre {formatGrade(p.pre_draft_grade)} · Post {formatGrade(p.post_draft_grade)}
          </span>
        )}
        {p.draft_round != null && (
          <span className={`px-2.5 py-1.5 rounded-full border text-[13px] font-semibold ${t.pill.round}`}>
            {p.draft_round === UNDRAFTED_ROUND ? "Undrafted" : `${draftRoundLabel(p.draft_round)} round${p.draft_pick ? `, pick ${p.draft_pick}` : ""}`}
            {p.draft_team ? ` · ${p.draft_team}` : ""}
          </span>
        )}
        {actions}
      </div>
    </div>
  );
}

/** Class · position · school · size · age, then the page's own facts. */
function bioFacts(p: ProspectWithStats, report: UseProspectReportReturn, more: string[]): string[] {
  const age = report.scores.ages.get(p.id);
  return [
    String(p.draft_class_year), p.position, p.school,
    p.height || null, p.weight ? `${p.weight} lb` : null,
    age ? `Age ${age.estimated ? "~" : ""}${age.years.toFixed(1)}` : null,
    ...more,
  ].filter((x): x is string => !!x);
}

// ── Scores ───────────────────────────────────────────────────

function ScoreStrip({ p, pos, report }: { p: ProspectWithStats; pos: CompositePos; report: UseProspectReportReturn }) {
  const { scores, views, weights, prospects } = report;
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
      "Breakdown has it piece by piece.",
    ].join("\n");
    tiles.push(<ScoreTile key="ae" primary label="AE SCORE" value={signed(sc.score, 2)} tone={toneOf(sc.score)} lines={lines} title={title} />);
  } else {
    tiles.push(<ScoreTile key="ae" primary label="AE SCORE" value="—" tone="dim" lines={["Not scored yet", aeScoreMissingReason(scores.composite, pos)]} />);
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
    tiles.push(<ScoreTile key="dyn" label="DYNASTY" value={signed(d.dynasty, 2)} tone={toneOf(d.dynasty)} lines={[parts.join(" · ")]}
      title={[`AE Score ${signed(d.aeScore, 2)}`, ageTitle, ...d.flags.map((f) => `Size: ${f.label}`), "Weighted by the Big Board's Dynasty sliders."].join("\n")} />);
    tiles.push(d.plus != null && d.draftCapital != null && p.draft_round != null
      ? <ScoreTile key="plus" label="DYNASTY+" value={signed(d.plus, 2)} tone={toneOf(d.plus)} lines={[`${draftRoundLabel(p.draft_round)} capital ${signed(weights.draft * d.draftCapital, 2)}`]} />
      : <ScoreTile key="plus" label="DYNASTY+" value="—" tone="dim" lines={["shows once a round is set"]} />);
  } else {
    tiles.push(<ScoreTile key="dyn" label="DYNASTY" value="—" tone="dim" lines={["needs an AE Score"]} />);
  }

  for (const a of AE_TILES[pos]) {
    const v = scores.aeMaps[a.key].get(p.id) ?? null;
    tiles.push(<ScoreTile key={a.key} label={a.label.toUpperCase()} value={v == null ? "—" : signed(v, 1)} tone={v == null ? "dim" : toneOf(v)} lines={[v == null ? "under the sample floor" : a.what]} />);
  }
  const g = PFF_GRADE[pos];
  const grade = scores.pffVals.get(p.id)?.[g.key] ?? null;
  const pffGames = scores.pffVals.get(p.id)?.pff_g ?? null;
  tiles.push(<ScoreTile key="pff" label={g.label.toUpperCase()} value={grade == null ? "—" : grade.toFixed(1)} tone={grade == null ? "dim" : "plain"} lines={[grade == null ? "not imported yet" : `${pffGames} game${pffGames === 1 ? "" : "s"}`]} />);

  const t = useReportTheme();
  return <div className={`px-6 pb-6 grid gap-3 break-inside-avoid ${t.layout.strip}`}>{tiles}</div>;
}

// ── Page 1: Overview ─────────────────────────────────────────

/** Page 1: the scores, then the numbers that say what he is. */
export function OverviewView({ report, actions }: { report: UseProspectReportReturn; actions?: ReactNode }) {
  const t = useReportTheme();
  const { p, pos, pages, ranks } = report;
  const page = p ? pages.get(p.id) : undefined;
  if (!p || !pos || !page) return null;
  return (
    <ReportCard label={`${p.name} player report`}>
      <ReportHeader kicker="PLAYER REPORT" p={p} facts={bioFacts(p, report, page.meta)} actions={actions} report={report} />
      <ScoreStrip p={p} pos={pos} report={report} />
      {page.main.map((s) => <MainSection key={s.key} section={s} ranks={ranks} id={p.id} />)}
      {page.columns.length > 0 && (
        <div className={`border-t grid ${t.layout.band} ${t.divider}`}>
          {page.columns.map((s) => <ColumnSection key={s.key} section={s} ranks={ranks} id={p.id} />)}
        </div>
      )}
      <ChipLegend show={anyChip(page, ranks, p.id)} pos={pos} />
    </ReportCard>
  );
}

// ── AE Score, piece by piece ─────────────────────────────────

/** How the AE Score adds up: each piece's number, trust, weight and what it adds. */
export function ScorePiecesView({ report }: { report: UseProspectReportReturn }) {
  const t = useReportTheme();
  const { p, pos, views, scores } = report;
  if (!p || !pos) return null;
  const sc = views.get(p.id);
  const pc = scores.composite.positions[pos];
  const pieces = sc && !sc.lockedAt ? scorePieces(sc, pc) : [];
  const biggest = Math.max(0.01, ...pieces.map((x) => Math.abs(x.add)));
  return (
    <ReportCard label={`${p.name} AE Score piece by piece`}>
      <section className="px-6 py-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle title="AE Score, piece by piece" />
          {sc && <span className={`text-sm ${t.muted}`}>AE Score <span className={`font-bold ${sc.score >= 0 ? t.pos : t.neg}`}>{signed(sc.score, 2)}</span></span>}
        </div>
        {!sc ? (
          <div className={`text-sm ${t.muted}`}>Not scored yet: {aeScoreMissingReason(scores.composite, pos)}.</div>
        ) : sc.lockedAt ? (
          <div className={`text-sm ${t.muted}`}>This is his draft-day score ({new Date(sc.lockedAt).toLocaleDateString()}); there is no live score to break down.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className={`border-b text-xs text-right ${t.divider} ${t.label}`}>
                  <th className="text-left font-semibold pb-2 pr-3">Piece</th>
                  <th className="font-semibold pb-2 px-3">His number</th>
                  <th className="font-semibold pb-2 px-3">Trust</th>
                  <th className="font-semibold pb-2 px-3">Weight</th>
                  <th className="text-left font-semibold pb-2 pl-3 w-[32%]">Adds</th>
                </tr>
              </thead>
              <tbody>
                {pieces.map((x) => (
                  <tr key={x.key} className={`border-b ${t.rowRule}`}>
                    <td className={`py-2.5 pr-3 font-medium ${t.body}`}>{x.label}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${t.body}`}>{x.value}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${t.muted}`}>{x.trust == null ? "—" : `${Math.round(x.trust * 100)}%`}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${t.muted}`}>{x.weight ?? "—"}</td>
                    <td className="py-2.5 pl-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`flex-1 h-2 rounded overflow-hidden ${t.track}`}>
                          <div className={`h-full ${x.add >= 0 ? t.fill.chart : "bg-red-500"}`} style={{ width: `${(Math.abs(x.add) / biggest) * 100}%` }} />
                        </div>
                        <span className={`w-14 text-right font-semibold tabular-nums ${x.add >= 0 ? t.pos : t.neg}`}>{signed(x.add, 2)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className={`pt-3 pr-3 font-bold ${t.strong}`} colSpan={4}>AE Score</td>
                  <td className={`pt-3 pl-3 text-right font-bold tabular-nums ${sc.score >= 0 ? t.pos : t.neg}`}>{signed(sc.score, 2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {sc?.atDraft && <div className={`text-xs ${t.muted}`}>At the draft: {signed(sc.atDraft.score, 2)} (saved {new Date(sc.atDraft.lockedAt).toLocaleDateString()}).</div>}
        {sc && (
          <div className={`text-xs leading-relaxed ${t.muted}`}>
            Each piece&apos;s number is pulled toward the average by how far its sample is trusted, then put in true-talent spreads
            for the position. A piece adds its weight times that, over the summed weights. Opponent strength is already taken out of
            the AE numbers it applies to.
          </div>
        )}
      </section>
    </ReportCard>
  );
}

// ── Production ───────────────────────────────────────────────

/** Every production number over his games, with where each ranks. */
export function ProductionView({ report }: { report: UseProspectReportReturn }) {
  const t = useReportTheme();
  const { p, pos, production, productionRanks } = report;
  const page = p ? production.get(p.id) : undefined;
  if (!p || !pos || !page) return null;
  const has = page.meta.length > 0;
  return (
    <ReportCard label={`${p.name} production`}>
      <ReportHeader kicker="PRODUCTION" p={p} facts={bioFacts(p, report, page.meta)} report={report} />
      {has ? (
        page.main.map((s) => <MainSection key={s.key} section={s} ranks={productionRanks} id={p.id} />)
      ) : (
        <div className={`border-t px-6 py-8 text-sm ${t.divider} ${t.muted}`}>
          No production numbers for his games yet: link and import them in Scouting → PFF Links.
        </div>
      )}
      {has && <ChipLegend show={anyChip(page, productionRanks, p.id)} pos={pos} />}
    </ReportCard>
  );
}
