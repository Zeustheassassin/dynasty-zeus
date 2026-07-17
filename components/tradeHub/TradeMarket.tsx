"use client";
import React, { useState } from "react";
import type { FcTrendEntry } from "../../lib/types";

interface TradeMarketProps {
  fcTrendData: FcTrendEntry[];
  loadingFcTrends: boolean;
  onRefreshFcTrends: () => void;
}

type MarketView = "TRENDING_UP" | "TRENDING_DOWN" | "MOST_TRADED" | "TARGETS";

function TradeMarket({ fcTrendData, loadingFcTrends, onRefreshFcTrends }: TradeMarketProps) {
  const [marketView, setMarketView] = useState<MarketView>("TARGETS");
  const [marketPosFilter, setMarketPosFilter] = useState<"ALL" | "QB" | "RB" | "WR" | "TE">("ALL");

  const POS_TABS: Array<"ALL" | "QB" | "RB" | "WR" | "TE"> = ["ALL", "QB", "RB", "WR", "TE"];
  const filtered = marketPosFilter === "ALL"
    ? fcTrendData
    : fcTrendData.filter((e) => e.position === marketPosFilter);

  const posColor: Record<string, string> = {
    QB: "text-purple-300", RB: "text-green-300", WR: "text-blue-300", TE: "text-orange-300",
  };

  const RefreshButton = ({ section }: { section: string }) => (
    <button
      onClick={onRefreshFcTrends}
      disabled={loadingFcTrends}
      aria-label={`Refresh ${section} data`}
      className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 disabled:opacity-40 transition"
    >
      <svg aria-hidden="true" className={`w-3 h-3 ${loadingFcTrends ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582M20 20v-5h-.581M5.635 19A9 9 0 104.582 9H4" />
      </svg>
      {loadingFcTrends ? "Refreshing…" : "Refresh"}
    </button>
  );

  const PlayerRow = ({ entry, metric }: { entry: FcTrendEntry; metric: React.ReactNode }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-[10px] font-bold w-7 shrink-0 ${posColor[entry.position] ?? "text-gray-400"}`}>{entry.position}</span>
        <span className="text-sm text-gray-100 truncate">{entry.name}</span>
        {entry.team && <span className="text-[10px] text-gray-500 shrink-0">{entry.team}</span>}
      </div>
      <div className="flex items-center gap-4 shrink-0 ml-3">
        <span className="text-[11px] text-gray-400">Val <span className="text-gray-200">{entry.value.toLocaleString()}</span></span>
        {metric}
      </div>
    </div>
  );

  if (fcTrendData.length === 0 && !loadingFcTrends) return (
    <div className="text-center py-12 text-gray-500 text-sm">
      <p>Market data is loading with dynasty values.</p>
      <p className="mt-1 text-xs text-gray-600">It will appear automatically once FantasyCalc values finish loading.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Sub-view nav */}
      <div className="flex gap-4 border-b border-gray-800 pb-0 overflow-x-auto">
        {(["TRENDING_UP", "TRENDING_DOWN", "MOST_TRADED", "TARGETS"] as const).map((v) => {
          const labels: Record<string, string> = {
            TARGETS: "Rebuilding / Contending",
            TRENDING_UP: "Trending Up",
            TRENDING_DOWN: "Trending Down",
            MOST_TRADED: "Most Traded",
          };
          return (
            <button
              key={v}
              onClick={() => setMarketView(v)}
              className={`pb-2 px-1 text-xs font-semibold whitespace-nowrap transition ${
                marketView === v
                  ? "border-b-2 border-emerald-400 text-emerald-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {labels[v]}
            </button>
          );
        })}
      </div>

      {/* Position filter */}
      <div className="flex gap-2 flex-wrap justify-center">
        {POS_TABS.map((p) => (
          <button
            key={p}
            onClick={() => setMarketPosFilter(p)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
              marketPosFilter === p
                ? "bg-emerald-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* ── Rebuilding / Contending Targets ── */}
      {marketView === "TARGETS" && (() => {
        const withDiff = filtered
          .filter((e) => e.value > 0 && e.redraftValue > 0)
          .map((e) => ({ ...e, diff: e.redraftValue - e.value }));

        const sorted = [...withDiff].sort((a, b) => a.diff - b.diff);
        const rebuilding = sorted.slice(0, 15);
        const contending = [...sorted].reverse().slice(0, 15);

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Rebuilding */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="flex items-center mb-1">
                <div>
                  <div className="text-sm font-bold text-gray-100">Top Rebuilding Targets</div>
                  <div className="text-[11px] text-gray-500">Higher dynasty value than redraft</div>
                </div>
                <RefreshButton section="Rebuilding Targets" />
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] font-semibold uppercase tracking-wide text-gray-600 mb-1 px-1">
                <span>Player</span><span>Diff</span><span>Dyn Val</span>
              </div>
              {rebuilding.length === 0 && <p className="text-xs text-gray-500 mt-2">No data for this filter.</p>}
              {rebuilding.map((e, i) => (
                <div key={e.sleeperId} className="flex items-center gap-2 py-2 border-b border-gray-800 last:border-0">
                  <span className="text-[11px] text-gray-600 w-5 shrink-0">{i + 1}.</span>
                  <span className={`text-[10px] font-bold w-7 shrink-0 ${posColor[e.position] ?? "text-gray-400"}`}>{e.position}</span>
                  <span className="text-sm text-gray-100 truncate flex-1">{e.name}</span>
                  <span className="text-[11px] font-semibold text-red-400 shrink-0">{e.diff.toLocaleString()}</span>
                  <span className="text-[11px] text-gray-400 shrink-0 w-12 text-right">{e.value.toLocaleString()}</span>
                </div>
              ))}
            </div>

            {/* Contending */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="flex items-center mb-1">
                <div>
                  <div className="text-sm font-bold text-gray-100">Top Contending Targets</div>
                  <div className="text-[11px] text-gray-500">Higher redraft value than dynasty</div>
                </div>
                <RefreshButton section="Contending Targets" />
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] font-semibold uppercase tracking-wide text-gray-600 mb-1 px-1">
                <span>Player</span><span>Diff</span><span>Dyn Val</span>
              </div>
              {contending.length === 0 && <p className="text-xs text-gray-500 mt-2">No data for this filter.</p>}
              {contending.map((e, i) => (
                <div key={e.sleeperId} className="flex items-center gap-2 py-2 border-b border-gray-800 last:border-0">
                  <span className="text-[11px] text-gray-600 w-5 shrink-0">{i + 1}.</span>
                  <span className={`text-[10px] font-bold w-7 shrink-0 ${posColor[e.position] ?? "text-gray-400"}`}>{e.position}</span>
                  <span className="text-sm text-gray-100 truncate flex-1">{e.name}</span>
                  <span className={`text-[11px] font-semibold shrink-0 ${e.diff >= 0 ? "text-emerald-400" : "text-yellow-400"}`}>
                    {e.diff >= 0 ? `+${e.diff.toLocaleString()}` : e.diff.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0 w-12 text-right">{e.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Trending Up ── */}
      {marketView === "TRENDING_UP" && (() => {
        const rows = [...filtered]
          .filter((e) => e.trend30Day > 0)
          .sort((a, b) => b.trend30Day - a.trend30Day)
          .slice(0, 25);
        return (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="flex items-center mb-3">
              <div>
                <div className="text-sm font-bold text-gray-100">Trending Up — 30 Day</div>
                <div className="text-[11px] text-gray-500">Biggest dynasty value risers this month</div>
              </div>
              <RefreshButton section="Trending Up" />
            </div>
            {rows.length === 0 && <p className="text-xs text-gray-500">No data for this filter.</p>}
            {rows.map((e) => (
              <PlayerRow
                key={e.sleeperId}
                entry={e}
                metric={
                  <span className="text-[11px] font-semibold text-emerald-400 w-16 text-right">
                    +{e.trend30Day.toLocaleString()}
                  </span>
                }
              />
            ))}
          </div>
        );
      })()}

      {/* ── Trending Down ── */}
      {marketView === "TRENDING_DOWN" && (() => {
        const rows = [...filtered]
          .filter((e) => e.trend30Day < 0)
          .sort((a, b) => a.trend30Day - b.trend30Day)
          .slice(0, 25);
        return (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="flex items-center mb-3">
              <div>
                <div className="text-sm font-bold text-gray-100">Trending Down — 30 Day</div>
                <div className="text-[11px] text-gray-500">Biggest dynasty value fallers this month</div>
              </div>
              <RefreshButton section="Trending Down" />
            </div>
            {rows.length === 0 && <p className="text-xs text-gray-500">No data for this filter.</p>}
            {rows.map((e) => (
              <PlayerRow
                key={e.sleeperId}
                entry={e}
                metric={
                  <span className="text-[11px] font-semibold text-red-400 w-16 text-right">
                    {e.trend30Day.toLocaleString()}
                  </span>
                }
              />
            ))}
          </div>
        );
      })()}

      {/* ── Most Traded ── */}
      {marketView === "MOST_TRADED" && (() => {
        const rows = [...filtered]
          .filter((e) => e.tradeFrequency > 0)
          .sort((a, b) => b.tradeFrequency - a.tradeFrequency)
          .slice(0, 25);
        return (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="flex items-center mb-3">
              <div>
                <div className="text-sm font-bold text-gray-100">Most Traded</div>
                <div className="text-[11px] text-gray-500">Players appearing most frequently in recent trades</div>
              </div>
              <RefreshButton section="Most Traded" />
            </div>
            {rows.length === 0 && <p className="text-xs text-gray-500">No data for this filter.</p>}
            {rows.map((e) => (
              <PlayerRow
                key={e.sleeperId}
                entry={e}
                metric={
                  <span className="text-[11px] font-semibold text-yellow-400 w-20 text-right">
                    {(e.tradeFrequency * 100).toFixed(1)}%
                  </span>
                }
              />
            ))}
          </div>
        );
      })()}
    </div>
  );
}

export default React.memo(TradeMarket);
