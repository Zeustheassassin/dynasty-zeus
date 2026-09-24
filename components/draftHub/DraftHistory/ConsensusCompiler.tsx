"use client";
import type { Dispatch, SetStateAction } from "react";

type ConsensusMeta = Record<string, {
  draftCount: number;
  leagueCount: number;
  connectedUserCount: number;
  compiledAt: string;
  locked: boolean;
}>;

interface ConsensusCompilerProps {
  selectedHistoryYear: string;
  supabaseUser: { id: string } | null;
  consensusMeta: ConsensusMeta;
  compiling: boolean;
  compileLog: string;
  compileProgress: number;
  showCompilePanel: boolean;
  setShowCompilePanel: Dispatch<SetStateAction<boolean>>;
  compileSelectedYears: Set<number>;
  setCompileSelectedYears: Dispatch<SetStateAction<Set<number>>>;
  runCompile: (years: number[]) => Promise<void>;
  clearYear: (year: number) => Promise<void>;
  setYearLocked: (year: number, locked: boolean) => Promise<void>;
}

export default function ConsensusCompiler({
  selectedHistoryYear,
  supabaseUser,
  consensusMeta,
  compiling,
  compileLog,
  compileProgress,
  showCompilePanel,
  setShowCompilePanel,
  compileSelectedYears,
  setCompileSelectedYears,
  runCompile,
  clearYear,
  setYearLocked,
}: ConsensusCompilerProps) {
  const hasMeta          = !!consensusMeta[selectedHistoryYear];
  const meta             = consensusMeta[selectedHistoryYear];
  // Calendar-year range (NOT NFL season-year): historical drafts are filed by the
  // calendar year they occurred. Spans 2020 → current calendar year.
  const YEAR_RANGE       = Array.from({ length: new Date().getFullYear() - 2020 + 1 }, (_, i) => 2020 + i);
  const ALL_COMPILED_YEARS = Object.keys(consensusMeta).map(Number).sort().reverse();
  const isLocked = (yr: number) => consensusMeta[String(yr)]?.locked === true;
  const selectedIsLocked = isLocked(Number(selectedHistoryYear));
  // A locked year can't be compiled, so counting it would make the button lie.
  const compilableSelection = Array.from(compileSelectedYears).filter((yr) => !isLocked(yr)).sort();

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Network Consensus</div>
          <div className="text-xs text-slate-400 mt-0.5">
            {hasMeta
              ? `${meta!.draftCount} rookie drafts · ${meta!.leagueCount} leagues · last compiled ${new Date(meta!.compiledAt).toLocaleDateString()}${selectedIsLocked ? " · locked" : ""}`
              : supabaseUser
                ? `No compiled data for ${selectedHistoryYear} yet.`
                : "Log in to compile a network consensus board."}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {supabaseUser && hasMeta && !compiling && (
            <button
              onClick={() => setYearLocked(Number(selectedHistoryYear), !selectedIsLocked)}
              title={selectedIsLocked
                ? `${selectedHistoryYear} is locked \u2014 it can't be recompiled or deleted. Click to unlock.`
                : `Lock ${selectedHistoryYear} so it can't be recompiled or deleted by accident.`}
              aria-pressed={selectedIsLocked}
              className={`text-xs px-3 py-1.5 rounded-lg transition font-medium border ${
                selectedIsLocked
                  ? "border-amber-600 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50"
                  : "border-slate-700 bg-slate-800 text-slate-400 hover:text-white hover:border-slate-600"
              }`}
            >
              {selectedIsLocked ? "🔒 Locked" : "🔓 Lock"}
            </button>
          )}
          {supabaseUser && !compiling && (
            <button
              onClick={() => setShowCompilePanel((v) => !v)}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg transition font-medium"
            >
              {showCompilePanel ? "Hide" : hasMeta ? "Recompile" : "Compile Now"}
            </button>
          )}
          {compiling && (
            <div className="flex items-center gap-1.5 text-xs text-blue-400">
              <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Compiling…
            </div>
          )}
        </div>
      </div>

      {/* Year selector + launch */}
      {showCompilePanel && !compiling && (
        <div className="mt-3 border-t border-slate-700 pt-3">
          <div className="text-xs text-slate-400 mb-2">
            Select years to compile. Existing data for each selected year will be replaced.
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {YEAR_RANGE.map((yr) => {
              const yrMeta = consensusMeta[String(yr)];
              const locked = isLocked(yr);
              const sel    = compileSelectedYears.has(yr) && !locked;
              return (
                <button
                  key={yr}
                  disabled={locked}
                  title={locked ? `${yr} is locked \u2014 unlock it on the ${yr} board to recompile.` : undefined}
                  onClick={() => setCompileSelectedYears((prev) => {
                    const next = new Set(prev);
                    if (next.has(yr)) next.delete(yr); else next.add(yr);
                    return next;
                  })}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition flex items-center gap-1 ${
                    locked
                      ? "border-amber-900/60 bg-amber-950/20 text-amber-700/80 cursor-not-allowed"
                      : sel
                        ? "border-blue-600 bg-blue-900/30 text-blue-300"
                        : "border-slate-700 bg-slate-800 text-slate-400"
                  }`}
                >
                  {locked && <span aria-hidden="true">🔒</span>}
                  {yr}
                  {yrMeta && !locked && (
                    <span className="text-[9px] text-emerald-400 font-semibold">✓{yrMeta.draftCount}d</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (!compilableSelection.length) return;
                setShowCompilePanel(false);
                runCompile(compilableSelection);
              }}
              disabled={compilableSelection.length === 0}
              className="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 py-1.5 rounded-lg transition font-semibold"
            >
              Compile {compilableSelection.length} year{compilableSelection.length !== 1 ? "s" : ""}
            </button>
            <button
              onClick={() => setCompileSelectedYears(new Set(YEAR_RANGE.filter((yr) => !isLocked(yr))))}
              className="text-xs text-slate-400 hover:text-white transition"
            >
              Select all
            </button>
            <button
              onClick={() => setCompileSelectedYears(new Set())}
              className="text-xs text-slate-400 hover:text-white transition"
            >
              Clear
            </button>
          </div>

          {ALL_COMPILED_YEARS.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-700/60">
              <div className="text-xs text-slate-500 mb-2">Delete stored data for a year:</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_COMPILED_YEARS.map((yr) => (
                  isLocked(yr) ? (
                    <span
                      key={yr}
                      title={`${yr} is locked \u2014 unlock it before deleting.`}
                      className="text-[10px] px-2 py-0.5 rounded border border-amber-900/60 bg-amber-950/20 text-amber-700/80 cursor-not-allowed"
                    >
                      🔒 {yr}
                    </span>
                  ) : (
                    <button
                      key={yr}
                      onClick={() => {
                        if (!window.confirm(`Delete all compiled ${yr} consensus data? This cannot be undone.`)) return;
                        clearYear(yr);
                      }}
                      className="text-[10px] px-2 py-0.5 rounded border border-red-900/60 bg-red-950/30 text-red-400 hover:bg-red-900/50 transition"
                    >
                      Delete {yr}
                    </button>
                  )
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Progress bar + log */}
      {compiling && (
        <div className="mt-3">
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mb-1.5">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${compileProgress}%` }}
            />
          </div>
          <div className="text-[11px] text-slate-400 truncate">{compileLog}</div>
        </div>
      )}
    </div>
  );
}
