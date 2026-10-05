"use client";
// Analysis → Grading: where every Stage 4 grading piece that waits on data
// stands (lib/scouting/gradingChecks.ts). Read it after a few weeks of tagged
// charting: a difficulty tag is switched on (tagCorrection.ts
// ENABLED_TAG_CORRECTIONS) only once its held-out test improves, garbage-time
// plays are down-weighted only if their test says so, and a tagged era that
// drifts from the in-app one is re-centered (RECENTER_TAGGED).
import { useMemo, type ReactNode } from "react";
import type { Prospect, QBPlay, RBPlay, ScoutingGame, TEPlay } from "../../../lib/types";
import { buildGradingReport, type ComponentCheck, type ModelCheck } from "../../../lib/scouting/gradingChecks";
import type { GradingData } from "../../../lib/scouting/aeComponents";
import { COMPONENT_SPREAD_FLOOR, componentWeight } from "../../../lib/scouting/aeComponents";
import { formatRate } from "../../../lib/scouting/countComponents";
import { GT_MIN_PROSPECTS, GT_MIN_GARBAGE_PLAYS, ERA_CHECK_MIN_TAGGED } from "../../../lib/scouting/tagCorrection";
import { MIN_POOL, type CompositePos } from "../../../lib/scouting/aeComposite";
import type { ProspectGameRouteCellsRow } from "../../../lib/scouting/aggregateMerge";

interface Props {
  prospects: Prospect[];
  games: ScoutingGame[];
  qbPlays: QBPlay[];
  rbPlays: RBPlay[];
  tePlays: TEPlay[];
  gameRouteCells: ProspectGameRouteCellsRow[] | null;
  gradingData: GradingData;
  loading?: boolean;
}

const th = "px-2 py-1 text-left font-medium text-slate-500 whitespace-nowrap";
const td = "px-2 py-1 whitespace-nowrap text-slate-300";
const signed = (v: number, dp = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-sm font-semibold text-slate-200 mb-1">{title}</h3>
      <p className="text-xs text-slate-500 mb-2 max-w-3xl">{note}</p>
      <div className="overflow-x-auto rounded border border-slate-800">{children}</div>
    </section>
  );
}

function TagRows({ m }: { m: ModelCheck }) {
  const tests = new Map(m.tests.map((t) => [t.column, t]));
  return (
    <>
      {m.readiness.map((r) => {
        const t = tests.get(r.column);
        const on = Object.entries(r.onPlays).map(([b, n]) => (b === "on" ? `${n}` : `${b.toUpperCase()} ${n}`)).join(" · ");
        const status = r.enabled ? "On"
          : t ? (t.improves ? "Test passes: can be switched on" : "Test: no gain, stays off")
          : `Off: needs ${r.short}`;
        return (
          <tr key={`${m.key}-${r.column}`} className="border-t border-slate-800/60">
            <td className={td}>{m.label}</td>
            <td className={td}>{r.label}</td>
            <td className={`${td} text-right`}>{r.taggedPlays}</td>
            <td className={`${td} text-right`}>{on}</td>
            <td className={`${td} text-right`}>{r.prospects}</td>
            <td className={`${td} text-right`}>{t ? `${t.baseLoss.toFixed(4)} → ${t.withLoss.toFixed(4)}` : "—"}</td>
            <td className={`${td} text-right`}>{t ? Object.entries(t.effects).map(([b, v]) => `${b === "on" ? "" : `${b} `}${signed(v)}`).join(" · ") : "—"}</td>
            <td className={`${td} ${r.enabled ? "text-emerald-400" : t?.improves ? "text-amber-300" : "text-slate-500"}`}>{status}</td>
          </tr>
        );
      })}
    </>
  );
}

function eraCell(e: { n: number; mean: number; se: number | null } | undefined) {
  return e ? `${signed(e.mean, 1)} ±${e.se != null ? (2 * e.se).toFixed(1) : "—"} (${e.n})` : "—";
}

function ComponentRows({ pos, checks }: { pos: CompositePos; checks: ComponentCheck[] }) {
  return (
    <>
      {checks.map(({ result: r, spread, medianTrust }) => {
        const w = componentWeight(r.def.key);
        const source = r.def.source === "pff" ? "PFF" : r.def.source === "tag" ? "Tag" : "Your charting";
        const status = !(w > 0) ? "Shown only (weight 0)"
          : spread?.ready ? "Counting"
          : `Waits: ${spread?.qualified ?? 0}/${MIN_POOL} prospects`;
        return (
          <tr key={r.def.key} className="border-t border-slate-800/60">
            <td className={td}>{pos}</td>
            <td className={td} title={r.def.description}>{r.def.label}</td>
            <td className={td}>{source}</td>
            <td className={`${td} text-right`}>{w}</td>
            <td className={`${td} text-right`}>{spread?.qualified ?? 0}</td>
            <td className={`${td} text-right`}>{r.poolRate != null ? formatRate(r.def, r.poolRate) : "—"}</td>
            <td className={`${td} text-right`}>{spread?.tau != null ? `±${formatRate(r.def, spread.tau)}` : "—"}</td>
            <td className={`${td} text-right`}>{medianTrust != null ? `${Math.round(medianTrust * 100)}%` : "—"}</td>
            <td className={`${td} text-right`}>{r.measured ? `G5 ${formatRate(r.def, r.effects.G5 * r.def.scale)} (${r.tierProspects} players)` : `not yet (${r.tierProspects} players)`}</td>
            <td className={`${td} ${status === "Counting" ? "text-emerald-400" : "text-slate-500"}`}>{status}</td>
          </tr>
        );
      })}
    </>
  );
}

export default function GradingChecks({ prospects, games, qbPlays, rbPlays, tePlays, gameRouteCells, gradingData, loading }: Props) {
  const report = useMemo(
    () => buildGradingReport({ prospects, games, qbPlays, rbPlays, tePlays, gameRouteCells, gradingData }),
    [prospects, games, qbPlays, rbPlays, tePlays, gameRouteCells, gradingData],
  );
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  const POS: CompositePos[] = ["QB", "RB", "WR", "TE"];
  return (
    <div className="text-xs">
      <Section
        title="Difficulty tags (tag correction)"
        note="Each tag can only change how a TAGGED play is judged, on top of today's model; old plays are always judged as before. A tag stays off until there are enough tagged plays to test it held out by prospect, and is switched on only if the test shows lower held-out log loss with it."
      >
        <table className="min-w-full">
          <thead><tr>
            <th className={th}>Model</th><th className={th}>Tag</th><th className={`${th} text-right`}>Tagged plays</th>
            <th className={`${th} text-right`}>With tag</th><th className={`${th} text-right`}>Prospects</th>
            <th className={`${th} text-right`}>Held-out loss (today → with tag)</th><th className={`${th} text-right`}>Effect (log-odds)</th><th className={th}>Status</th>
          </tr></thead>
          <tbody>{report.models.map((m) => <TagRows key={m.key} m={m} />)}</tbody>
        </table>
      </Section>

      <Section
        title="Garbage time"
        note={`Should garbage-time plays count less in a prospect's sample? Tested held out by game once ${GT_MIN_PROSPECTS} prospects have ${GT_MIN_GARBAGE_PLAYS}+ tagged garbage-time plays and 2+ tagged games: the weight (0 = leave out, 1 = in full) that best predicts his other games wins.`}
      >
        <table className="min-w-full">
          <thead><tr>
            <th className={th}>Model</th><th className={`${th} text-right`}>Garbage-time plays</th><th className={`${th} text-right`}>Prospects</th>
            <th className={`${th} text-right`}>Best weight</th><th className={`${th} text-right`}>In use</th>
          </tr></thead>
          <tbody>{report.models.map((m) => (
            <tr key={m.key} className="border-t border-slate-800/60">
              <td className={td}>{m.label}</td>
              <td className={`${td} text-right`}>{m.garbage.garbagePlays}</td>
              <td className={`${td} text-right`}>{m.garbage.prospects}/{GT_MIN_PROSPECTS}</td>
              <td className={`${td} text-right`}>{m.garbage.best != null ? m.garbage.best : "not testable yet"}</td>
              <td className={`${td} text-right`}>{m.garbageWeight}</td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section
        title="Era scale check"
        note={`Average residual (actual − expected, pts; ±2 SE) of each era's plays under each model. If the tagged era drifts from the in-app one (beyond 2 SE, with ${ERA_CHECK_MIN_TAGGED}+ tagged plays), re-center it (RECENTER_TAGGED). Imported plays use the old press definition and whole-game WR import, so they're shown for reference.`}
      >
        <table className="min-w-full">
          <thead><tr>
            <th className={th}>Model</th><th className={`${th} text-right`}>Imported</th><th className={`${th} text-right`}>In-app</th>
            <th className={`${th} text-right`}>Tagged</th><th className={`${th} text-right`}>Tagged − in-app</th><th className={th}>Status</th>
          </tr></thead>
          <tbody>{report.models.map((m) => (
            <tr key={m.key} className="border-t border-slate-800/60">
              <td className={td}>{m.label}</td>
              <td className={`${td} text-right`}>{eraCell(m.eras.imported)}</td>
              <td className={`${td} text-right`}>{eraCell(m.eras.in_app)}</td>
              <td className={`${td} text-right`}>{eraCell(m.eras.tagged)}</td>
              <td className={`${td} text-right`}>{m.drift.drift != null ? `${signed(m.drift.drift, 1)} ±${(2 * (m.drift.se ?? 0)).toFixed(1)}` : "—"}</td>
              <td className={`${td} ${m.drift.flagged ? "text-amber-300" : "text-slate-500"}`}>
                {m.recentered ? "Re-centered" : m.drift.flagged ? "Drifted: re-center" : m.drift.enough ? "Level" : `Waits: ${m.eras.tagged?.n ?? 0}/${ERA_CHECK_MIN_TAGGED} tagged plays`}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section
        title="AE Score components"
        note={`Each counts only for prospects who have it, weighted by weight × his trust, so a player without one keeps his score as it was. A component joins once ${MIN_POOL} prospects clear its floor. Spread = the true spread across the pool (at least ${COMPONENT_SPREAD_FLOOR} × the observed spread, your call); trust = the median prospect's share of his number taken as real. Opponent = the lift a G5 opponent gives, measured within players and taken out.`}
      >
        <table className="min-w-full">
          <thead><tr>
            <th className={th}>Pos</th><th className={th}>Component</th><th className={th}>Source</th><th className={`${th} text-right`}>Weight</th>
            <th className={`${th} text-right`}>Prospects</th><th className={`${th} text-right`}>Pool</th><th className={`${th} text-right`}>Spread</th>
            <th className={`${th} text-right`}>Trust</th><th className={`${th} text-right`}>Opponent</th><th className={th}>Status</th>
          </tr></thead>
          <tbody>{POS.map((pos) => <ComponentRows key={pos} pos={pos} checks={report.components[pos]} />)}</tbody>
        </table>
      </Section>
    </div>
  );
}
