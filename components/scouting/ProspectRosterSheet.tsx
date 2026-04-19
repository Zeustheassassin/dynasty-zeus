"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabaseclient";
import type { ProspectWithStats, ChartingDecision } from "../../lib/types";

const CHARTING_DECISIONS: { value: ChartingDecision; label: string }[] = [
  { value: "fully_charted", label: "Fully Charted" },
  { value: "partial_chart", label: "Partial Chart" },
  { value: "charting",      label: "Charting" },
  { value: "pending",       label: "Pending" },
  { value: "not_charting",  label: "Not Charting" },
];

interface RowState {
  school: string;
  conference: string;
  height: string;
  weight: number | null;
  birthday: string | null;
  draft_class_year: number;
  personal_rank: number | null;
  should_play: string;
  will_play_pre: string;
  will_play_post: string;
  charting_decision: ChartingDecision;
  charting_notes: string;
}

interface RosterRowProps {
  p: ProspectWithStats;
  nflRoles: string[];
}

function RosterRow({ p, nflRoles }: RosterRowProps) {
  const [local, setLocal] = useState<RowState>({
    school: p.school,
    conference: p.conference,
    height: p.height,
    weight: p.weight,
    birthday: p.birthday,
    draft_class_year: p.draft_class_year,
    personal_rank: p.personal_rank,
    should_play: p.should_play,
    will_play_pre: p.will_play_pre,
    will_play_post: p.will_play_post,
    charting_decision: p.charting_decision,
    charting_notes: p.charting_notes,
  });
  const [saving, setSaving] = useState(false);

  async function saveFields(changes: Partial<RowState>) {
    setSaving(true);
    await supabase
      .from("prospects")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    setSaving(false);
  }

  const inp = "w-full bg-transparent text-white text-xs px-1 py-0.5 focus:outline-none focus:bg-gray-800/80 rounded min-w-0";
  const sel = "w-full bg-gray-950 text-white text-xs px-1 py-0.5 focus:outline-none focus:bg-gray-800 rounded min-w-0 cursor-pointer";

  return (
    <tr className={`border-b border-gray-800/60 hover:bg-gray-900/40 transition ${saving ? "opacity-50" : ""}`}>
      {/* Name — sticky */}
      <td className="py-2 px-3 text-sm font-medium text-white whitespace-nowrap sticky left-0 bg-gray-950 z-10 border-r border-gray-800">
        {p.name}
      </td>

      {/* School */}
      <td className="py-1 px-1.5 min-w-[110px]">
        <input className={inp} value={local.school}
          onChange={(e) => setLocal((l) => ({ ...l, school: e.target.value }))}
          onBlur={() => saveFields({ school: local.school })} />
      </td>

      {/* Conf */}
      <td className="py-1 px-1.5 min-w-[90px]">
        <input className={inp} value={local.conference}
          onChange={(e) => setLocal((l) => ({ ...l, conference: e.target.value }))}
          onBlur={() => saveFields({ conference: local.conference })} />
      </td>

      {/* Height */}
      <td className="py-1 px-1.5 min-w-[70px]">
        <input className={inp} value={local.height}
          onChange={(e) => setLocal((l) => ({ ...l, height: e.target.value }))}
          onBlur={() => saveFields({ height: local.height })} />
      </td>

      {/* Weight */}
      <td className="py-1 px-1.5 min-w-[65px]">
        <input type="number" className={inp} value={local.weight ?? ""}
          onChange={(e) => setLocal((l) => ({ ...l, weight: e.target.value ? Number(e.target.value) : null }))}
          onBlur={() => saveFields({ weight: local.weight })} />
      </td>

      {/* Birthday */}
      <td className="py-1 px-1.5 min-w-[130px]">
        <input type="date" className={inp} value={local.birthday ?? ""}
          onChange={(e) => {
            const v = e.target.value || null;
            setLocal((l) => ({ ...l, birthday: v }));
            saveFields({ birthday: v });
          }} />
      </td>

      {/* Draft Year */}
      <td className="py-1 px-1.5 min-w-[80px]">
        <select className={sel} value={local.draft_class_year}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLocal((l) => ({ ...l, draft_class_year: v }));
            saveFields({ draft_class_year: v });
          }}>
          {[2026, 2027, 2028, 2029].map((y) => <option key={y}>{y}</option>)}
        </select>
      </td>

      {/* Personal Rank */}
      <td className="py-1 px-1.5 min-w-[55px]">
        <input type="number" className={inp} value={local.personal_rank ?? ""}
          onChange={(e) => setLocal((l) => ({ ...l, personal_rank: e.target.value ? Number(e.target.value) : null }))}
          onBlur={() => saveFields({ personal_rank: local.personal_rank })} />
      </td>

      {/* Should Play */}
      <td className="py-1 px-1.5 min-w-[130px]">
        <select className={sel} value={local.should_play}
          onChange={(e) => {
            setLocal((l) => ({ ...l, should_play: e.target.value }));
            saveFields({ should_play: e.target.value });
          }}>
          {nflRoles.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
        </select>
      </td>

      {/* Will Play Pre */}
      <td className="py-1 px-1.5 min-w-[130px]">
        <select className={sel} value={local.will_play_pre}
          onChange={(e) => {
            setLocal((l) => ({ ...l, will_play_pre: e.target.value }));
            saveFields({ will_play_pre: e.target.value });
          }}>
          {nflRoles.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
        </select>
      </td>

      {/* Will Play Post */}
      <td className="py-1 px-1.5 min-w-[130px]">
        <select className={sel} value={local.will_play_post}
          onChange={(e) => {
            setLocal((l) => ({ ...l, will_play_post: e.target.value }));
            saveFields({ will_play_post: e.target.value });
          }}>
          {nflRoles.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
        </select>
      </td>

      {/* Charting Status */}
      <td className="py-1 px-1.5 min-w-[130px]">
        <select className={sel} value={local.charting_decision}
          onChange={(e) => {
            const v = e.target.value as ChartingDecision;
            setLocal((l) => ({ ...l, charting_decision: v }));
            saveFields({ charting_decision: v });
          }}>
          {CHARTING_DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </td>

      {/* Charting Notes */}
      <td className="py-1 px-1.5 min-w-[200px]">
        <input className={inp} value={local.charting_notes}
          onChange={(e) => setLocal((l) => ({ ...l, charting_notes: e.target.value }))}
          onBlur={() => saveFields({ charting_notes: local.charting_notes })} />
      </td>
    </tr>
  );
}

const HEADERS = [
  "School", "Conf", "Height", "Weight", "Birthday",
  "Draft Yr", "Rank", "Should Play", "Will Play Pre", "Will Play Post",
  "Charting", "Notes",
];

interface Props {
  prospects: ProspectWithStats[];
  nflRoles: string[];
}

export default function ProspectRosterSheet({ prospects, nflRoles }: Props) {
  if (prospects.length === 0) {
    return (
      <div className="text-gray-500 text-sm text-center py-12">
        No prospects added yet.
      </div>
    );
  }

  const sorted = [...prospects].sort((a, b) => (a.personal_rank ?? 9999) - (b.personal_rank ?? 9999));

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="text-sm border-collapse" style={{ width: "max-content", minWidth: "100%" }}>
        <thead>
          <tr className="bg-gray-900 text-xs text-gray-500 border-b border-gray-700">
            <th className="text-left py-2 px-3 font-medium whitespace-nowrap sticky left-0 bg-gray-900 z-10 border-r border-gray-800">
              Name
            </th>
            {HEADERS.map((h) => (
              <th key={h} className="text-left py-2 px-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-gray-950">
          {sorted.map((p) => (
            <RosterRow key={p.id} p={p} nflRoles={nflRoles} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
