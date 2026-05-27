"use client";
import { useState, useMemo, useEffect, startTransition } from "react";
import dynamic from "next/dynamic";
import { supabase } from "../../../lib/supabaseclient";
import type { Prospect, ProspectWithStats, ChartingDecision } from "../../../lib/types";
import { useRecruitIndex } from "../../../hooks/useRecruitIndex";
import { lookupConference } from "../../../lib/scouting/schoolConferences";
import { BASE_YEAR, CLASS_YEARS } from "../../../lib/helpers/season";
import RecruitStarBadge from "../RecruitStarBadge";

const QBChartingBoard  = dynamic(() => import("./QBChartingBoard"),   { ssr: false });
const ProspectRosterSheet = dynamic(() => import("../ProspectRosterSheet"), { ssr: false });

const QB_NFL_ROLES = ["Franchise QB", "Starter", "Bridge", "Backup", ""];

const DECISION_DOT: Record<ChartingDecision, string> = {
  fully_charted: "bg-green-500",
  partial_chart: "bg-blue-400",
  charting:      "bg-yellow-400",
  pending:       "bg-orange-400",
  not_charting:  "bg-red-500",
};

export interface QBHubProps {
  prospectsWithStats: ProspectWithStats[];
  loading: boolean;
  onAddProspect: (data: Omit<Prospect, "id" | "user_id" | "created_at" | "updated_at">) => Promise<void>;
  onDataChanged: () => void;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
  navigateToProspect?: Prospect | null;
  onNavigated?: () => void;
}

type HubView = "list" | "roster";
type SortKey = "personal_rank" | "name" | "school" | "draft_class_year";

export default function QBHub({
  prospectsWithStats,
  loading,
  onAddProspect,
  onDataChanged,
  draftYearFilter,
  setDraftYearFilter,
  navigateToProspect,
  onNavigated,
}: QBHubProps) {
  const { matchProspect } = useRecruitIndex();
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);

  useEffect(() => {
    if (navigateToProspect) {
      startTransition(() => { setSelectedProspect(navigateToProspect); });
      onNavigated?.();
    }
  }, [navigateToProspect, onNavigated]);
  const [hubView, setHubView]   = useState<HubView>("list");
  const [sortKey, setSortKey]   = useState<SortKey>("personal_rank");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("asc");
  const [showAdd, setShowAdd]   = useState(false);
  const [newProspect, setNewProspect] = useState({
    name: "", school: "", conference: "", draft_class_year: BASE_YEAR,
    position: "QB", personal_rank: "" as string | number,
  });
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const qbProspects = useMemo(
    () => prospectsWithStats.filter((p) => p.position === "QB"),
    [prospectsWithStats],
  );

  const filtered = useMemo(() => {
    const base = draftYearFilter ? qbProspects.filter((p) => p.draft_class_year === draftYearFilter) : qbProspects;
    return [...base].sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0;
      if (sortKey === "personal_rank") { av = a.personal_rank ?? 9999; bv = b.personal_rank ?? 9999; }
      else if (sortKey === "name")     { av = a.name ?? ""; bv = b.name ?? ""; }
      else if (sortKey === "school")   { av = a.school ?? ""; bv = b.school ?? ""; }
      else if (sortKey === "draft_class_year") { av = a.draft_class_year ?? 9999; bv = b.draft_class_year ?? 9999; }
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [qbProspects, draftYearFilter, sortKey, sortDir]);

  const draftYears = useMemo(
    () => [...new Set(qbProspects.map((p) => p.draft_class_year).filter(Boolean))].sort() as number[],
    [qbProspects],
  );

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  async function deleteProspect(id: string) {
    await supabase.from("prospects").delete().eq("id", id);
    setConfirmDeleteId(null);
    onDataChanged();
  }

  async function addProspect() {
    const trimmedName = newProspect.name.trim();
    if (!trimmedName || !newProspect.school.trim()) {
      setAddError("Name and school are required.");
      return;
    }
    const dup = qbProspects.find((p) => p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    if (dup) {
      const detail = `${dup.school || "no school"}, class of ${dup.draft_class_year}`;
      if (!window.confirm(`A QB prospect named "${dup.name}" already exists (${detail}). Add anyway?`)) return;
    }
    setAddError(null);
    await onAddProspect({
      name: newProspect.name.trim(),
      school: newProspect.school.trim(),
      conference: newProspect.conference.trim(),
      draft_class_year: newProspect.draft_class_year,
      position: "QB",
      personal_rank: newProspect.personal_rank !== "" ? Number(newProspect.personal_rank) : null,
      height: "", weight: null, birthday: null,
      should_play: "", will_play_pre: "", will_play_post: "",
      charting_decision: "pending",
      charting_notes: "", overall_rank: null,
      pff_rank: null, mock_draft_rank: null, drafttek_rank: null, pfn_rank: null,
      draft_round: null, draft_pick: null, draft_team: null, synopsis: null,
    });
    setNewProspect({ name: "", school: "", conference: "", draft_class_year: BASE_YEAR, position: "QB", personal_rank: "" });
    setShowAdd(false);
  }

  if (selectedProspect) {
    return (
      <QBChartingBoard
        prospect={selectedProspect}
        onBack={() => { setSelectedProspect(null); onDataChanged(); }}
        onDataChanged={onDataChanged}
      />
    );
  }

  return (
    <div>
      {/* Inner tab bar */}
      <div className="flex gap-1 mb-5 border-b border-gray-800">
        {(["list", "roster"] as HubView[]).map((v) => (
          <button
            key={v}
            onClick={() => { if (v === "list" && hubView === "roster") onDataChanged(); setHubView(v); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              hubView === v ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {v === "list" ? "Prospects" : "Prospect Data"}
          </button>
        ))}
      </div>

      {hubView === "list" && (
        <div>
          {/* Class filter + add button (matches WR/RB/TE layout) */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-sm text-gray-400">Class:</span>
            <button
              onClick={() => setDraftYearFilter(null)}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                !draftYearFilter ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              All
            </button>
            {draftYears.map((y) => (
              <button
                key={y}
                onClick={() => setDraftYearFilter(y)}
                className={`px-3 py-1 rounded text-xs font-medium transition ${
                  draftYearFilter === y ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {y}
              </button>
            ))}
            <button
              onClick={() => setShowAdd((s) => !s)}
              className="ml-auto px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-medium transition"
            >
              + Add Prospect
            </button>
          </div>

          {/* Sort controls */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="text-xs text-gray-500 self-center">Sort:</span>
            {(["personal_rank", "name", "school", "draft_class_year"] as SortKey[]).map((k) => {
              const labels: Record<SortKey, string> = { personal_rank: "Rank", name: "Name", school: "School", draft_class_year: "Draft Yr" };
              return (
                <button key={k} onClick={() => toggleSort(k)}
                  className={`px-3 py-1 rounded text-xs font-medium transition ${
                    sortKey === k ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}>
                  {labels[k]} {sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </button>
              );
            })}
          </div>

          {/* Add form */}
          {showAdd && (
            <div className="mb-4 p-4 bg-gray-900 border border-gray-700 rounded-lg">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <input className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="Name *" value={newProspect.name} onChange={(e) => setNewProspect((n) => ({ ...n, name: e.target.value }))} />
                <input className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="School *" value={newProspect.school}
                  onChange={(e) => setNewProspect((n) => ({ ...n, school: e.target.value }))}
                  onBlur={() => {
                    if (newProspect.conference.trim() === "") {
                      const auto = lookupConference(newProspect.school);
                      if (auto) setNewProspect((n) => ({ ...n, conference: auto }));
                    }
                  }} />
                <input className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="Conference" value={newProspect.conference} onChange={(e) => setNewProspect((n) => ({ ...n, conference: e.target.value }))} />
                <input type="number" className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="Personal Rank" value={newProspect.personal_rank}
                  onChange={(e) => setNewProspect((n) => ({ ...n, personal_rank: e.target.value }))} />
                <select className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                  value={newProspect.draft_class_year} onChange={(e) => setNewProspect((n) => ({ ...n, draft_class_year: Number(e.target.value) }))}>
                  {CLASS_YEARS.map((y) => <option key={y}>{y}</option>)}
                </select>
              </div>
              {addError && <p className="text-red-400 text-xs mb-2">{addError}</p>}
              <div className="flex gap-2">
                <button onClick={addProspect}
                  className="px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded transition font-medium">
                  Add
                </button>
                <button onClick={() => setShowAdd(false)}
                  className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-gray-500 text-sm text-center py-12">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-12">
              No QB prospects found. Click &quot;+ Add Prospect&quot; to add one.
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-600 rounded-lg transition text-left group cursor-pointer"
                  onClick={() => { setConfirmDeleteId(null); setSelectedProspect(p); }}
                >
                  <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${DECISION_DOT[p.charting_decision ?? "pending"]}`} title={p.charting_decision} />
                  <span className="text-sm font-medium text-white min-w-0 truncate">{p.name}</span>
                  <span className="text-xs text-gray-400 truncate hidden sm:block">
                    {p.school}{p.conference ? ` · ${p.conference}` : ""}
                  </span>
                  <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                    <span className="w-20 flex justify-center">
                      <RecruitStarBadge recruit={matchProspect({ name: p.name, position: p.position, draft_class_year: p.draft_class_year })} />
                    </span>
                    {p.total_games > 0 && <span className="text-xs text-blue-400">{p.total_games}G</span>}
                    {p.personal_rank && <span className="text-xs text-gray-500">#{p.personal_rank}</span>}
                    <span className="text-xs text-gray-700">{p.draft_class_year}</span>
                    <span className="text-gray-600 group-hover:text-gray-300 text-xs">›</span>
                    {confirmDeleteId === p.id ? (
                      <button onClick={(e) => { e.stopPropagation(); deleteProspect(p.id); }}
                        className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white text-xs rounded transition flex-shrink-0">
                        Delete?
                      </button>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(p.id); }}
                        className="text-gray-600 hover:text-red-400 text-xs px-1 flex-shrink-0 transition"
                        title="Delete prospect"
                        aria-label={`Delete ${p.name}`}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hubView === "roster" && (
        <ProspectRosterSheet
          prospects={qbProspects}
          nflRoles={QB_NFL_ROLES}
          onDataChanged={onDataChanged}
        />
      )}
    </div>
  );
}
