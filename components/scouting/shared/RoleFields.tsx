"use client";
// The prospect's role fields (stage 3 of the landing-spot plan, 2026-11-10):
// Should Play is his computed role bucket, read only (the user's call); Will
// Play (Post) picks one of his position's role buckets, saved as its key, and
// Dynasty+ ranks his role standing there. Will Play (Pre) is retired: no UI,
// its saved answers stay in the column.

import type { Prospect } from "../../../lib/types";
import { roleFitTooltip, roleLabel, type RoleFit, type RolePos } from "../../../lib/scouting/roleFit";
import { willPlayOptions, willPlayRole } from "../../../lib/scouting/roleStanding";
import type { OverviewData } from "../overview/useProspectReport";
import { usePositionRoleFits } from "./hooks/usePositionRoleFits";

/** Should Play: his best role bucket, with the bucket tooltip. `earlier` is his old hand-picked answer, shown in the tooltip only. */
export function ShouldPlayText({ fit, ready, earlier, className = "" }: {
  fit: RoleFit | undefined;
  ready: boolean;
  earlier?: string | null;
  className?: string;
}) {
  const old = earlier?.trim() ? `\nYour earlier hand-picked answer (no longer used): ${earlier.trim()}` : "";
  if (!fit) {
    return (
      <span className={`text-slate-500 ${className}`} title={(ready ? "Not enough tape for a role yet." : "Loading the plays…") + old}>
        {ready ? "—" : "…"}
      </span>
    );
  }
  return (
    <span className={`text-slate-200 ${className}`} title={`Should Play = his best role bucket (read only).\n${roleFitTooltip(fit)}${old}`}>
      {roleLabel(fit)}
    </span>
  );
}

/** Should Play for one prospect, from his position's role buckets (loads that position's plays). */
export function ShouldPlayField({ prospect, pos, data, className }: {
  prospect: Pick<Prospect, "id" | "should_play">;
  pos: RolePos;
  data: OverviewData;
  className?: string;
}) {
  const { fits, ready } = usePositionRoleFits(pos, data);
  return <ShouldPlayText fit={fits.get(prospect.id)} ready={ready} earlier={prospect.should_play} className={`block ${className ?? ""}`} />;
}

/**
 * Will Play (Post): "" or one of the position's role keys. An older answer that
 * isn't a role (free text from before 2026-11-10) stays selected, marked, until
 * it's changed.
 */
export function WillPlayPostSelect({ id, pos, value, onChange, className, ariaLabel, disabled }: {
  id?: string;
  pos: RolePos;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const key = willPlayRole(pos, value);
  const raw = value.trim();
  const shown = key ?? raw;
  return (
    <select id={id} className={className} value={shown} aria-label={ariaLabel} disabled={disabled}
      title="The role bucket he'll play on his NFL team. Dynasty+ ranks him among his class's players at that role (role standing). Blank = his best role bucket."
      onChange={(e) => onChange(e.target.value)}>
      {willPlayOptions(pos).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {!key && raw && <option value={raw}>{raw} (old answer)</option>}
    </select>
  );
}
