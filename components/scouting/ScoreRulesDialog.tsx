"use client";
// Big Board → Rules (stage 7 of the 2026-11-26 scouting plan): every piece of
// one position's AE Score, Dynasty Score and Dynasty+, with its size and
// whether it's on, built from the code's constants (lib/scouting/scoreRules.ts).
// Not per player. The Big Board's sliders are the only live input.

import { useMemo } from "react";
import type { CompositePos } from "../../lib/scouting/aeComposite";
import type { DynastyWeights } from "../../lib/scouting/dynastyScore";
import { scoreRules } from "../../lib/scouting/scoreRules";
import { POS_COLOR } from "../../lib/uiTheme";

interface Props {
  pos: CompositePos;
  weights: DynastyWeights;
  onClose: () => void;
}

export default function ScoreRulesDialog({ pos, weights, onClose }: Props) {
  const sections = useMemo(() => scoreRules(pos, weights), [pos, weights]);
  const titleId = `score-rules-${pos}`;
  const counts = sections.flatMap((s) => s.rules);
  const on = counts.filter((r) => r.on).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        onClick={(e) => e.stopPropagation()}
        className="my-6 w-full max-w-4xl rounded-2xl border border-slate-700 bg-slate-900 p-5 text-xs shadow-2xl"
      >
        <div className="mb-3 flex items-baseline gap-3">
          <h2 id={titleId} className="text-sm font-semibold text-white">
            <span className={POS_COLOR[pos] ?? ""}>{pos}</span> score rules
          </h2>
          <span className="text-slate-500">{on} of {counts.length} pieces on · sizes before the sliders · from the code&apos;s constants</span>
          <button autoFocus onClick={onClose} className="ml-auto rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:border-slate-500 hover:text-white">
            Close
          </button>
        </div>
        {sections.map((s) => (
          <section key={s.key} aria-label={s.title} className="mb-4">
            <h3 className="mb-0.5 text-[13px] font-semibold text-slate-200">{s.title}</h3>
            <p className="mb-1.5 max-w-3xl text-slate-500">{s.note}</p>
            <table className="w-full border-collapse">
              <thead className="sr-only">
                <tr><th>Piece</th><th>Size</th><th>State</th></tr>
              </thead>
              <tbody>
                {s.rules.map((r) => (
                  <tr key={r.key} className={`border-t border-slate-800 align-top ${r.on ? "" : "opacity-60"}`}>
                    <td className="w-56 py-1 pr-3">
                      <div className="font-medium text-slate-100">{r.label}</div>
                      <div className="text-[11px] text-slate-500">{r.detail}</div>
                    </td>
                    <td className="w-64 py-1 pr-3 tabular-nums text-slate-300">{r.size}</td>
                    <td className="py-1">
                      <span className={`mr-1.5 rounded border px-1 text-[10px] font-semibold ${r.on ? "border-emerald-700 text-emerald-400" : "border-slate-700 text-slate-500"}`}>
                        {r.on ? "On" : "Off"}
                      </span>
                      {r.state && <span className="text-slate-400">{r.state}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
