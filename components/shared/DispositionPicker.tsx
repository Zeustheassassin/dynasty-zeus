"use client";
import type { AssetDisposition } from "../../lib/types";
import { normalizeDisposition } from "../../lib/helpers/dispositions";

const DISPOSITION_TEXT_COLOR: Partial<Record<AssetDisposition, string>> = {
  CORE: "text-emerald-300",
  PRICEY: "text-amber-300",
  SHOPPING: "text-orange-300",
  OFFLOAD: "text-red-300",
  SELL_NO: "text-red-300",
  SELL_OK: "text-emerald-300",
};

interface DispositionPickerProps {
  value?: AssetDisposition;
  options: readonly { value: AssetDisposition; label: string; hint: string }[];
  onChange: (next: AssetDisposition | null) => void;
}

/** Compact dropdown for a player/pick's manual disposition — dense per-row
 *  listings (grouped rosters, pick lists) don't have room for segmented
 *  buttons. Selecting "Neutral" clears the tag (untagged, not persisted). */
export function DispositionPicker({ value, options, onChange }: DispositionPickerProps) {
  const normalized = normalizeDisposition(value);
  const colorClass = normalized ? DISPOSITION_TEXT_COLOR[normalized] : "text-slate-600";
  return (
    <select
      value={normalized ?? "NEUTRAL"}
      onChange={(e) => onChange(e.target.value === "NEUTRAL" ? null : (e.target.value as AssetDisposition))}
      title="Disposition"
      className={`shrink-0 bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-[9px] font-semibold focus:outline-none focus:border-blue-500 ${colorClass}`}
    >
      <option value="NEUTRAL" className="text-slate-400">Neutral</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} title={opt.hint} className="text-slate-200">
          {opt.label}
        </option>
      ))}
    </select>
  );
}
