"use client";
import React, { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Cell, LabelList } from "recharts";
import type {
  TradeAttempt, TradeAttemptAsset, TradeAttemptPick,
  SleeperPlayer, SleeperRoster, AugmentedPick, LeagueSimulation,
} from "../../lib/types";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { buildTradeFingerprint } from "./shared";
import { computePosTotals, computeLeagueRank } from "./calculatorUtils";
import { CHART_CHROME, CHART_DIVERGING } from "../../lib/chartTheme";
import { Card } from "../ui/Card";

interface CalculatorResultProps {
  calcGive: string[];
  setCalcGive: React.Dispatch<React.SetStateAction<string[]>>;
  calcReceive: string[];
  setCalcReceive: React.Dispatch<React.SetStateAction<string[]>>;
  calcGivePicks: string[];
  setCalcGivePicks: React.Dispatch<React.SetStateAction<string[]>>;
  calcReceivePicks: string[];
  setCalcReceivePicks: React.Dispatch<React.SetStateAction<string[]>>;
  allPicks: AugmentedPick[];
  myAvailPlayers: SleeperPlayer[];
  theirAvailPlayers: SleeperPlayer[];
  myAvailPicks: AugmentedPick[];
  theirAvailPicks: AugmentedPick[];
  myRoster: SleeperRoster | undefined;
  calcOpponentRosterId: number | null;
  calcVal: (id: string) => number;
  getPickValue: (key: string) => number;
  pickKey: (p: AugmentedPick) => string;
  pickLabel: (p: AugmentedPick) => string;
  totalGiveAdj: number;
  totalReceiveAdj: number;
  myDropCostCalc: number;
  oppDropCostCalc: number;
  calcStarOnGive: number;
  calcStarOnReceive: number;
  net: number;
  verdict: "EVEN" | "YOU WIN" | "YOU LOSE";
  verdictColor: string;
  onMarkAttempted: (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => Promise<void>;
  sessionMarked: Set<string>;
  onSessionMark: (fingerprint: string) => void;
}

/** Compact side-by-side give/receive bar chart for the Trade Calculator verdict row. */
function TradeValueBars({ totalGiveAdj, totalReceiveAdj }: { totalGiveAdj: number; totalReceiveAdj: number }) {
  const data = [
    { label: "Give", value: totalGiveAdj },
    { label: "Receive", value: totalReceiveAdj },
  ];
  return (
    <BarChart
      layout="vertical"
      data={data}
      width={180}
      height={56}
      margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
    >
      <XAxis type="number" hide />
      <YAxis type="category" dataKey="label" hide />
      <Bar dataKey="value" radius={3} barSize={14}>
        <LabelList
          dataKey="value"
          position="right"
          style={{ ...CHART_CHROME, fill: CHART_CHROME.textSecondary, fontSize: 10 }}
          formatter={(v) => (typeof v === "number" ? v.toLocaleString() : String(v ?? ""))}
        />
        {data.map((d) => (
          <Cell key={d.label} fill={d.label === "Give" ? CHART_DIVERGING.negative : CHART_DIVERGING.positive} />
        ))}
      </Bar>
    </BarChart>
  );
}

/** Bidirectional margin gauge — proportional fill from center, colored by who wins the trade. */
function TradeMarginGauge({ net, totalGiveAdj, totalReceiveAdj }: { net: number; totalGiveAdj: number; totalReceiveAdj: number }) {
  const scale = Math.max(totalGiveAdj, totalReceiveAdj, 1);
  const pct = Math.min(100, (Math.abs(net) / scale) * 100);
  const positive = net >= 0;
  return (
    <div className="w-44">
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: CHART_CHROME.border }}>
        <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: CHART_CHROME.axis }} />
        <div
          className="absolute inset-y-0 rounded-full transition-all"
          style={{
            background: positive ? CHART_DIVERGING.positive : CHART_DIVERGING.negative,
            width: `${pct / 2}%`,
            ...(positive ? { left: "50%" } : { right: "50%" }),
          }}
        />
      </div>
      <div className="text-[10px] text-slate-600 mt-1 text-center">Margin</div>
    </div>
  );
}

/** Before → after odds line for the Simulator Preview panel; hidden when either side is missing. */
function SimPreviewStatLine({ label, before, after, suffix }: { label: string; before?: number; after?: number; suffix: string }) {
  if (before == null || after == null) return null;
  const delta = Math.round((after - before) * 10) / 10;
  const color = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-slate-500";
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-300">
        {before}{suffix} <span className="text-slate-600">&#8594;</span> {after}{suffix}
        <span className={`ml-2 ${color}`}>{delta > 0 ? "+" : ""}{delta}{suffix}</span>
      </span>
    </div>
  );
}

function CalculatorResult({
  calcGive, setCalcGive, calcReceive, setCalcReceive,
  calcGivePicks, setCalcGivePicks, calcReceivePicks, setCalcReceivePicks,
  allPicks, myAvailPlayers, theirAvailPlayers, myAvailPicks, theirAvailPicks,
  myRoster, calcOpponentRosterId,
  calcVal, getPickValue, pickKey, pickLabel,
  totalGiveAdj, totalReceiveAdj, myDropCostCalc, oppDropCostCalc,
  calcStarOnGive, calcStarOnReceive, net, verdict, verdictColor,
  onMarkAttempted, sessionMarked, onSessionMark,
}: CalculatorResultProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();
  const { previewTradeSimulation } = useValues();

  const opponentRoster = calcOpponentRosterId != null
    ? rosters.find((r) => r.roster_id === calcOpponentRosterId)
    : null;
  const hasPlayerMovement = calcGive.length > 0 || calcReceive.length > 0;
  const simPreviewSignature = `${calcOpponentRosterId ?? ""}|${[...calcGive].sort().join(",")}|${[...calcReceive].sort().join(",")}`;
  const [simPreviewBefore, setSimPreviewBefore] = useState<LeagueSimulation | null>(null);
  const [simPreview, setSimPreview] = useState<LeagueSimulation | null>(null);
  const [simPreviewSignatureRun, setSimPreviewSignatureRun] = useState<string>("");
  const simPreviewStale = simPreview !== null && simPreviewSignatureRun !== simPreviewSignature;
  // Both sides are computed back-to-back off the same live inputs in one click, rather than
  // pairing a live-updating "before" against a frozen "after" — that mismatch (before drifting
  // as async matchup/standings/projection data settled after the click, after staying pinned to
  // whatever was loaded at click time) was the actual source of before/after numbers disagreeing
  // with what the Simulator tab showed a moment later.
  const handleSimPreview = () => {
    if (!myRoster || calcOpponentRosterId == null) return;
    setSimPreviewBefore(previewTradeSimulation(myRoster.roster_id, calcOpponentRosterId, [], []));
    setSimPreview(previewTradeSimulation(myRoster.roster_id, calcOpponentRosterId, calcGive, calcReceive));
    setSimPreviewSignatureRun(simPreviewSignature);
  };

  const tradeRow = (rowKey: string, label: string, value: number, onRemove: () => void) => (
    <div key={rowKey} className="flex items-center justify-between px-3 py-1.5 bg-slate-800 rounded-lg">
      <span className="text-sm truncate">{label}</span>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span className="text-xs text-blue-300 font-mono">{value > 0 ? value.toLocaleString() : "—"}</span>
        <button onClick={onRemove} className="text-slate-600 hover:text-red-400 text-xs">✕</button>
      </div>
    </div>
  );

  return (
    <>
      {/* Trade summary */}
      <Card padding="lg">
        <div className="grid grid-cols-2 gap-6">
          {/* You Give */}
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-red-400 mb-2">You Give</div>
            <div className="space-y-1 min-h-[48px]">
              {calcGive.length === 0 && calcGivePicks.length === 0 && (
                <p className="text-xs text-slate-600">Click assets above to add</p>
              )}
              {calcGive.map((id: string) => {
                const p = players[id];
                return tradeRow(
                  id,
                  `${p?.full_name ?? id} (${p?.position})`,
                  calcVal(id),
                  () => setCalcGive((prev) => prev.filter((x) => x !== id))
                );
              })}
              {calcGivePicks.map((k: string) => {
                const pick = allPicks.find((p) => pickKey(p) === k);
                const label = pick ? pickLabel(pick) : k;
                return tradeRow(k, label, getPickValue(k),
                  () => setCalcGivePicks((prev) => prev.filter((x) => x !== k)));
              })}
            </div>
            {myDropCostCalc > 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 rounded-lg">
                <span className="text-xs text-amber-400 italic">Your Drop Cost</span>
                <span className="text-xs text-amber-400 font-mono">+{myDropCostCalc.toLocaleString()}</span>
              </div>
            )}
            {calcStarOnGive < 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 rounded-lg">
                <span className="text-xs text-violet-400 italic">Star Discount</span>
                <span className="text-xs text-violet-400 font-mono">{calcStarOnGive.toLocaleString()}</span>
              </div>
            )}
            <div className="mt-3 pt-2 border-t border-slate-700 flex justify-between items-center">
              <span className="text-xs text-slate-500">Total</span>
              <span className="text-base font-bold text-red-400">{totalGiveAdj.toLocaleString()}</span>
            </div>
          </div>

          {/* You Receive */}
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-2">You Receive</div>
            <div className="space-y-1 min-h-[48px]">
              {calcReceive.length === 0 && calcReceivePicks.length === 0 && (
                <p className="text-xs text-slate-600">Click assets above to add</p>
              )}
              {calcReceive.map((id: string) => {
                const p = players[id];
                return tradeRow(
                  id,
                  `${p?.full_name ?? id} (${p?.position})`,
                  calcVal(id),
                  () => setCalcReceive((prev) => prev.filter((x) => x !== id))
                );
              })}
              {calcReceivePicks.map((k: string) => {
                const pick = allPicks.find((p) => pickKey(p) === k);
                const label = pick ? pickLabel(pick) : k;
                return tradeRow(k, label, getPickValue(k),
                  () => setCalcReceivePicks((prev) => prev.filter((x) => x !== k)));
              })}
            </div>
            {oppDropCostCalc > 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 rounded-lg">
                <span className="text-xs text-amber-400 italic">Their Drop Cost</span>
                <span className="text-xs text-amber-400 font-mono">+{oppDropCostCalc.toLocaleString()}</span>
              </div>
            )}
            {calcStarOnReceive < 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 rounded-lg">
                <span className="text-xs text-violet-400 italic">Star Discount</span>
                <span className="text-xs text-violet-400 font-mono">{calcStarOnReceive.toLocaleString()}</span>
              </div>
            )}
            <div className="mt-3 pt-2 border-t border-slate-700 flex justify-between items-center">
              <span className="text-xs text-slate-500">Total</span>
              <span className="text-base font-bold text-emerald-400">{totalReceiveAdj.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Verdict */}
        {(calcGive.length > 0 || calcGivePicks.length > 0 || calcReceive.length > 0 || calcReceivePicks.length > 0) && (
          <div className="mt-4 pt-4 border-t border-slate-700 flex items-center justify-between flex-wrap gap-4">
            <div>
              <span className={`text-xl font-black ${verdictColor}`}>{verdict}</span>
              {verdict !== "EVEN" && (
                <span className="ml-2 text-sm text-slate-400">
                  by {Math.abs(net).toLocaleString()} pts
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <TradeValueBars totalGiveAdj={totalGiveAdj} totalReceiveAdj={totalReceiveAdj} />
              <TradeMarginGauge net={net} totalGiveAdj={totalGiveAdj} totalReceiveAdj={totalReceiveAdj} />
            </div>
            <div className="flex items-center gap-3">
              {calcOpponentRosterId != null && (calcGive.length > 0 || calcGivePicks.length > 0) && (calcReceive.length > 0 || calcReceivePicks.length > 0) && selectedLeague && (() => {
                const calcFp = buildTradeFingerprint(
                  selectedLeague.league_id,
                  calcOpponentRosterId,
                  [...calcGive, ...calcGivePicks],
                  [...calcReceive, ...calcReceivePicks],
                );
                const alreadyMarked = sessionMarked.has(calcFp);
                const buildCalcPayload = (direction: "ME" | "THEM") => {
                  const oppRosterForCalc = rosters.find((r) => r.roster_id === calcOpponentRosterId);
                  const oppName = (oppRosterForCalc?.owner_id ? users[oppRosterForCalc.owner_id] : null) || `Team ${calcOpponentRosterId}`;
                  return {
                    league_id: selectedLeague.league_id,
                    partner_roster_id: calcOpponentRosterId,
                    partner_name: oppName,
                    give_players: calcGive.map((id: string) => {
                      const p = players[id];
                      return { player_id: id, name: p?.full_name || id, position: p?.position || "", value: calcVal(id) } as TradeAttemptAsset;
                    }),
                    give_picks: calcGivePicks.map((k: string) => {
                      const pick = allPicks.find((p) => pickKey(p) === k);
                      return { key: k, label: pick ? pickLabel(pick) : k, value: getPickValue(k) } as TradeAttemptPick;
                    }),
                    receive_players: calcReceive.map((id: string) => {
                      const p = players[id];
                      return { player_id: id, name: p?.full_name || id, position: p?.position || "", value: calcVal(id) } as TradeAttemptAsset;
                    }),
                    receive_picks: calcReceivePicks.map((k: string) => {
                      const pick = allPicks.find((p) => pickKey(p) === k);
                      return { key: k, label: pick ? pickLabel(pick) : k, value: getPickValue(k) } as TradeAttemptPick;
                    }),
                    source: "CALCULATOR" as const,
                    initiated_by: direction,
                    status: "PENDING" as const,
                    counter_details: null,
                  };
                };
                if (alreadyMarked) {
                  return <span className="text-xs text-emerald-400 font-semibold">✓ Recorded</span>;
                }
                return (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await onMarkAttempted(buildCalcPayload("ME"));
                        onSessionMark(calcFp);
                      }}
                      className="text-xs font-semibold px-3 py-1 rounded-lg border border-orange-700 text-orange-400 hover:border-orange-500 hover:text-orange-300 transition"
                    >
                      I Sent This
                    </button>
                    <button
                      onClick={async () => {
                        await onMarkAttempted(buildCalcPayload("THEM"));
                        onSessionMark(calcFp);
                      }}
                      className="text-xs font-semibold px-3 py-1 rounded-lg border border-indigo-700 text-indigo-400 hover:border-indigo-500 hover:text-indigo-300 transition"
                    >
                      They Sent This
                    </button>
                  </div>
                );
              })()}
              <button
                onClick={() => { setCalcGive([]); setCalcReceive([]); setCalcGivePicks([]); setCalcReceivePicks([]); }}
                className="text-xs text-slate-600 hover:text-slate-300 transition"
              >
                Clear trade
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Position Health Panel */}
      {(calcGive.length > 0 || calcReceive.length > 0) && (() => {
        const allTeamsCalcPos = rosters.map((r) => computePosTotals(r.players || [], players, calcVal));
        const preT = computePosTotals(myRoster?.players || [], players, calcVal);
        const postT = { ...preT };
        calcGive.forEach((id) => {
          const p = players[id];
          if (p && postT[p.position] !== undefined) postT[p.position] = Math.max(0, postT[p.position] - calcVal(id));
        });
        calcReceive.forEach((id) => {
          const p = players[id];
          if (p && postT[p.position] !== undefined) postT[p.position] = (postT[p.position] || 0) + calcVal(id);
        });
        const positions = ["QB", "RB", "WR", "TE"] as const;
        return (
          <Card className="mt-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Position Health</h3>
            <div className="grid grid-cols-4 gap-2">
              {positions.map((pos) => {
                const preRank = computeLeagueRank(allTeamsCalcPos, pos, preT[pos], rosters.length);
                const postRank = computeLeagueRank(allTeamsCalcPos, pos, postT[pos], rosters.length);
                const delta = preRank - postRank;
                const color = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-slate-500";
                return (
                  <div key={pos} className="bg-slate-800 rounded-xl p-3 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{pos}</div>
                    <div className="text-sm font-bold text-white">#{postRank}</div>
                    <div className={`text-[10px] mt-0.5 ${color}`}>
                      {delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : "—"} from #{preRank}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })()}

      {/* Simulator Preview */}
      {calcOpponentRosterId != null && hasPlayerMovement && (
        <Card className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Simulator Preview</h3>
            <button
              onClick={handleSimPreview}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-700 text-blue-400 hover:border-blue-500 hover:text-blue-300 transition shrink-0"
            >
              {simPreview ? "Re-run Preview" : "Preview in Simulator"}
            </button>
          </div>
          {!simPreview && (
            <p className="text-xs text-slate-600">
              Runs this season&apos;s simulator with the trade applied to estimate the change in playoff odds. Reflects player swaps only — pick-for-pick moves don&apos;t change this season&apos;s projection.
            </p>
          )}
          {simPreview && simPreviewBefore && (() => {
            const myBeforeRow = simPreviewBefore.rowByRosterId.get(Number(myRoster?.roster_id));
            const myAfterRow = simPreview.rowByRosterId.get(Number(myRoster?.roster_id));
            const oppBeforeRow = simPreviewBefore.rowByRosterId.get(calcOpponentRosterId);
            const oppAfterRow = simPreview.rowByRosterId.get(calcOpponentRosterId);
            const oppName = opponentRoster ? (users[opponentRoster.owner_id] || `Team ${opponentRoster.roster_id}`) : "Opponent";
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">You</div>
                  <SimPreviewStatLine label="Playoff Odds" before={myBeforeRow?.playoffOdds} after={myAfterRow?.playoffOdds} suffix="%" />
                  <SimPreviewStatLine label="Title Odds" before={myBeforeRow?.titleOdds} after={myAfterRow?.titleOdds} suffix="%" />
                  <SimPreviewStatLine label="Expected Wins" before={myBeforeRow?.expectedWins} after={myAfterRow?.expectedWins} suffix="" />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 truncate">{oppName}</div>
                  <SimPreviewStatLine label="Playoff Odds" before={oppBeforeRow?.playoffOdds} after={oppAfterRow?.playoffOdds} suffix="%" />
                  <SimPreviewStatLine label="Title Odds" before={oppBeforeRow?.titleOdds} after={oppAfterRow?.titleOdds} suffix="%" />
                  <SimPreviewStatLine label="Expected Wins" before={oppBeforeRow?.expectedWins} after={oppAfterRow?.expectedWins} suffix="" />
                </div>
              </div>
            );
          })()}
          {simPreviewStale && (
            <p className="mt-2 text-[10px] text-amber-500">Trade changed since last preview — click Re-run Preview to refresh.</p>
          )}
        </Card>
      )}

      {/* Trade Equalizer */}
      {verdict !== "EVEN" &&
        (calcGive.length + calcGivePicks.length) > 0 &&
        (calcReceive.length + calcReceivePicks.length) > 0 &&
        (() => {
          const gap = Math.abs(net);
          const youWin = net > 0;

          type EqCandidate = {
            label: string; value: number; age?: number;
            position?: string; isPick: boolean; onAdd: () => void;
          };

          const candidates: EqCandidate[] = youWin
            ? [
                ...myAvailPlayers.map((p) => ({
                  label: p.full_name, value: calcVal(p.player_id),
                  age: p.age, position: p.position, isPick: false,
                  onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                })),
                ...myAvailPicks.map((p) => ({
                  label: pickLabel(p),
                  value: getPickValue(pickKey(p)),
                  isPick: true,
                  onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                })),
              ]
            : [
                ...theirAvailPlayers.map((p) => ({
                  label: p.full_name, value: calcVal(p.player_id),
                  age: p.age, position: p.position, isPick: false,
                  onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                })),
                ...theirAvailPicks.map((p) => ({
                  label: pickLabel(p),
                  value: getPickValue(pickKey(p)),
                  isPick: true,
                  onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                })),
              ];

          const suggestions = candidates
            .filter((c) => c.value > 0)
            .sort((a, b) => Math.abs(a.value - gap) - Math.abs(b.value - gap))
            .slice(0, 5);

          if (suggestions.length === 0) return null;

          return (
            <div className="mt-4 flex justify-center">
              <Card padding="lg" className="w-full max-w-md">
                <h3 className="text-sm font-semibold text-slate-200 mb-3">Equalize the Trade</h3>
                <div className="flex justify-end gap-6 text-[11px] text-slate-500 mb-1 pr-9">
                  <span>Age</span>
                  <span>Value</span>
                </div>
                <div className="space-y-1">
                  {suggestions.map((s) => (
                    <div key={s.label} className="flex items-center justify-between px-3 py-2 bg-slate-800 rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-blue-400 truncate">{s.label}</span>
                        <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                          {s.isPick ? "PICK" : s.position}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <span className="text-xs text-slate-400 w-8 text-right">{s.age ?? ""}</span>
                        <span className="text-xs font-mono text-slate-300 w-12 text-right">{s.value.toLocaleString()}</span>
                        <button
                          onClick={s.onAdd}
                          className="w-6 h-6 bg-blue-500 hover:bg-blue-400 rounded-full flex items-center justify-center text-white text-sm font-bold transition shrink-0"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          );
        })()}

      <p className="text-[10px] text-slate-700 mt-3">
        Pick values shown as averages for that round. Drop Cost reflects the value of the lowest-ranked player your roster would need to cut to absorb extra incoming players. Star Discount applies when the best piece returning is far below the value of the star you&apos;re trading away.
      </p>
    </>
  );
}

export default CalculatorResult;
