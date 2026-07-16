"use client";
import { useMemo } from "react";
import { useLeague } from "../../lib/LeagueContext";
import { useMyRoster } from "../../lib/RosterContext";

// ============================================================
// Shared "any roster in this league" selector (Phase C stage C1).
// Feeds Phase E's roster-level tools (age curve, positional radar,
// team-needs summary) plus J1's cross-league team picker — anywhere
// that needs to view another team's roster through the same lens as
// your own, not just the LeagueHub/TradeFinder "pick an opponent" flows.
// ============================================================

export interface RosterSelectProps {
  value: number | null;
  onChange: (rosterId: number | null) => void;
  /** Exclude a roster (e.g. the user's own) from the option list. */
  excludeRosterId?: number | null;
  /** Label for the empty option. Omit to require a selection (no blank option rendered). */
  placeholder?: string;
  className?: string;
  id?: string;
}

/** Dropdown listing every roster in the currently selected league, sorted by
 *  owner name, with the user's own roster suffixed "(You)". Keyed by
 *  roster_id (stable even for orphaned/co-owned rosters), not owner_id. */
export default function RosterSelect({
  value,
  onChange,
  excludeRosterId = null,
  placeholder,
  className,
  id,
}: RosterSelectProps) {
  const { rosters, users } = useLeague();
  const { myRoster } = useMyRoster();

  const options = useMemo(
    () =>
      rosters
        .filter((r) => excludeRosterId == null || Number(r.roster_id) !== Number(excludeRosterId))
        .map((r) => {
          const label = users[r.roster_id] || users[r.owner_id] || `Team ${r.roster_id}`;
          return {
            roster_id: r.roster_id,
            label: r.roster_id === myRoster?.roster_id ? `${label} (You)` : label,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [rosters, users, excludeRosterId, myRoster?.roster_id]
  );

  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={
        className ||
        "bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
      }
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.roster_id} value={o.roster_id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
