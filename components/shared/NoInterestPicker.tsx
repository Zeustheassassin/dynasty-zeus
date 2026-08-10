"use client";
import { NO_INTEREST_DURATIONS, isBlockActive } from "../../lib/helpers/dispositions";

interface NoInterestPickerProps {
  /** ISO expiry timestamp if a block is currently active, else undefined. */
  expiresAt?: string;
  /** null clears the block; a number is a days value from NO_INTEREST_DURATIONS. */
  onChange: (days: number | null) => void;
}

const daysRemaining = (expiresAt: string): number =>
  Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / (24 * 60 * 60 * 1000)));

/** Compact "No Interest" control for an opposing player — a personal, time-boxed block that
 *  keeps that player out of Trade Finder suggestions, independent of the opponent's own
 *  SELL_NO/SELL_OK willingness tag (a separate axis, see DispositionPicker). */
export function NoInterestPicker({ expiresAt, onChange }: NoInterestPickerProps) {
  if (isBlockActive(expiresAt)) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1">
        <span
          title={`No Interest — expires ${new Date(expiresAt as string).toLocaleDateString()}`}
          className="text-[9px] font-semibold text-red-300"
        >
          🚫 {daysRemaining(expiresAt as string)}d
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Clear No Interest"
          className="text-[9px] text-slate-500 hover:text-slate-300 leading-none"
        >
          ✕
        </button>
      </span>
    );
  }
  return (
    <select
      value=""
      onChange={(e) => e.target.value && onChange(Number(e.target.value))}
      title="Mark No Interest"
      className="shrink-0 bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-[9px] font-semibold text-slate-500 focus:outline-none focus:border-blue-500"
    >
      <option value="">🚫 Block…</option>
      {NO_INTEREST_DURATIONS.map((d) => (
        <option key={d.days} value={d.days} className="text-slate-200">
          {d.label}
        </option>
      ))}
    </select>
  );
}
