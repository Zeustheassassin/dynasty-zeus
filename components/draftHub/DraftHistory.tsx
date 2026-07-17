"use client";
import type { SleeperLeague, SleeperUser } from "../../lib/types";
import { useDraftHistory } from "./DraftHistory/hooks/useDraftHistory";
import LeagueTab from "./DraftHistory/LeagueTab";
import ConsensusTab from "./DraftHistory/ConsensusTab";
import MyPicksTab from "./DraftHistory/MyPicksTab";
import GradesTab from "./DraftHistory/GradesTab";
import EmptyState from "../ui/EmptyState";

interface DraftHistoryProps {
  leagues: SleeperLeague[];
  user: SleeperUser | null;
}

export default function DraftHistory({ leagues, user }: DraftHistoryProps) {
  const {
    historyLoading,
    historyLoaded,
    historyData,
    historyTab,
    setHistoryTab,
    selectedHistoryYear,
    setSelectedHistoryYear,
    myPicksSort,
    setMyPicksSort,
    consensusMeta,
    consensusCache,
    consensusHistory,
    loadingCacheYear,
    compiling,
    compileLog,
    compileProgress,
    showCompilePanel,
    setShowCompilePanel,
    compileSelectedYears,
    setCompileSelectedYears,
    playerGrades,
    supabaseUser,
    players,
    pickFcValues,
    calcFcValues,
    selectedLeagueName,
    availableYears,
    filteredDrafts,
    currentLeagueDraft,
    consensusList,
    riserFallerList,
    myPicksList,
    gradeReport,
    runCompile,
    removeCompiledPlayer,
    clearYear,
    setGrade,
  } = useDraftHistory(leagues, user);

  return (
    <div className="max-w-3xl lg:max-w-5xl mx-auto">
      {/* Header + year filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-semibold">Historical Rookie Drafts</h2>
          <p className="text-sm text-slate-400 mt-0.5">Past rookie draft classes by year.</p>
        </div>
        {availableYears.length > 0 && (
          <select
            value={selectedHistoryYear}
            onChange={(e) => setSelectedHistoryYear(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-sm text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
          >
            {availableYears.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
          </select>
        )}
      </div>

      {/* Loading */}
      {historyLoading && (
        <div className="flex items-center gap-3 text-sm text-blue-400 py-8">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Loading past draft data…
        </div>
      )}

      {/* Empty */}
      {!historyLoading && historyLoaded && historyData.length === 0 && (
        <EmptyState>
          No completed rookie drafts found in your leagues&apos; history. This may be your leagues&apos; first season.
        </EmptyState>
      )}

      {/* Content */}
      {!historyLoading && (filteredDrafts.length > 0 || !!consensusMeta[selectedHistoryYear]) && (
        <>
          {/* Sub-tabs */}
          <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1 mb-5 w-fit">
            {([
              { key: "LEAGUE",    label: "League Board" },
              { key: "CONSENSUS", label: "Consensus Board" },
              { key: "MY_PICKS",  label: "My Draft Picks" },
              { key: "GRADES",    label: "Pick Slot Grades" },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setHistoryTab(t.key)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
                  historyTab === t.key ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── League Board ── */}
          {historyTab === "LEAGUE" && (
            <LeagueTab
              currentLeagueDraft={currentLeagueDraft}
              user={user}
              selectedHistoryYear={selectedHistoryYear}
              selectedLeagueName={selectedLeagueName}
              pickFcValues={pickFcValues}
            />
          )}

          {/* ── Consensus Board ── */}
          {historyTab === "CONSENSUS" && (
            <ConsensusTab
              selectedHistoryYear={selectedHistoryYear}
              supabaseUser={supabaseUser}
              consensusMeta={consensusMeta}
              consensusCache={consensusCache}
              consensusHistory={consensusHistory}
              loadingCacheYear={loadingCacheYear}
              compiling={compiling}
              compileLog={compileLog}
              compileProgress={compileProgress}
              showCompilePanel={showCompilePanel}
              setShowCompilePanel={setShowCompilePanel}
              compileSelectedYears={compileSelectedYears}
              setCompileSelectedYears={setCompileSelectedYears}
              playerGrades={playerGrades}
              filteredDrafts={filteredDrafts}
              consensusList={consensusList}
              riserFallerList={riserFallerList}
              players={players}
              pickFcValues={pickFcValues}
              calcFcValues={calcFcValues}
              runCompile={runCompile}
              removeCompiledPlayer={removeCompiledPlayer}
              clearYear={clearYear}
              setGrade={setGrade}
            />
          )}

          {/* ── My Draft Picks ── */}
          {historyTab === "MY_PICKS" && (
            <MyPicksTab
              myPicksList={myPicksList}
              filteredDrafts={filteredDrafts}
              selectedHistoryYear={selectedHistoryYear}
              myPicksSort={myPicksSort}
              setMyPicksSort={setMyPicksSort}
              pickFcValues={pickFcValues}
            />
          )}

          {/* ── Pick Slot Grades ── */}
          {historyTab === "GRADES" && (
            <GradesTab gradeReport={gradeReport} />
          )}
        </>
      )}
    </div>
  );
}
