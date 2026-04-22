"use client";
import type { Dispatch, SetStateAction } from "react";

type ConsensusMeta = Record<string, {
  draftCount: number;
  leagueCount: number;
  connectedUserCount: number;
  compiledAt: string;
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
}: ConsensusCompilerProps) {
  const hasMeta          = !!consensusMeta[selectedHistoryYear];
  const meta             = consensusMeta[selectedHistoryYear];
  const YEAR_RANGE       = Array.from({ length: new Date().getFullYear() - 2020 }, (_, i) => 2020 + i);
  const ALL_COMPILED_YEARS = Object.keys(consensusMeta).map(Number).sort().reverse();

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4 mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Network Consensus</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {hasMeta
              ? `${meta!.draftCount} rookie drafts · ${meta!.leagueCount} leagues · last compiled ${new Date(meta!.compiledAt).toLocaleDateString()}`
              : supabaseUser
                ? `No compiled data for ${selectedHistoryYear} yet.`
                : "Log in to compile a network consensus board."}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {supabaseUser && !compiling && (
            <button
              onClick={() => setShowCompilePanel((v) => !v)}
              className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg transition font-medium"
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
        <div className="mt-3 border-t border-gray-700 pt-3">
          <div className="text-xs text-gray-400 mb-2">
            Select years to compile. Existing data for each selected year will be replaced.
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {YEAR_RANGE.map((yr) => {
              const yrMeta = consensusMeta[String(yr)];
              const sel    = compileSelectedYears.has(yr);
              return (
                <button
                  key={yr}
                  onClick={() => setCompileSelectedYears((prev) => {
                    const next = new Set(prev);
                    if (next.has(yr)) next.delete(yr); else next.add(yr);
                    return next;
                  })}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition flex items-center gap-1 ${
                    sel
                      ? "border-blue-600 bg-blue-900/30 text-blue-300"
                      : "border-gray-700 bg-gray-800 text-gray-400"
                  }`}
                >
                  {yr}
                  {yrMeta && (
                    <span className="text-[9px] text-green-400 font-semibold">✓{yrMeta.draftCount}d</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const years = Array.from(compileSelectedYears).sort();
                if (!years.length) return;
                setShowCompilePanel(false);
                runCompile(years);
              }}
              disabled={compileSelectedYears.size === 0}
              className="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-1.5 rounded-lg transition font-semibold"
            >
              Compile {compileSelectedYears.size} year{compileSelectedYears.size !== 1 ? "s" : ""}
            </button>
            <button
              onClick={() => setCompileSelectedYears(new Set(YEAR_RANGE))}
              className="text-xs text-gray-400 hover:text-white transition"
            >
              Select all
            </button>
            <button
              onClick={() => setCompileSelectedYears(new Set())}
              className="text-xs text-gray-400 hover:text-white transition"
            >
              Clear
            </button>
          </div>

          {ALL_COMPILED_YEARS.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-700/60">
              <div className="text-xs text-gray-500 mb-2">Delete stored data for a year:</div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_COMPILED_YEARS.map((yr) => (
                  <button
                    key={yr}
                    onClick={() => clearYear(yr)}
                    className="text-[10px] px-2 py-0.5 rounded border border-red-900/60 bg-red-950/30 text-red-400 hover:bg-red-900/50 transition"
                  >
                    Delete {yr}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Progress bar + log */}
      {compiling && (
        <div className="mt-3">
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-1.5">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${compileProgress}%` }}
            />
          </div>
          <div className="text-[11px] text-gray-400 truncate">{compileLog}</div>
        </div>
      )}
    </div>
  );
}
