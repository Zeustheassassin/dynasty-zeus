"use client";
import { useState, useMemo } from "react";
import type { Prospect, ProspectWithStats, ChartingDecision } from "../../lib/types";

type SortKey = "personal_rank" | "name" | "school" | "total_routes" | "draft_class_year";

function SortBtn({ label, k, sortKey, sortDir, onToggle }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onToggle: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <button
      onClick={() => onToggle(k)}
      className={`px-3 py-1 rounded text-xs font-medium transition ${
        active ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
      }`}
    >
      {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </button>
  );
}

interface Props {
  prospects: ProspectWithStats[];
  loading: boolean;
  onSelectProspect: (p: Prospect) => void;
  onAddProspect: (data: Omit<Prospect, "id" | "user_id" | "created_at" | "updated_at">) => Promise<void>;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
}

const DECISION_DOT: Record<ChartingDecision, string> = {
  fully_charted: "bg-green-500",
  partial_chart: "bg-blue-400",
  charting: "bg-yellow-400",
  pending: "bg-orange-400",
  not_charting: "bg-red-500",
};

const DECISION_LABEL: Record<ChartingDecision, string> = {
  fully_charted: "Fully Charted",
  partial_chart: "Partial Chart",
  charting: "Charting",
  pending: "Pending",
  not_charting: "Not Charting",
};

export default function ProspectList({
  prospects,
  loading,
  onSelectProspect,
  onAddProspect,
  draftYearFilter,
  setDraftYearFilter,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("personal_rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    school: "",
    conference: "",
    position: "WR",
    draft_class_year: 2026,
  });

  const years = useMemo(() => {
    const s = new Set(prospects.map((p) => p.draft_class_year));
    return Array.from(s).sort((a, b) => a - b);
  }, [prospects]);

  const filtered = useMemo(() => {
    let list = draftYearFilter
      ? prospects.filter((p) => p.draft_class_year === draftYearFilter)
      : prospects;
    list = [...list].sort((a, b) => {
      let va: string | number = 0;
      let vb: string | number = 0;
      if (sortKey === "name") { va = a.name; vb = b.name; }
      else if (sortKey === "school") { va = a.school; vb = b.school; }
      else if (sortKey === "personal_rank") { va = a.personal_rank ?? 9999; vb = b.personal_rank ?? 9999; }
      else if (sortKey === "total_routes") { va = a.total_routes; vb = b.total_routes; }
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

  async function handleAdd() {
    if (!form.name.trim()) return;
    setSaving(true);
    await onAddProspect({
      name: form.name.trim(),
      school: form.school.trim(),
      conference: form.conference.trim(),
      position: form.position,
      draft_class_year: form.draft_class_year,
      height: "",
      weight: null,
      birthday: null,
      personal_rank: null,
      pff_rank: null,
      mock_draft_rank: null,
      drafttek_rank: null,
      pfn_rank: null,
      should_play: "",
      will_play_pre: "",
      will_play_post: "",
      charting_decision: "pending",
      charting_notes: "",
    });
    setForm({ name: "", school: "", conference: "", position: "WR", draft_class_year: 2026 });
    setShowAdd(false);
    setSaving(false);
  }


  return (
    <div>
      {/* Draft year + add controls */}
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
        {years.map((y) => (
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
        <SortBtn label="Rank" k="personal_rank" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        <SortBtn label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        <SortBtn label="School" k="school" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        <SortBtn label="Routes" k="total_routes" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
        <SortBtn label="Draft Yr" k="draft_class_year" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
      </div>

      {/* Add prospect form */}
      {showAdd && (
        <div className="mb-4 p-4 bg-gray-900 border border-gray-700 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <input
              className="col-span-2 md:col-span-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="Player Name *"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="School"
              value={form.school}
              onChange={(e) => setForm((f) => ({ ...f, school: e.target.value }))}
            />
            <input
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="Conference"
              value={form.conference}
              onChange={(e) => setForm((f) => ({ ...f, conference: e.target.value }))}
            />
            <select
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
            >
              {["WR", "RB", "TE", "QB"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              value={form.draft_class_year}
              onChange={(e) => setForm((f) => ({ ...f, draft_class_year: Number(e.target.value) }))}
            >
              {[2026, 2027, 2028, 2029].map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving || !form.name.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded font-medium transition"
            >
              {saving ? "Saving…" : "Add Prospect"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Prospect rows */}
      {loading ? (
        <div className="text-gray-500 text-sm py-10 text-center">Loading prospects…</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-500 text-sm py-10 text-center">
          No prospects yet. Click &quot;Add Prospect&quot; to get started.
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectProspect(p)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-600 rounded-lg transition text-left group"
            >
              <span
                className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${DECISION_DOT[p.charting_decision]}`}
                title={p.charting_decision}
              />
              <span className="text-sm font-medium text-white min-w-0 truncate">{p.name}</span>
              <span className="text-xs text-gray-400 truncate hidden sm:block">{p.school}</span>
              <span className="text-xs text-gray-600 hidden md:block">{p.position}</span>
              <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                {p.total_routes > 0 && (
                  <span className="text-xs text-blue-400">{p.total_routes} routes</span>
                )}
                {p.total_games > 0 && (
                  <span className="text-xs text-gray-500">{p.total_games}G</span>
                )}
                {p.personal_rank && (
                  <span className="text-xs text-gray-500">#{p.personal_rank}</span>
                )}
                <span className="text-xs text-gray-700">{p.draft_class_year}</span>
                <span className="text-gray-600 group-hover:text-gray-300 text-xs">›</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="mt-5 flex flex-wrap gap-4 text-xs text-gray-500">
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
