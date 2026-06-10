"use client";
import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseclient";
import { lookupConference } from "../../lib/scouting/schoolConferences";
import { classYearOptionsWith } from "../../lib/helpers/season";
import { reorderRanksWithinClass } from "../../lib/scouting/rankReorder";
import { logger } from "../../lib/logger";
import type { ProspectWithStats, ChartingDecision } from "../../lib/types";

const log = logger("ProspectRosterSheet");

const CHARTING_DECISIONS: { value: ChartingDecision; label: string }[] = [
  { value: "fully_charted", label: "Fully Charted" },
  { value: "partial_chart", label: "Partial Chart" },
  { value: "charting",      label: "Charting" },
  { value: "pending",       label: "Undecided" },
  { value: "not_charting",  label: "Not Charting" },
];

interface RowState {
  school: string;
  conference: string;
  height: string;
  weight: number | null;
  birthday: string | null;
  draft_class_year: number;
  should_play: string;
  charting_decision: ChartingDecision;
  charting_notes: string;
}

interface ColumnSizes {
  school: number;
  conference: number;
  height: number;
}

interface RosterRowProps {
  p: ProspectWithStats;
  nflRoles: string[];
  sizes: ColumnSizes;
  /** Effective rank for this prospect (parent-owned, reflects pending reorders). */
  rank: number | null;
  /** Commit a new rank for this prospect; the parent re-sequences the position. */
  onRankCommit: (raw: string) => void;
}

function RosterRow({ p, nflRoles, sizes, rank, onRankCommit }: RosterRowProps) {
  const [local, setLocal] = useState<RowState>({
    school: p.school,
    conference: p.conference,
    height: p.height,
    weight: p.weight,
    birthday: p.birthday,
    draft_class_year: p.draft_class_year,
    should_play: p.should_play,
    charting_decision: p.charting_decision,
    charting_notes: p.charting_notes,
  });
  const [saving, setSaving] = useState(false);
  // The rank input is controlled by the parent-owned `rank` prop while not being
  // edited, so a reorder updates every sibling row live. `rankEdit` holds the
  // in-progress text only while the field is focused (no effect/resync needed).
  const [rankEdit, setRankEdit] = useState<string | null>(null);

  async function saveFields(changes: Partial<RowState>) {
    setSaving(true);
    await supabase
      .from("prospects")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    setSaving(false);
  }

  // No w-full — width comes from `size` attribute (text/number) or browser default (date/select).
  const inp = "bg-transparent text-white text-xs px-1 py-0.5 focus:outline-none focus:bg-gray-800/80 rounded";
  // Same as `inp` plus spinner-button removal so number inputs aren't padded by browser-default arrows.
  const inpNum = "bg-transparent text-white text-xs px-1 py-0.5 focus:outline-none focus:bg-gray-800/80 rounded [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
  const sel = "bg-gray-950 text-white text-xs px-1 py-0.5 focus:outline-none focus:bg-gray-800 rounded cursor-pointer";
  const inpFull = "w-full bg-transparent text-white text-xs px-1 py-0.5 focus:outline-none focus:bg-gray-800/80 rounded min-w-0";
  const tdShrink = "py-1 px-1.5 whitespace-nowrap";

  return (
    <tr className={`border-b border-gray-800/60 hover:bg-gray-900/40 transition ${saving ? "opacity-50" : ""}`}>
      {/* Name — sticky */}
      <td className="py-2 px-3 text-sm font-medium text-white whitespace-nowrap sticky left-0 bg-gray-950 z-10 border-r border-gray-800">
        {p.name}
      </td>

      <td className={tdShrink}>
        <input className={inp} size={sizes.school} value={local.school}
          onChange={(e) => setLocal((l) => ({ ...l, school: e.target.value }))}
          onBlur={() => {
            // If the conference is empty, try to autofill it from the school name.
            const auto = local.conference.trim() === "" ? lookupConference(local.school) : null;
            if (auto) {
              setLocal((l) => ({ ...l, conference: auto }));
              saveFields({ school: local.school, conference: auto });
            } else {
              saveFields({ school: local.school });
            }
          }} />
      </td>

      <td className={tdShrink}>
        <input className={inp} size={sizes.conference} value={local.conference}
          onChange={(e) => setLocal((l) => ({ ...l, conference: e.target.value }))}
          onBlur={() => saveFields({ conference: local.conference })} />
      </td>

      <td className={tdShrink}>
        <input className={inp} size={sizes.height} value={local.height}
          onChange={(e) => setLocal((l) => ({ ...l, height: e.target.value }))}
          onBlur={() => saveFields({ height: local.height })} />
      </td>

      <td className={tdShrink}>
        <input type="number" className={inpNum} size={4} value={local.weight ?? ""}
          onChange={(e) => setLocal((l) => ({ ...l, weight: e.target.value ? Number(e.target.value) : null }))}
          onBlur={() => saveFields({ weight: local.weight })} />
      </td>

      <td className={tdShrink}>
        <input type="date" className={inp} value={local.birthday ?? ""}
          onChange={(e) => {
            const v = e.target.value || null;
            setLocal((l) => ({ ...l, birthday: v }));
            saveFields({ birthday: v });
          }} />
      </td>

      <td className={tdShrink}>
        <select className={sel} value={local.draft_class_year}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLocal((l) => ({ ...l, draft_class_year: v }));
            saveFields({ draft_class_year: v });
          }}>
          {classYearOptionsWith(local.draft_class_year).map((y) => <option key={y}>{y}</option>)}
        </select>
      </td>

      <td className={tdShrink}>
        <select className={sel} value={local.charting_decision}
          onChange={(e) => {
            const v = e.target.value as ChartingDecision;
            setLocal((l) => ({ ...l, charting_decision: v }));
            saveFields({ charting_decision: v });
          }}>
          {CHARTING_DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </td>

      <td className={tdShrink}>
        <input type="number" className={inpNum} size={4} aria-label={`Rank for ${p.name}`}
          value={rankEdit ?? (rank ?? "")}
          onFocus={() => setRankEdit(rank != null ? String(rank) : "")}
          onChange={(e) => setRankEdit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onBlur={() => { const v = rankEdit ?? ""; setRankEdit(null); onRankCommit(v); }} />
      </td>

      <td className={tdShrink}>
        <select className={sel} value={local.should_play}
          onChange={(e) => {
            setLocal((l) => ({ ...l, should_play: e.target.value }));
            saveFields({ should_play: e.target.value });
          }}>
          {nflRoles.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
        </select>
      </td>

      {/* Notes — elastic, fills remaining width */}
      <td className="py-1 px-1.5">
        <input className={inpFull} value={local.charting_notes}
          onChange={(e) => setLocal((l) => ({ ...l, charting_notes: e.target.value }))}
          onBlur={() => saveFields({ charting_notes: local.charting_notes })} />
      </td>
    </tr>
  );
}

type SortKey = "name" | "draft_class_year" | "personal_rank";

interface Props {
  prospects: ProspectWithStats[];
  nflRoles: string[];
  onDataChanged?: () => void;
}

// Shrink-to-content: width: 1px + white-space: nowrap forces the column to its content width.
const thShrink = "text-left py-2 px-2 font-medium whitespace-nowrap";
const shrinkStyle = { width: "1px" } as const;

export default function ProspectRosterSheet({ prospects, nflRoles, onDataChanged }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("personal_rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  // Optimistic overrides for personal_rank after a reorder. Lives in the parent
  // so all rows share one source of truth (each RosterRow keeps its own local
  // copy of its other fields and never re-syncs from props, so rank can't live
  // there). An entry present here wins over the prop value; only filled on edit.
  const [rankOverride, setRankOverride] = useState<Map<string, number | null>>(() => new Map());
  const [rankError, setRankError] = useState<string | null>(null);

  // When a real data reload arrives (onDataChanged → the hub re-fetches and the
  // `prospects` prop identity changes), the optimistic overrides are obsolete:
  // the fresh props already carry our persisted ranks. Drop them so the props
  // become the source of truth again and can't be masked by a stale override.
  // Render-phase reset (React's "adjust state when a prop changes" pattern) —
  // intentionally NOT a useEffect, which would trip react-set-state-in-effect.
  const [prevProspects, setPrevProspects] = useState(prospects);
  if (prospects !== prevProspects) {
    setPrevProspects(prospects);
    setRankOverride(new Map());
  }

  // Effective rank = optimistic override (if any) else the persisted value.
  const effectiveRank = (p: ProspectWithStats): number | null =>
    rankOverride.has(p.id) ? rankOverride.get(p.id)! : p.personal_rank;

  async function commitRank(prospectId: string, raw: string) {
    const mover = prospects.find((p) => p.id === prospectId);
    if (!mover) return;
    const trimmed = raw.trim();
    const target = trimmed === "" ? null : Number(trimmed);
    // personal_rank is a ladder per (position, draft class). The hub already
    // filtered to one position; scope to the mover's draft class so the reorder
    // matches the Big Board editor and never disturbs another class's ranks.
    const items = prospects.map((p) => ({
      id: p.id,
      rank: effectiveRank(p),
      draftClass: p.draft_class_year,
    }));
    const changes = reorderRanksWithinClass(items, prospectId, target);
    if (changes.size === 0) return;

    // Optimistically apply so every affected row re-renders immediately.
    setRankOverride((prev) => {
      const next = new Map(prev);
      for (const [id, r] of changes) next.set(id, r);
      return next;
    });
    setRankError(null);

    // Persist the minimal diff. These rows already exist, so independent updates
    // are safe; last-write-wins per row converges for a single editor.
    const results = await Promise.all(
      [...changes].map(([id, r]) =>
        supabase
          .from("prospects")
          .update({ personal_rank: r, updated_at: new Date().toISOString() })
          .eq("id", id),
      ),
    );
    const failed = results.filter((res) => res.error);
    if (failed.length > 0) {
      log.error("rank reorder persist failed", {
        prospectId,
        failed: failed.length,
        first: failed[0]?.error?.message,
      });
      setRankError("Couldn't save the new order — reloaded from the server.");
      // Resync from the database so the UI never lies about what was saved.
      setRankOverride(new Map());
      onDataChanged?.();
    }
  }

  async function autofillConferences() {
    const updates = prospects
      .map((p) => ({ id: p.id, current: p.conference, conf: lookupConference(p.school) }))
      .filter((u): u is { id: string; current: string; conf: string } =>
        u.conf !== null && u.conf !== u.current
      );
    if (updates.length === 0) {
      alert("Nothing to update — all recognized schools already have the right conference.");
      return;
    }
    if (!window.confirm(
      `Overwrite the Conference field for ${updates.length} prospect(s) using the school→conference map? Manual entries that don't match will be replaced.`
    )) return;
    setBulkSaving(true);
    try {
      for (const u of updates) {
        await supabase
          .from("prospects")
          .update({ conference: u.conf, updated_at: new Date().toISOString() })
          .eq("id", u.id);
      }
      onDataChanged?.();
    } finally {
      setBulkSaving(false);
    }
  }

  const years = useMemo(() => {
    const s = new Set(prospects.map((p) => p.draft_class_year));
    return Array.from(s).sort((a, b) => a - b);
  }, [prospects]);

  // Per-column max-length so every input in a column is sized to the longest value in that column.
  const sizes = useMemo<ColumnSizes>(() => {
    const maxLen = (vals: (string | null | undefined)[], floor: number) =>
      Math.max(floor, ...vals.map((v) => (v ?? "").length));
    return {
      school: maxLen(prospects.map((p) => p.school), 5),
      conference: maxLen(prospects.map((p) => p.conference), 4),
      height: maxLen(prospects.map((p) => p.height), 4),
    };
  }, [prospects]);

  const filteredSorted = useMemo(() => {
    const rankFor = (p: ProspectWithStats): number | null =>
      rankOverride.has(p.id) ? rankOverride.get(p.id)! : p.personal_rank;
    const list = yearFilter
      ? prospects.filter((p) => p.draft_class_year === yearFilter)
      : [...prospects];
    list.sort((a, b) => {
      let va: string | number = 0;
      let vb: string | number = 0;
      if (sortKey === "name") { va = a.name; vb = b.name; }
      else if (sortKey === "draft_class_year") { va = a.draft_class_year; vb = b.draft_class_year; }
      else { va = rankFor(a) ?? 9999; vb = rankFor(b) ?? 9999; }
      if (typeof va === "string")
        return sortDir === "asc" ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return list;
  }, [prospects, yearFilter, sortKey, sortDir, rankOverride]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  function sortIndicator(k: SortKey) {
    if (sortKey !== k) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  if (prospects.length === 0) {
    return (
      <div className="text-gray-500 text-sm text-center py-12">
        No prospects added yet.
      </div>
    );
  }

  return (
    <div>
      {/* Class filter + bulk actions */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm text-gray-400">Class:</span>
        <button
          onClick={() => setYearFilter(null)}
          className={`px-3 py-1 rounded text-xs font-medium transition ${
            !yearFilter ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          All
        </button>
        {years.map((y) => (
          <button
            key={y}
            onClick={() => setYearFilter(y)}
            className={`px-3 py-1 rounded text-xs font-medium transition ${
              yearFilter === y ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {y}
          </button>
        ))}
        <button
          onClick={autofillConferences}
          disabled={bulkSaving}
          className="ml-auto px-3 py-1 rounded text-xs font-medium bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white transition"
          title="Overwrite Conference for every prospect whose school is recognized in the school→conference map."
        >
          {bulkSaving ? "Updating…" : "Auto-fill Conferences"}
        </button>
      </div>

      {rankError && (
        <p className="text-red-400 text-xs mb-3" role="alert">{rankError}</p>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="text-sm border-collapse w-full">
          <thead>
            <tr className="bg-gray-900 text-xs text-gray-500 border-b border-gray-700">
              <th
                className="text-left py-2 px-3 font-medium whitespace-nowrap sticky left-0 bg-gray-900 z-10 border-r border-gray-800"
                style={shrinkStyle}
              >
                <button
                  onClick={() => toggleSort("name")}
                  className="text-gray-300 hover:text-white transition"
                >
                  Name{sortIndicator("name")}
                </button>
              </th>
              <th className={thShrink} style={shrinkStyle}>School</th>
              <th className={thShrink} style={shrinkStyle}>Conf</th>
              <th className={thShrink} style={shrinkStyle}>Height</th>
              <th className={thShrink} style={shrinkStyle}>Weight</th>
              <th className={thShrink} style={shrinkStyle}>Birthday</th>
              <th className={thShrink} style={shrinkStyle}>
                <button
                  onClick={() => toggleSort("draft_class_year")}
                  className="text-gray-500 hover:text-white transition"
                >
                  Draft Yr{sortIndicator("draft_class_year")}
                </button>
              </th>
              <th className={thShrink} style={shrinkStyle}>Charting</th>
              <th className={thShrink} style={shrinkStyle}>
                <button
                  onClick={() => toggleSort("personal_rank")}
                  className="text-gray-500 hover:text-white transition"
                >
                  Rank{sortIndicator("personal_rank")}
                </button>
              </th>
              <th className={thShrink} style={shrinkStyle}>Should Play</th>
              {/* Notes — width 100% claims all remaining space, forcing other columns to shrink to content */}
              <th
                className="text-left py-2 px-2 font-medium whitespace-nowrap"
                style={{ width: "100%" }}
              >
                Notes
              </th>
            </tr>
          </thead>
          <tbody className="bg-gray-950">
            {filteredSorted.map((p) => (
              <RosterRow
                key={p.id}
                p={p}
                nflRoles={nflRoles}
                sizes={sizes}
                rank={effectiveRank(p)}
                onRankCommit={(raw) => commitRank(p.id, raw)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
