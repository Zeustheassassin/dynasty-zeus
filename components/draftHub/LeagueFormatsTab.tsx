"use client";
// Draft Hub → League Formats (stage 9 of the 2026-11-26 scouting plan): every
// league's format in one table, plus how many leagues share each setting, so
// positional value can be decided per league. Read off the league list the
// app already loads (lib/helpers/leagueFormat.ts): no Sleeper calls, nothing
// stored. A value that differs from the most common one stands out.
//
// Positional value (stage 1 of the 2026-11-27 plan): each league's QB / RB /
// WR / TE multiplier against the user's usual format, from lineup math on the
// last three NFL seasons (lib/helpers/positionalValue.ts; the seasons from
// /api/nfl-season-lines, nflverse; hooks/useLeaguePositionalValues.ts). The
// Rookie Big Board's league picker sorts by the same numbers (stage 2).

import { useMemo, useState } from "react";
import type { SleeperLeague } from "../../lib/types";
import {
  FORMAT_FIELDS, formatSummary, formatValue, lineupText, usualFormat, type FormatField, type LeagueFormat,
} from "../../lib/helpers/leagueFormat";
import { LINE_POSITIONS, uncountedScoringKeys, type LinePos } from "../../lib/helpers/nflSeasonLines";
import {
  MIN_GAMES, VALUE_DEPTH, type FormatValue, type LeagueValue, type ValueFormat,
} from "../../lib/helpers/positionalValue";
import { formatRule } from "../../lib/helpers/scoring";
import { useLeaguePositionalValues } from "../../hooks/useLeaguePositionalValues";

interface Props {
  leagues: readonly SleeperLeague[];
}

const FIELD_TITLE: Record<FormatField, string> = {
  teams: "Teams in the league",
  qb: "SF = a superflex slot · 2QB = two QB slots · 1QB",
  starters: "Starting slots (bench, IR and taxi aside)",
  wr: "WR slots",
  flex: "Flex slots without superflex: FLEX, WR/RB and WR/TE",
  ppr: "Points per reception",
  tep: "TE premium: extra points per TE reception",
  passTd: "Points per passing TD",
  ppc: "Points per carry",
  firstDown: "Points per rushing / receiving first down",
  rookieRounds: "Rounds in each rookie draft",
};

const pct = (share: number) => `${Math.round(share * 100)}%`;
const ppg = (v: number) => v.toFixed(1);

/** One position's line in the usual format: "QB 24 start (12 in SF) · replacement 13.2 pts/g · 23%". */
function homeLine(pos: LinePos, v: FormatValue[LinePos]): string {
  const flex = v.inFlex ? ` (${v.inFlex} in ${pos === "QB" ? "superflex" : "flex"})` : "";
  return `${pos} ${v.starters} start${flex} · replacement ${ppg(v.replacement)} pts/g · ${pct(v.share)} of starting value`;
}

function valueTitle(pos: LinePos, v: LeagueValue): string {
  const l = v.league[pos], h = v.home[pos];
  const flex = l.inFlex ? ` (${l.inFlex} in flex)` : "";
  return `${pos} here: ${l.starters} start${flex}, replacement ${ppg(l.replacement)} pts/g, ${pct(l.share)} of starting value.\n`
    + `Your usual format: ${h.starters} start, replacement ${ppg(h.replacement)} pts/g, ${pct(h.share)}.`;
}

function ValueCell({ pos, value }: { pos: LinePos; value: LeagueValue | undefined }) {
  if (!value) return <td className="px-2 py-1 text-right text-slate-600">…</td>;
  const m = value.mult[pos];
  if (m == null) return <td className="px-2 py-1 text-right text-slate-600" title={`Your usual format gives ${pos}s no starting value`}>—</td>;
  const tone = m >= 1.05 ? "text-teal-300 font-semibold" : m <= 0.95 ? "text-rose-300 font-semibold" : "text-slate-400";
  return <td className={`px-2 py-1 text-right tabular-nums ${tone}`} title={valueTitle(pos, value)}>×{m.toFixed(2)}</td>;
}

function PositionalValueSection({ home, homeValue, leagueCount, seasons, error, onRetry }: {
  home: ValueFormat | null;
  homeValue: FormatValue | null;
  leagueCount: number;
  seasons: number[];
  error: string | null;
  onRetry: () => void;
}) {
  const span = seasons.length ? `${seasons[0]}–${seasons[seasons.length - 1]}` : "";
  return (
    <section aria-label="Positional value" className="mb-4 rounded border border-slate-800 p-3 text-xs">
      <h3 className="mb-2 font-semibold text-slate-200">Positional value per league</h3>
      {home && (
        <p className="mb-1 text-slate-300">
          Your usual format: {home.teams} teams · {lineupText(home)} · PPR {home.scoring.rec ?? 0} · TEP {home.scoring.bonus_rec_te ?? 0} · pass TD {home.scoring.pass_td ?? 0}
        </p>
      )}
      <p className="mb-2 text-slate-500">
        PPR, half-point TE premium and 4-point passing TDs are set as you named them; the lineup, the team count and every other scoring rule
        are the most common across your {leagueCount} dynasty league{leagueCount === 1 ? "" : "s"}.
        {home && !home.slots.SUPER_FLEX && (home.slots.QB ?? 0) < 2 && (
          <span className="text-amber-300"> That lineup has no superflex, though your board is built for one.</span>
        )}
      </p>
      {error ? (
        <p className="text-rose-300">
          {error}{" "}
          <button onClick={onRetry} className="ml-1 rounded bg-slate-800 px-2 py-0.5 text-slate-200 hover:bg-slate-700">Retry</button>
        </p>
      ) : !homeValue ? (
        <p className="text-slate-500">Reading the {span} NFL seasons (nflverse)…</p>
      ) : (
        <>
          <ul className="mb-2 space-y-0.5 text-slate-400">
            {LINE_POSITIONS.map((pos) => <li key={pos}>{homeLine(pos, homeValue[pos])}</li>)}
          </ul>
          <p className="text-slate-500">
            Each league&apos;s number is a position&apos;s share of starting value there against its share in your usual format: ×1.10 = worth 10% more there,
            compared with the other positions. From the real {span} NFL seasons (nflverse: every QB, RB, WR and TE with {MIN_GAMES}+ games), scored with
            that league&apos;s own rules; every lineup filled with the best player left; starting value = the top {VALUE_DEPTH} at a position, points per
            game above the first one who doesn&apos;t start. Hover a number for its starters and replacement. The Rookie Big Board&apos;s league picker
            sorts by them.
          </p>
        </>
      )}
    </section>
  );
}

export default function LeagueFormatsTab({ leagues }: Props) {
  const { formats: all, dynasty, home, values, seasons, error, retry } = useLeaguePositionalValues(leagues);
  const hasOthers = all.some((f) => f.kind !== "Dynasty");
  const [dynastyOnly, setDynastyOnly] = useState(true);
  const formats = useMemo(() => (hasOthers && dynastyOnly ? all.filter((f) => f.kind === "Dynasty") : all), [all, hasOthers, dynastyOnly]);
  const summary = useMemo(() => formatSummary(formats), [formats]);
  const usual = useMemo(() => usualFormat(summary), [summary]);
  // The usual format comes from the dynasty leagues whatever the checkbox says (all of them if there are none).

  if (all.length === 0) {
    return <p className="text-sm text-slate-500 text-center py-12">No leagues loaded yet.</p>;
  }

  const cell = (f: LeagueFormat, key: FormatField) => {
    const v = formatValue(f, key);
    const odd = usual[key] != null && v !== usual[key];
    return (
      <td key={key} className={`px-2 py-1 text-right tabular-nums ${odd ? "text-amber-300 font-semibold" : "text-slate-400"}`}
        title={odd ? `Most of your leagues: ${usual[key]}` : undefined}>
        {v}
      </td>
    );
  };

  return (
    <div className="max-w-7xl mx-auto text-sm">
      <p className="text-xs text-slate-400 text-center mb-3">
        Each league&apos;s format from the league list the app already loads (no extra Sleeper calls, nothing saved). Values that differ
        from most of your leagues are highlighted. The scouting board stays tape-only; this is for deciding positional value per league.
      </p>
      {hasOthers && (
        <div className="flex justify-center mb-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={dynastyOnly} onChange={(e) => setDynastyOnly(e.target.checked)} className="accent-blue-500" />
            Dynasty leagues only ({all.filter((f) => f.kind === "Dynasty").length} of {all.length})
          </label>
        </div>
      )}

      <section aria-label="Formats across your leagues" className="mb-4 rounded border border-slate-800 p-3">
        <h3 className="mb-2 text-xs font-semibold text-slate-200">{formats.length} league{formats.length === 1 ? "" : "s"}</h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {FORMAT_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex gap-2" title={FIELD_TITLE[key]}>
              <dt className="w-20 shrink-0 text-slate-500">{label}</dt>
              <dd className="text-slate-300">
                {summary[key].map((c) => `${c.value} ×${c.leagues}`).join(" · ")}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <PositionalValueSection home={home} homeValue={values?.home ?? null} leagueCount={dynasty.length} seasons={seasons} error={error} onRetry={retry} />

      <div className="overflow-x-auto rounded border border-slate-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-900 text-slate-500">
              <th className="px-2 py-1.5 text-left font-medium">League</th>
              {hasOthers && !dynastyOnly && <th className="px-2 py-1.5 text-left font-medium">Type</th>}
              <th className="px-2 py-1.5 text-left font-medium">Lineup</th>
              {FORMAT_FIELDS.map(({ key, label }) => (
                <th key={key} className="px-2 py-1.5 text-right font-medium" title={FIELD_TITLE[key]}>{label}</th>
              ))}
              {LINE_POSITIONS.map((pos) => (
                <th key={pos} className="px-2 py-1.5 text-right font-medium" title={`${pos} value against your usual format`}>{pos} ×</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {formats.map((f) => {
              const uncounted = uncountedScoringKeys(f.scoring);
              return (
                <tr key={f.leagueId} className="border-t border-slate-800">
                  <td className="px-2 py-1 text-slate-200">
                    {f.name}
                    {f.bestBall && <span className="ml-1.5 rounded border border-slate-700 px-1 text-[10px] text-slate-400">Best ball</span>}
                    {uncounted.length > 0 && (
                      <span className="ml-1.5 rounded border border-amber-800 px-1 text-[10px] text-amber-300"
                        title={`Not in the value numbers (the NFL stats can't rebuild them): ${uncounted.map((k) => `${formatRule(k)} ${f.scoring[k]}`).join(", ")}`}>
                        {uncounted.length} rule{uncounted.length === 1 ? "" : "s"} not counted
                      </span>
                    )}
                  </td>
                  {hasOthers && !dynastyOnly && <td className="px-2 py-1 text-slate-400">{f.kind}</td>}
                  <td className="px-2 py-1 text-slate-400 whitespace-nowrap">{lineupText(f)}</td>
                  {FORMAT_FIELDS.map(({ key }) => cell(f, key))}
                  {LINE_POSITIONS.map((pos) => <ValueCell key={pos} pos={pos} value={values?.byLeague.get(f.leagueId)} />)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
