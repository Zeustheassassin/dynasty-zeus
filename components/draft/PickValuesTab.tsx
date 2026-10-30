"use client";
// ── PickValuesTab ─────────────────────────────────────────────────────────────
// Rookie pick values for the next undrafted class, slot by slot, plus the two classes after it
// by round. FantasyCalc is the default; the user can set their own value for any pick, and
// those values are used everywhere the app values picks (they're laid over FantasyCalc's map
// in useAppState). Highlights the picks the user owns in the selected league.
import { useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import type { AugmentedPick } from "../../lib/types";
import { ROUNDS } from "../../lib/helpers";
import { PICK_VALUE_SLOTS, nextPickValueClass, slotValueFrom } from "../../lib/helpers/picks";
import { ChartCard, ChartTooltip, chartGridProps, chartAxisProps, chartTickStyle } from "../charts/ChartCard";
import { CHART_CATEGORICAL } from "../../lib/chartTheme";

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

interface PickValuesTabProps {
  /** FantasyCalc's pick values — the defaults. */
  marketPickFcValues: Record<string, number>;
  /** FantasyCalc with the user's values laid over it — what the rest of the app uses. */
  pickFcValues: Record<string, number>;
  pickValueOverrides: Record<string, number>;
  savePickValueOverrides: (next: Record<string, number>) => void;
  allPicks: AugmentedPick[];
  myRosterId: number | undefined;
}

const valueColor = (value: number) =>
  value > 6000 ? "text-emerald-400"
    : value > 4000 ? "text-green-400"
    : value > 2000 ? "text-yellow-400"
    : value > 500 ? "text-orange-400"
    : "text-gray-500";

/** One editable value. Commits on blur or Enter; Escape cancels; an empty box (or FantasyCalc's
 *  own number typed back in) clears the user's value. */
function PickValueInput({
  label, value, marketValue, onCommit,
}: {
  label: string;
  value: number;
  marketValue: number;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; setDraft(null); return; }
    if (draft === null) return;
    const trimmed = draft.replace(/[,\s]/g, "");
    setDraft(null);
    if (trimmed === "") { onCommit(null); return; }
    const n = Math.round(Number(trimmed));
    if (!Number.isFinite(n) || n <= 0) return; // not a value — leave it as it was
    onCommit(n === marketValue ? null : n);
  };
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={draft ?? (value > 0 ? value.toLocaleString() : "")}
      placeholder="—"
      onFocus={(e) => { setDraft(value > 0 ? String(value) : ""); e.target.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { cancelled.current = true; e.currentTarget.blur(); }
      }}
      className={`w-full bg-transparent text-sm font-semibold rounded px-1 -mx-1 border border-transparent hover:border-gray-600 focus:border-blue-500 focus:outline-none ${valueColor(value)}`}
    />
  );
}

export default function PickValuesTab({
  marketPickFcValues,
  pickFcValues,
  pickValueOverrides,
  savePickValueOverrides,
  allPicks,
  myRosterId,
}: PickValuesTabProps) {
  const classYear = useMemo(() => nextPickValueClass(marketPickFcValues), [marketPickFcValues]);
  const laterClasses = [String(Number(classYear) + 1), String(Number(classYear) + 2)];
  const slots = PICK_VALUE_SLOTS;
  const [confirmReset, setConfirmReset] = useState(false);

  const setValue = (key: string, next: number | null) => {
    const updated = { ...pickValueOverrides };
    if (next === null) delete updated[key];
    else updated[key] = next;
    savePickValueOverrides(updated);
  };

  const editedCount = Object.keys(pickValueOverrides).filter((key) =>
    [classYear, ...laterClasses].some((year) => key.startsWith(`${year}-`))
  ).length;

  const curveData = useMemo(
    () =>
      ROUNDS.flatMap((round) =>
        Array.from({ length: slots }, (_, i) => {
          const slot = i + 1;
          return {
            pick: (round - 1) * slots + slot,
            label: `${round}.${String(slot).padStart(2, "0")}`,
            fantasyCalc: slotValueFrom(marketPickFcValues, classYear, round, slot, slots),
            yours: slotValueFrom(pickFcValues, classYear, round, slot, slots),
          };
        })
      ),
    [slots, marketPickFcValues, pickFcValues, classYear]
  );
  const hasClassEdits = Object.keys(pickValueOverrides).some((key) => key.startsWith(`${classYear}-`));

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{classYear} Rookie Pick Values</h2>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            FantasyCalc superflex values unless you set your own. Click any value to change it. Your
            values are used everywhere picks are valued: Trade Finder, Trade Calculator, pick cards and
            the League Overview. Clear a box to go back to FantasyCalc.
            {allPicks.length > 0 && " Your picks in this league are highlighted in blue."}
          </p>
        </div>
        {editedCount > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-amber-300">{editedCount} value{editedCount === 1 ? "" : "s"} set by you</span>
            {confirmReset ? (
              <>
                <button
                  type="button"
                  onClick={() => { savePickValueOverrides({}); setConfirmReset(false); }}
                  className="px-2 py-1 rounded border border-red-600 text-red-300 hover:bg-red-900/40"
                >
                  Reset all to FantasyCalc
                </button>
                <button type="button" onClick={() => setConfirmReset(false)} className="px-2 py-1 text-gray-400 hover:text-white">
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="px-2 py-1 rounded border border-gray-600 text-gray-300 hover:border-gray-400"
              >
                Reset all…
              </button>
            )}
          </div>
        )}
      </div>

      {Object.keys(marketPickFcValues).length === 0 ? (
        <div className="text-gray-400 text-sm">Pick values are loading…</div>
      ) : (
        <>
          <div className="mb-6">
            <ChartCard title="Pick Value Curve" subtitle={`${classYear} rookie draft, overall pick order`}>
              <LineChart data={curveData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis
                  dataKey="pick"
                  {...chartAxisProps}
                  tick={chartTickStyle}
                  label={{ value: "Overall Pick", position: "insideBottom", offset: -2, fill: chartTickStyle.fill, fontSize: 11 }}
                />
                <YAxis {...chartAxisProps} tick={chartTickStyle} />
                <Tooltip content={ChartTooltip} labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""} />
                {hasClassEdits && <Legend wrapperStyle={{ fontSize: 11 }} />}
                <Line type="monotone" dataKey="fantasyCalc" name="FantasyCalc" stroke={CHART_CATEGORICAL[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                {hasClassEdits && (
                  <Line type="monotone" dataKey="yours" name="Yours" stroke={CHART_CATEGORICAL[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                )}
              </LineChart>
            </ChartCard>
          </div>

          {ROUNDS.map((round) => (
            <div key={round} className="mb-6">
              <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Round {round}</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                {Array.from({ length: slots }, (_, i) => {
                  const slot = i + 1;
                  const slotStr = `${round}.${String(slot).padStart(2, "0")}`;
                  const key = `${classYear}-${slotStr}`;
                  const marketValue = slotValueFrom(marketPickFcValues, classYear, round, slot, slots);
                  const value = slotValueFrom(pickFcValues, classYear, round, slot, slots);
                  const edited = key in pickValueOverrides;
                  const isMyPick = allPicks.some(
                    (p) => String(p.season) === classYear && p.slot === slotStr && String(p.owner_id) === String(myRosterId)
                  );
                  return (
                    <div
                      key={slotStr}
                      className={`rounded-xl border px-3 py-2 ${
                        isMyPick ? "border-blue-600 bg-blue-950/30"
                          : edited ? "border-amber-600/70 bg-amber-950/20"
                          : "border-gray-700 bg-gray-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-xs font-bold ${isMyPick ? "text-blue-300" : "text-gray-300"}`}>{slotStr}</span>
                        {isMyPick && <span className="text-[9px] text-blue-400 font-bold">YOURS</span>}
                        {edited && (
                          <button
                            type="button"
                            aria-label={`Reset ${slotStr} to FantasyCalc`}
                            title="Back to FantasyCalc"
                            onClick={() => setValue(key, null)}
                            className="text-[11px] leading-none text-amber-400 hover:text-white"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <PickValueInput
                        label={`${classYear} pick ${slotStr} value`}
                        value={value}
                        marketValue={marketValue}
                        onCommit={(next) => setValue(key, next)}
                      />
                      <div className="text-[10px] text-gray-500">
                        {edited ? `FC ${marketValue > 0 ? marketValue.toLocaleString() : "—"}` : `Pick ${(round - 1) * slots + slot}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mb-6">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Later classes, by round</div>
            <p className="text-xs text-gray-500 mb-2">Slots aren&apos;t known yet, so these are one value per round.</p>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                    <th className="text-left pr-4 pb-1 font-semibold">Class</th>
                    {ROUNDS.map((round) => (
                      <th key={round} className="text-left px-2 pb-1 font-semibold">{ORDINAL[round - 1]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {laterClasses.map((year) => (
                    <tr key={year}>
                      <td className="pr-4 py-1 text-gray-300 font-semibold">{year}</td>
                      {ROUNDS.map((round) => {
                        const key = `${year}-${round}`;
                        const marketValue = marketPickFcValues[key] ?? 0;
                        const edited = key in pickValueOverrides;
                        return (
                          <td key={round} className="px-1 py-1 align-top">
                            <div className={`w-24 rounded-lg border px-2 py-1 ${edited ? "border-amber-600/70 bg-amber-950/20" : "border-gray-700 bg-gray-800"}`}>
                              <div className="flex items-center gap-1">
                                <PickValueInput
                                  label={`${year} ${ORDINAL[round - 1]} round value`}
                                  value={pickFcValues[key] ?? 0}
                                  marketValue={marketValue}
                                  onCommit={(next) => setValue(key, next)}
                                />
                                {edited && (
                                  <button
                                    type="button"
                                    aria-label={`Reset ${year} ${ORDINAL[round - 1]} to FantasyCalc`}
                                    title="Back to FantasyCalc"
                                    onClick={() => setValue(key, null)}
                                    className="text-[11px] leading-none text-amber-400 hover:text-white"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                              {edited && <div className="text-[10px] text-gray-500">FC {marketValue > 0 ? marketValue.toLocaleString() : "—"}</div>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
