"use client";
import { useState, useMemo } from "react";
import { supabase } from "../../../lib/supabaseclient";
import type { Prospect, ProspectWithStats, ChartingDecision, CoverageStat, TEBlockStat } from "../../../lib/types";

type TECoverageKey = "man" | "zone" | "press" | "double";
type TEBlockKey = "inline" | "movement";
const BLOCK_COLS: { key: TEBlockKey; label: string }[] = [
  { key: "inline",   label: "Inline" },
  { key: "movement", label: "Move" },
];
import { useRecruitIndex } from "../../../hooks/useRecruitIndex";
import { lookupConference } from "../../../lib/scouting/schoolConferences";
import { BASE_YEAR, CLASS_YEARS } from "../../../lib/helpers/season";
import RecruitStarBadge from "../RecruitStarBadge";

type SortKey = "personal_rank" | "name" | "school" | "draft_class_year";

function SortBtn({ label, k, sortKey, sortDir, onToggle }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onToggle: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <button
      onClick={() => onToggle(k)}
      className={`px-3 py-1 rounded text-xs font-medium transition ${
        active ? "bg-green-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
      }`}
    >
      {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </button>
  );
}

interface Props {
  prospects: ProspectWithStats[];
  gameCountByProspect: Record<string, number>;
  coverageStatsByProspect: Map<string, Record<TECoverageKey, CoverageStat>>;
  blockStatsByProspect: Map<string, Record<TEBlockKey, TEBlockStat>>;
  loading: boolean;
  onSelectProspect: (p: Prospect) => void;
  onAddProspect: (data: Omit<Prospect, "id" | "user_id" | "created_at" | "updated_at">) => Promise<void>;
  onDataChanged: () => void;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
}

const DECISION_DOT: Record<ChartingDecision, string> = {
  fully_charted: "bg-emerald-500",
  partial_chart: "bg-blue-400",
  charting: "bg-amber-400",
  pending: "bg-orange-400",
  not_charting: "bg-red-500",
};

const DECISION_LABEL: Record<ChartingDecision, string> = {
  fully_charted: "Fully Charted",
  partial_chart: "Partial Chart",
  charting: "Charting",
  pending: "Undecided",
  not_charting: "Not Charting",
};

export default function TEProspectList({
  prospects,
  gameCountByProspect,
  coverageStatsByProspect,
  blockStatsByProspect,
  loading,
  onSelectProspect,
  onAddProspect,
  onDataChanged,
  draftYearFilter,
  setDraftYearFilter,
}: Props) {
  const { matchProspect } = useRecruitIndex();
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("personal_rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", school: "", conference: "", draft_class_year: BASE_YEAR });

  const years = useMemo(() => {
    const s = new Set(prospects.map((p) => p.draft_class_year));
    return Array.from(s).sort((a, b) => a - b);
  }, [prospects]);

  const filtered = useMemo(() => {
    let list = draftYearFilter ? prospects.filter((p) => p.draft_class_year === draftYearFilter) : prospects;
    list = [...list].sort((a, b) => {
      let va: string | number = 0, vb: string | number = 0;
      if (sortKey === "name") { va = a.name; vb = b.name; }
      else if (sortKey === "school") { va = a.school; vb = b.school; }
      else if (sortKey === "personal_rank") { va = a.personal_rank ?? 9999; vb = b.personal_rank ?? 9999; }
      else if (sortKey === "draft_class_year") { va = a.draft_class_year; vb = b.draft_class_year; }
      if (typeof va === "string")
        return sortDir === "asc" ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === "asc" ? va - (vb as number) : (vb as number) - va;
    });
    return list;
  }, [prospects, draftYearFilter, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  async function deleteProspect(id: string) {
    await supabase.from("prospects").delete().eq("id", id);
    setConfirmDeleteId(null);
    onDataChanged();
  }

  async function handleAdd() {
    const trimmedName = form.name.trim();
    if (!trimmedName) return;
    const dup = prospects.find((p) => p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    if (dup) {
      const detail = `${dup.school || "no school"}, class of ${dup.draft_class_year}`;
      if (!window.confirm(`A TE prospect named "${dup.name}" already exists (${detail}). Add anyway?`)) return;
    }
    setSaving(true);
    await onAddProspect({
      name: form.name.trim(),
      school: form.school.trim(),
      conference: form.conference.trim(),
      position: "TE",
      draft_class_year: form.draft_class_year,
      height: "", weight: null, birthday: null,
      personal_rank: null, pff_rank: null, mock_draft_rank: null,
      drafttek_rank: null, pfn_rank: null,
      draft_round: null, draft_pick: null, draft_team: null,
      should_play: "", will_play_pre: "", will_play_post: "",
      charting_decision: "pending", charting_notes: "", overall_rank: null,
    });
    setForm({ name: "", school: "", conference: "", draft_class_year: BASE_YEAR });
    setShowAdd(false);
    setSaving(false);
  }

  return (
    <div>
      {/* Class filter + add */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm text-slate-400">Class:</span>
        <button
          onClick={() => setDraftYearFilter(null)}
          className={`px-3 py-1 rounded text-xs font-medium transition ${!draftYearFilter ? "bg-green-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
        >All</button>
        {years.map((y) => (
          <button key={y} onClick={() => setDraftYearFilter(y)}
            className={`px-3 py-1 rounded text-xs font-medium transition ${draftYearFilter === y ? "bg-green-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >{y}</button>
        ))}
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="ml-auto px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm rounded font-medium transition"
        >+ Add Prospect</button>
      </div>

      {/* Sort */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="text-xs text-slate-500 self-center">Sort:</span>
        <SortBtn label="Rank" k="personal_rank" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        <SortBtn label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        <SortBtn label="School" k="school" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        <SortBtn label="Draft Yr" k="draft_class_year" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="mb-4 p-4 bg-slate-900 border border-slate-700 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <input className="col-span-2 md:col-span-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:border-green-500"
              placeholder="Player Name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <input className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:border-green-500"
              placeholder="School" value={form.school}
              onChange={(e) => setForm((f) => ({ ...f, school: e.target.value }))}
              onBlur={() => {
                if (form.conference.trim() === "") {
                  const auto = lookupConference(form.school);
                  if (auto) setForm((f) => ({ ...f, conference: auto }));
                }
              }} />
            <input className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:border-green-500"
              placeholder="Conference" value={form.conference} onChange={(e) => setForm((f) => ({ ...f, conference: e.target.value }))} />
            <select className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:border-green-500"
              value={form.draft_class_year} onChange={(e) => setForm((f) => ({ ...f, draft_class_year: Number(e.target.value) }))}>
              {CLASS_YEARS.map((y) => <option key={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving || !form.name.trim()}
              className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded font-medium transition">
              {saving ? "Saving…" : "Add Prospect"}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition">Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-slate-500 text-sm py-10 text-center">Loading prospects…</div>
      ) : filtered.length === 0 ? (
        <div className="text-slate-500 text-sm py-10 text-center">No TE prospects yet. Click &quot;Add Prospect&quot; to get started.</div>
      ) : (
        <div className="space-y-1">
          {filtered.map((p) => {
            const games = gameCountByProspect[p.id] ?? 0;
            const covStats = coverageStatsByProspect.get(p.id);
            const blkStats = blockStatsByProspect.get(p.id);
            const hasCovStats = !!covStats && (["man", "press", "zone"] as const).some((k) => covStats[k].count > 0);
            const hasBlkStats = !!blkStats && BLOCK_COLS.some((c) => blkStats[c.key].count > 0);
            return (
              <div key={p.id} onClick={() => { setConfirmDeleteId(null); onSelectProspect(p); }}
                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-600 rounded-lg transition text-left group cursor-pointer"
              >
                <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${DECISION_DOT[p.charting_decision]}`} title={p.charting_decision} />
                <span className="text-sm font-medium text-white min-w-0 truncate">{p.name}</span>
                <span className="text-xs text-slate-400 truncate hidden sm:block">{p.school}</span>
                <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                  <span className="w-20 flex justify-center">
                    <RecruitStarBadge recruit={matchProspect({ name: p.name, position: p.position, draft_class_year: p.draft_class_year })} />
                  </span>
                  {(hasCovStats || hasBlkStats) && (
                    <div className="hidden md:flex items-center gap-3 text-[10px] whitespace-nowrap">
                      {hasCovStats && (["man", "press", "zone"] as const).map((cov) => {
                        const s = covStats![cov];
                        return (
                          <div key={cov} className="flex flex-col items-center">
                            <span className="text-slate-500 capitalize">
                              {cov} <span className="text-slate-300 font-medium">
                                {s.count > 0 ? `${Math.round((s.open / s.count) * 100)}%` : "—"}
                              </span>
                            </span>
                            <span className="text-slate-600">{s.count > 0 ? `${s.open}/${s.count}` : "—"}</span>
                          </div>
                        );
                      })}
                      {hasBlkStats && BLOCK_COLS.map(({ key, label }) => {
                        const s = blkStats![key];
                        return (
                          <div key={key} className="flex flex-col items-center">
                            <span className="text-slate-500">
                              {label} <span className="text-slate-300 font-medium">
                                {s.count > 0 ? `${Math.round((s.success / s.count) * 100)}%` : "—"}
                              </span>
                            </span>
                            <span className="text-slate-600">{s.count > 0 ? `${s.success}/${s.count}` : "—"}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {games > 0 && <span className="text-xs text-green-400">{games}G</span>}
                  {p.personal_rank && <span className="text-xs text-slate-500">#{p.personal_rank}</span>}
                  <span className="text-xs text-slate-700">{p.draft_class_year}</span>
                  <span className="text-slate-600 group-hover:text-slate-300 text-xs">›</span>
                  {confirmDeleteId === p.id ? (
                    <button onClick={(e) => { e.stopPropagation(); deleteProspect(p.id); }}
                      className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white text-xs rounded transition flex-shrink-0">
                      Delete?
                    </button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(p.id); }}
                      className="text-slate-600 hover:text-red-400 text-xs px-1 flex-shrink-0 transition"
                      title="Delete prospect"
                      aria-label={`Delete ${p.name}`}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-500">
        {(Object.entries(DECISION_DOT) as [ChartingDecision, string][]).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${v}`} />
            {DECISION_LABEL[k]}
          </span>
        ))}
      </div>
    </div>
  );
}
