"use client";
import { useRef, useState } from "react";
import { normalizeLeagueSafeUrl } from "../../lib/helpers/leagueSafe";
import type { LeagueSafeLinks } from "../../lib/types";

// One row per league, one cell per season: the season's LeagueSafe link
// (opens in a new tab — LeagueSafe pages sit behind its own login) or a
// button to paste one. Seasons with no link in a commissioner league read
// "Not created" in amber, because the commissioner is the one who has to
// create that LeagueSafe.

interface LeagueSafeTableProps {
  leagues: Array<{ league_id: string; name: string }>;
  years: number[];
  links: LeagueSafeLinks;
  /** Leagues whose missing seasons read "Not created" (the user is commissioner). */
  commissionerIds: Set<string>;
  canEdit: boolean;
  onSave: (leagueId: string, season: number, url: string) => Promise<boolean>;
}

export default function LeagueSafeTable({ leagues, years, links, commissionerIds, canEdit, onSave }: LeagueSafeTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left text-slate-400 font-medium py-2 px-3 border-b border-slate-700 min-w-[160px]">League</th>
            {years.map((year) => (
              <th key={year} className="text-center text-blue-400 font-medium py-2 px-3 border-b border-slate-700 min-w-[110px]">
                {year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leagues.map((league, idx) => {
            const isCommissioner = commissionerIds.has(league.league_id);
            return (
              <tr key={league.league_id} className={idx % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                <td className="py-2 px-3 text-white font-medium whitespace-nowrap border-r border-slate-800">
                  {league.name}
                  {isCommissioner && (
                    <span className="ml-2 rounded border border-purple-800 bg-purple-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-purple-300">
                      Commish
                    </span>
                  )}
                </td>
                {years.map((year) => (
                  <td key={year} className="text-center py-1.5 px-2">
                    <LeagueSafeCell
                      url={links[league.league_id]?.[year] ?? ""}
                      label={`${league.name} ${year} LeagueSafe link`}
                      flagMissing={isCommissioner}
                      canEdit={canEdit}
                      onSave={(url) => onSave(league.league_id, year, url)}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface LeagueSafeCellProps {
  url: string;
  /** e.g. "Dynasty Degenerates 2027 LeagueSafe link" — for the cell's aria-labels. */
  label: string;
  flagMissing: boolean;
  canEdit: boolean;
  onSave: (url: string) => Promise<boolean>;
}

function LeagueSafeCell({ url, label, flagMissing, canEdit, onSave }: LeagueSafeCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  // Escape closes the field; this stops the blur that follows from saving the draft.
  const cancelledRef = useRef(false);

  const startEdit = () => {
    cancelledRef.current = false;
    setDraft(url);
    setInvalid(false);
    setEditing(true);
  };

  const commit = async () => {
    if (cancelledRef.current || saving) return;
    const normalized = normalizeLeagueSafeUrl(draft);
    if (normalized === null) {
      setInvalid(true);
      return;
    }
    if (normalized === url) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(normalized);
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <input
          type="url"
          inputMode="url"
          autoFocus
          value={draft}
          disabled={saving}
          onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void commit(); }
            if (e.key === "Escape") { cancelledRef.current = true; setEditing(false); }
          }}
          placeholder="leaguesafe.com/…"
          aria-label={label}
          aria-invalid={invalid}
          className={`w-full min-w-[150px] px-2 py-1 text-xs text-white bg-slate-800 border rounded focus:outline-none ${
            invalid ? "border-red-700 focus:border-red-500" : "border-slate-600 focus:border-blue-500"
          }`}
        />
        <span className={`text-[10px] ${invalid ? "text-red-400" : "text-slate-500"}`}>
          {invalid ? "Not a web link" : "Enter to save · Esc to cancel · empty clears"}
        </span>
      </div>
    );
  }

  // Saved links are always http(s) (normalizeLeagueSafeUrl + the table's check);
  // re-checked here so nothing else could ever render as an href.
  const href = /^https?:\/\//i.test(url) ? url : "";
  if (href) {
    return (
      <div className="flex items-center justify-center gap-1.5">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={href}
          className="rounded border border-emerald-800 bg-emerald-950/40 px-2 py-0.5 text-xs font-semibold text-emerald-300 hover:text-emerald-200 transition"
        >
          Open ↗
        </a>
        {canEdit && (
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Edit ${label}`}
            className="rounded p-1 text-slate-500 hover:text-slate-200 transition"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M13.6 3.3a1.5 1.5 0 0 1 2.1 0l1 1a1.5 1.5 0 0 1 0 2.1l-8.9 8.9-3.6.9.9-3.6 8.5-8.5Z" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  if (!canEdit) return <span className="text-xs text-slate-600">—</span>;

  return (
    <button
      type="button"
      onClick={startEdit}
      aria-label={`Add ${label}`}
      className={`rounded border px-2 py-0.5 text-xs font-semibold transition ${
        flagMissing
          ? "border-amber-800 bg-amber-950/40 text-amber-300 hover:text-amber-200"
          : "border-slate-700 bg-slate-800 text-slate-400 hover:text-white"
      }`}
    >
      {flagMissing ? "Not created" : "+ Add"}
    </button>
  );
}
