"use client";
// Draft Hub → League Formats (stage 9 of the 2026-11-26 scouting plan): every
// league's format in one table, plus how many leagues share each setting, so
// positional value can be decided per league. Read off the league list the
// app already loads (lib/helpers/leagueFormat.ts): no Sleeper calls, nothing
// stored. A value that differs from the most common one stands out.

import { useMemo, useState } from "react";
import type { SleeperLeague } from "../../lib/types";
import {
  FORMAT_FIELDS, formatSummary, formatValue, leagueFormat, lineupText, usualFormat, type FormatField, type LeagueFormat,
} from "../../lib/helpers/leagueFormat";

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

export default function LeagueFormatsTab({ leagues }: Props) {
  const all = useMemo(() => leagues.map(leagueFormat), [leagues]);
  const hasOthers = all.some((f) => f.kind !== "Dynasty");
  const [dynastyOnly, setDynastyOnly] = useState(true);
  const formats = useMemo(() => (hasOthers && dynastyOnly ? all.filter((f) => f.kind === "Dynasty") : all), [all, hasOthers, dynastyOnly]);
  const summary = useMemo(() => formatSummary(formats), [formats]);
  const usual = useMemo(() => usualFormat(summary), [summary]);

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
    <div className="max-w-6xl mx-auto text-sm">
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
            </tr>
          </thead>
          <tbody>
            {formats.map((f) => (
              <tr key={f.leagueId} className="border-t border-slate-800">
                <td className="px-2 py-1 text-slate-200">
                  {f.name}
                  {f.bestBall && <span className="ml-1.5 rounded border border-slate-700 px-1 text-[10px] text-slate-400">Best ball</span>}
                </td>
                {hasOthers && !dynastyOnly && <td className="px-2 py-1 text-slate-400">{f.kind}</td>}
                <td className="px-2 py-1 text-slate-400 whitespace-nowrap">{lineupText(f)}</td>
                {FORMAT_FIELDS.map(({ key }) => cell(f, key))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
