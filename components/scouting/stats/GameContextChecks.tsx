"use client";
// Analysis → Grading checks: the Game context section (tape-grading
// expansion, Stage 5; lib/scouting/contextChecks.ts). For every headline AE
// and AE Score component: what it's judged against today (opponent tiers or
// opponent defense SP+, weather), and the held-out tests behind that,
// rerun on the current data. A switch in contextGrading.ts is flipped only
// when its test passes: lower held-out error, most folds, and (the slow part,
// on the button) better than 95% of shuffles. Supporting cast is tested and
// shown, never applied (the user's call).
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { Prospect, QBPlay, RBPlay, ScoutingGame, TEPlay } from "../../../lib/types";
import type { GradingData } from "../../../lib/scouting/aeComponents";
import type { ProspectGameRouteCellsRow } from "../../../lib/scouting/aggregateMerge";
import { buildContextReport, contextMetrics, contextPValues, type ContextCheck, type ContextPValues } from "../../../lib/scouting/contextChecks";
import { CONTEXT_TEST_MIN_PROSPECTS, PERMUTATION_P, PERMUTATIONS } from "../../../lib/scouting/contextEffects";
import { FLAG_TEST_MIN_PROSPECTS } from "../../../lib/scouting/gameFlags";
import { MIN_POOL, type CompositePos } from "../../../lib/scouting/aeComposite";

interface Props {
  prospects: Prospect[];
  games: ScoutingGame[];
  qbPlays: QBPlay[];
  rbPlays: RBPlay[];
  tePlays: TEPlay[];
  gameRouteCells: ProspectGameRouteCellsRow[] | null;
  gradingData: GradingData;
}

const th = "px-2 py-1 text-left font-medium text-slate-500 whitespace-nowrap";
const td = "px-2 py-1 whitespace-nowrap text-slate-300";
const pct = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`);
const pv = (p: number | null | undefined) => (p == null ? "" : ` · p ${p.toFixed(3)}`);
const POS: CompositePos[] = ["QB", "RB", "WR", "TE"];

function Section({ title, note, children }: { title: string; note: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="text-sm font-semibold text-slate-200 mb-1">{title}</h3>
      <div className="text-xs text-slate-500 mb-2 max-w-3xl">{note}</div>
      <div className="overflow-x-auto rounded border border-slate-800">{children}</div>
    </section>
  );
}

function inUse(c: ContextCheck): string {
  const parts = [c.opponent === "sp" ? "Opp. defense SP+" : "Opponent tiers"];
  if (c.weatherOn) parts.push("weather");
  return parts.join(" + ");
}

function effects(c: ContextCheck): string {
  if (!c.applied.length) return "—";
  return c.applied.map((a) => `${a.label} ${a.effect >= 0 ? "+" : ""}${a.effect.toFixed(Math.abs(a.effect) < 0.1 ? 3 : 2)} per ${a.unit}`).join(" · ");
}

export default function GameContextChecks(props: Props) {
  const { prospects, games, qbPlays, rbPlays, tePlays, gameRouteCells, gradingData } = props;
  const report = useMemo(
    () => buildContextReport({ prospects, games, qbPlays, rbPlays, tePlays, gameRouteCells, gradingData }),
    [prospects, games, qbPlays, rbPlays, tePlays, gameRouteCells, gradingData],
  );
  const [pvals, setPvals] = useState<Map<string, ContextPValues>>(new Map());
  const [running, setRunning] = useState<string | null>(null);
  const cancel = useRef(false);

  // The chance checks: slow (PERMUTATIONS shuffles per input), one metric per tick.
  const runChance = useCallback(async () => {
    cancel.current = false;
    const { metrics, cc } = contextMetrics({ prospects, games, qbPlays, rbPlays, tePlays, gameRouteCells, gradingData });
    const testable = new Set(report.metrics.filter((c) => c.testable).map((c) => c.key));
    const out = new Map<string, ContextPValues>();
    for (const m of metrics) {
      if (cancel.current) break;
      if (!testable.has(m.key)) continue;
      setRunning(m.label);
      await new Promise((r) => setTimeout(r, 0));
      out.set(m.key, contextPValues(m, cc));
      setPvals(new Map(out));
    }
    setRunning(null);
  }, [prospects, games, qbPlays, rbPlays, tePlays, gameRouteCells, gradingData, report]);

  const cov = report.coverage;
  return (
    <div>
      <Section
        title="Game context"
        note={
          <>
            <p>
              Context filled: opponent {cov.opponent} · weather {cov.weather} · supporting cast {cov.cast} of {cov.games} charted games
              (Scouting → PFF Links fills it). Each input is measured within players (how his own games move with it), held out by prospect
              (5 folds, {CONTEXT_TEST_MIN_PROSPECTS}+ prospects with 2+ games). Improvement = share of the held-out game-to-game error it
              removes. An input goes into the score only when it predicts better than the simpler model, in most folds, and better than
              {` ${Math.round((1 - PERMUTATION_P) * 100)}%`} of {PERMUTATIONS} runs with it shuffled across games (p ≤ {PERMUTATION_P}; the
              button below). SP+ replaces the tiers only where it also beats the tiers. Supporting cast is tested but never applied: a
              same-game grade rises with the whole offense, partly because of him (your call).
            </p>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-slate-800">
          <button
            onClick={() => void runChance()}
            disabled={running != null}
            className="rounded border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40"
          >
            {running ? "Running…" : "Run the chance checks"}
          </button>
          {running && (
            <>
              <span className="text-slate-400" aria-live="polite">Testing {running}…</span>
              <button onClick={() => { cancel.current = true; }} className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">Stop</button>
            </>
          )}
          <span className="text-slate-600">Takes a few seconds.</span>
        </div>
        <table className="min-w-full text-xs">
          <thead><tr>
            <th className={th}>Pos</th><th className={th}>Metric</th><th className={`${th} text-right`}>Prospects</th>
            <th className={`${th} text-right`}>Tiers</th><th className={`${th} text-right`}>Opp. D SP+</th>
            <th className={`${th} text-right`}>+ Weather</th><th className={`${th} text-right`}>+ Cast (shown only)</th>
            <th className={th}>In the score</th><th className={th}>Effect applied</th>
          </tr></thead>
          <tbody>
            {POS.flatMap((pos) => report.metrics.filter((c) => c.pos === pos)).map((c) => {
              const p = pvals.get(c.key);
              return (
                <tr key={c.key} className="border-t border-slate-800/60">
                  <td className={td}>{c.pos}</td>
                  <td className={td}>{c.label}</td>
                  <td className={`${td} text-right`}>{c.testable ? c.prospects : `${c.prospects}/${CONTEXT_TEST_MIN_PROSPECTS}`}</td>
                  <td className={`${td} text-right`}>{pct(c.tier)}</td>
                  <td className={`${td} text-right ${c.spBeatsTier && (c.sp ?? 0) > 0 ? "text-emerald-300" : ""}`} title={c.spBeatsTier ? "Beats the tiers held out" : "Doesn't beat the tiers held out"}>
                    {pct(c.sp)}{pv(p?.sp)}
                  </td>
                  <td className={`${td} text-right`}>{pct(c.weather)}{pv(p?.weather)}</td>
                  <td className={`${td} text-right text-slate-400`} title={c.castLabel}>{pct(c.cast)}{pv(p?.cast)}</td>
                  <td className={`${td} ${c.opponent === "sp" || c.weatherOn ? "text-emerald-400" : "text-slate-500"}`}>{inUse(c)}</td>
                  <td className={`${td} text-slate-400`}>{effects(c)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section
        title="Left early and played hurt"
        note={`Should a game he left early, or played hurt, count less? Tested per headline AE once ${FLAG_TEST_MIN_PROSPECTS} prospects have a flagged game and 2+ others: the weight (0 = leave out, 1 = in full) that best predicts his other games. In use now: left early ×${report.leftEarlyWeight}, played hurt ×${report.playedHurtWeight}.`}
      >
        <table className="min-w-full text-xs">
          <thead><tr>
            <th className={th}>Metric</th><th className={`${th} text-right`}>Left early: games / prospects</th><th className={`${th} text-right`}>Best weight</th>
            <th className={`${th} text-right`}>Played hurt: games / prospects</th><th className={`${th} text-right`}>Best weight</th>
          </tr></thead>
          <tbody>{report.flags.map((f) => (
            <tr key={f.key} className="border-t border-slate-800/60">
              <td className={td}>{f.label}</td>
              <td className={`${td} text-right`}>{f.leftEarly.flaggedGames} / {f.leftEarly.prospects}</td>
              <td className={`${td} text-right`}>{f.leftEarly.best ?? `waits (${f.leftEarly.prospects}/${FLAG_TEST_MIN_PROSPECTS})`}</td>
              <td className={`${td} text-right`}>{f.playedHurt.flaggedGames} / {f.playedHurt.prospects}</td>
              <td className={`${td} text-right`}>{f.playedHurt.best ?? `waits (${f.playedHurt.prospects}/${FLAG_TEST_MIN_PROSPECTS})`}</td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section
        title="Trait grades"
        note={`Your 1–10 grades on new games. They sit beside the AE Score; the Big Board's "With traits" toggle adds the uncovered ones, each counting once ${MIN_POOL} prospects at the position are graded.`}
      >
        <table className="min-w-full text-xs">
          <thead><tr><th className={th}>Pos</th><th className={`${th} text-right`}>Graded games</th><th className={`${th} text-right`}>Prospects</th></tr></thead>
          <tbody>{POS.map((pos) => (
            <tr key={pos} className="border-t border-slate-800/60">
              <td className={td}>{pos}</td>
              <td className={`${td} text-right`}>{report.traits[pos].games}</td>
              <td className={`${td} text-right`}>{report.traits[pos].prospects}/{MIN_POOL}</td>
            </tr>
          ))}</tbody>
        </table>
      </Section>
    </div>
  );
}
