"use client";
import React, { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";

const log = logger("components/ManagementHub");
import { SLEEPER_BASE_URL, getPaymentYears } from "../lib/constants";
import type { LeagueMgmtData, CommPaymentsData, LeagueCommitmentStatus, SleeperLeague, SleeperRoster, SleeperUser } from "../lib/types";
import { useAuth } from "../lib/AuthContext";
import { Card } from "./ui/Card";
import ErrorBanner from "./ErrorBanner";

// ── Column definitions (generated dynamically from current year) ───────────
// Window: [currentYear - 1 ... currentYear + 3] — auto-advances each year.
// Adding DB columns for new years is handled in migration 002.
const PAYMENT_YEARS = getPaymentYears();

const PAID_YEAR_COLS = PAYMENT_YEARS.map((year) => ({
  key: `paid_${year}`,
  label: String(year),
}));

const MGMT_COLS: { key: string; label: string }[] = [
  ...PAID_YEAR_COLS,
  { key: "commissioner", label: "Commissioner" },
  { key: "year_in_advance", label: "Year in Advance" },
  { key: "picks_traded", label: "Picks Traded" },
];

// ── Props ──────────────────────────────────────────────────────────────────
interface ManagementHubProps {
  mgmtHubTab: "LEAGUE_MGMT" | "COMMISSIONER_TOOLS" | "BYLAWS";
  setMgmtHubTab: (tab: "LEAGUE_MGMT" | "COMMISSIONER_TOOLS" | "BYLAWS") => void;

  leagueBylaws: Record<string, string>;
  saveLeagueBylaws: (leagueId: string, text: string) => void;

  leagues: SleeperLeague[];
  leagueMgmtData: LeagueMgmtData;
  setLeagueMgmtData: React.Dispatch<React.SetStateAction<LeagueMgmtData>>;

  commPaymentsData: CommPaymentsData;
  setCommPaymentsData: React.Dispatch<React.SetStateAction<CommPaymentsData>>;
  commToolsLeagueId: string;
  setCommToolsLeagueId: (id: string) => void;
  commToolsRosters: SleeperRoster[];
  setCommToolsRosters: (rosters: SleeperRoster[]) => void;
  commToolsUsers: Record<string, SleeperUser>;
  setCommToolsUsers: (users: Record<string, SleeperUser>) => void;
  loadingCommToolsRosters: boolean;
  setLoadingCommToolsRosters: (loading: boolean) => void;

}

// ── Component ──────────────────────────────────────────────────────────────
function ManagementHub({
  mgmtHubTab,
  setMgmtHubTab,
  leagueBylaws,
  saveLeagueBylaws,
  leagues,
  leagueMgmtData,
  setLeagueMgmtData,
  commPaymentsData,
  setCommPaymentsData,
  commToolsLeagueId,
  setCommToolsLeagueId,
  commToolsRosters,
  setCommToolsRosters,
  commToolsUsers,
  setCommToolsUsers,
  loadingCommToolsRosters,
  setLoadingCommToolsRosters,
}: ManagementHubProps) {
  const { supabaseUser } = useAuth();

  const [saveError, setSaveError] = useState<string | null>(null);
  const saveErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bylawsLeagueId, setBylawsLeagueId] = useState<string>("");
  const [lastBylawsSavedAt, setLastBylawsSavedAt] = useState<number | null>(null);
  const bylawsLeague = leagues.find((l) => l.league_id === bylawsLeagueId) ?? leagues[0] ?? null;

  // Clear any pending error timer on unmount to prevent setState-after-unmount.
  useEffect(() => () => {
    if (saveErrorTimerRef.current !== null) clearTimeout(saveErrorTimerRef.current);
  }, []);

  const showSaveError = (msg: string) => {
    setSaveError(msg);
    if (saveErrorTimerRef.current !== null) clearTimeout(saveErrorTimerRef.current);
    saveErrorTimerRef.current = setTimeout(() => setSaveError(null), 4000);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Build the payment year fields for an upsert from an arbitrary row object. */
  const buildPaymentFields = (row: Record<string, boolean | string | undefined>): Record<string, boolean> => {
    const fields: Record<string, boolean> = {};
    PAYMENT_YEARS.forEach((year) => {
      fields[`paid_${year}`] = !!(row[`paid_${year}`] ?? false);
    });
    return fields;
  };

  // ── Handlers ─────────────────────────────────────────────────────────────

  const upsertLeagueMgmt = async (leagueId: string, updated: Record<string, boolean | string | undefined>) => {
    if (!supabaseUser) return;
    const { error } = await supabase.from("league_management").upsert(
      {
        user_id: supabaseUser.id,
        league_id: leagueId,
        ...buildPaymentFields(updated),
        commissioner: updated.commissioner ?? false,
        year_in_advance: updated.year_in_advance ?? false,
        picks_traded: updated.picks_traded ?? false,
        amount: updated.amount ?? "",
        commitment_status: updated.commitment_status ?? "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,league_id" }
    );
    if (error) {
      log.error("league_management upsert failed", { err: error.message });
      showSaveError("Save failed — check your connection and try again.");
    }
  };

  const toggleLeagueMgmt = async (leagueId: string, key: string) => {
    if (!supabaseUser) return;
    const current = leagueMgmtData[leagueId] || {};
    const updated = { ...current, [key]: !current[key] };
    setLeagueMgmtData((prev) => ({ ...prev, [leagueId]: updated }));
    await upsertLeagueMgmt(leagueId, updated);
  };

  const handleAmountChange = (leagueId: string, value: string) => {
    setLeagueMgmtData((prev) => ({
      ...prev,
      [leagueId]: { ...(prev[leagueId] || {}), amount: value },
    }));
  };

  const handleAmountBlur = async (leagueId: string) => {
    const updated = leagueMgmtData[leagueId] || {};
    await upsertLeagueMgmt(leagueId, updated);
  };

  const handleCommitmentChange = async (leagueId: string, value: LeagueCommitmentStatus) => {
    const current = leagueMgmtData[leagueId] || {};
    const updated = { ...current, commitment_status: value };
    setLeagueMgmtData((prev) => ({ ...prev, [leagueId]: updated }));
    await upsertLeagueMgmt(leagueId, updated);
  };

  const handleCommLeagueSelect = async (leagueId: string) => {
    setCommToolsLeagueId(leagueId);
    setCommToolsRosters([]);
    setCommToolsUsers({});
    if (!leagueId) return;
    setLoadingCommToolsRosters(true);
    try {
      const [rostersRes, usersRes] = await Promise.all([
        fetch(`${SLEEPER_BASE_URL}/league/${leagueId}/rosters`),
        fetch(`${SLEEPER_BASE_URL}/league/${leagueId}/users`),
      ]);
      if (!rostersRes.ok || !usersRes.ok) {
        throw new Error(`Sleeper ${rostersRes.status}/${usersRes.status}`);
      }
      const rostersData = await rostersRes.json();
      const usersData = await usersRes.json();
      setCommToolsRosters(rostersData || []);
      const userMap: Record<string, SleeperUser> = {};
      (usersData || []).forEach((u: SleeperUser) => { userMap[u.user_id] = u; });
      setCommToolsUsers(userMap);
    } catch (err) {
      // Without this, a fetch failure left rosters empty and rendered the same
      // "No roster data found." state as a genuinely empty league.
      log.error("commissioner tools league fetch failed", { err: String(err) });
      showSaveError("Couldn't load league rosters — check your connection and try again.");
    } finally {
      setLoadingCommToolsRosters(false);
    }
  };

  const toggleCommPayment = async (leagueId: string, ownerId: string, key: string) => {
    if (!supabaseUser) return;
    const leaguePayments = commPaymentsData[leagueId] || {};
    const ownerPayments = leaguePayments[ownerId] || {};
    const newVal = !ownerPayments[key];
    const updated = { ...ownerPayments, [key]: newVal };
    setCommPaymentsData((prev) => ({
      ...prev,
      [leagueId]: { ...(prev[leagueId] || {}), [ownerId]: updated },
    }));
    const { error } = await supabase.from("commissioner_payments").upsert(
      {
        user_id: supabaseUser.id,
        league_id: leagueId,
        owner_id: ownerId,
        ...buildPaymentFields(updated),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,league_id,owner_id" }
    );
    if (error) {
      log.error("commissioner_payments upsert failed", { err: error.message });
      showSaveError("Save failed — check your connection and try again.");
    }
  };

  const toggleAllCommPayments = async (leagueId: string, key: string, toValue: boolean) => {
    if (!supabaseUser) return;
    const ownerIds = commToolsRosters
      .filter((r) => r.owner_id)
      .map((r) => r.owner_id as string);

    // Optimistic update
    setCommPaymentsData((prev) => {
      const leagueData = { ...(prev[leagueId] || {}) };
      ownerIds.forEach((ownerId) => {
        leagueData[ownerId] = { ...(leagueData[ownerId] || {}), [key]: toValue };
      });
      return { ...prev, [leagueId]: leagueData };
    });

    // Persist each owner — build payment fields dynamically so new years are included automatically
    const results = await Promise.all(
      ownerIds.map((ownerId) => {
        const existing = (commPaymentsData[leagueId] || {})[ownerId] || {};
        const updated = { ...existing, [key]: toValue };
        return supabase.from("commissioner_payments").upsert(
          {
            user_id: supabaseUser.id,
            league_id: leagueId,
            owner_id: ownerId,
            ...buildPaymentFields(updated),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,league_id,owner_id" }
        );
      })
    );

    const failed = results.filter((r) => r.error);
    if (failed.length > 0) {
      log.error("commissioner_payments bulk upserts failed", { count: failed.length });
      showSaveError("Some saves failed — check your connection and try again.");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const commLeagues = leagues.filter((l) => !!leagueMgmtData[l.league_id]?.commissioner);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

      {/* Header card */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Management Hub</div>
            <div className="mt-1 text-sm text-slate-200">
              Track dues, commissioner roles, and advance payments across all your leagues.
            </div>
          </div>
          {!supabaseUser && (
            <div className="text-xs text-slate-500 sm:text-right">
              Log in with a DynastyZeus account to save your settings.
            </div>
          )}
        </div>
      </Card>

      {/* Save error banner */}
      <ErrorBanner message={saveError} className="text-xs" />

      {/* Sub-tab nav */}
      <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1">
        <button
          onClick={() => setMgmtHubTab("LEAGUE_MGMT")}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
            mgmtHubTab === "LEAGUE_MGMT"
              ? "bg-slate-700 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          League Management
        </button>
        <button
          onClick={() => setMgmtHubTab("COMMISSIONER_TOOLS")}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
            mgmtHubTab === "COMMISSIONER_TOOLS"
              ? "bg-slate-700 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Commissioner Tools
        </button>
        <button
          onClick={() => setMgmtHubTab("BYLAWS")}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
            mgmtHubTab === "BYLAWS"
              ? "bg-slate-700 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Bylaws
        </button>
      </div>

      {/* ── LEAGUE MANAGEMENT ── */}
      {mgmtHubTab === "LEAGUE_MGMT" && (
        <Card>
          {leagues.length === 0 ? (
            <p className="text-slate-400 text-sm">Connect your Sleeper account to see your leagues.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-slate-400 font-medium py-2 px-3 border-b border-slate-700 min-w-[140px]"></th>
                    <th className="text-center text-slate-400 font-semibold py-2 px-3 border-b border-slate-700 border-l border-slate-700"></th>
                    <th className="text-center text-slate-400 font-semibold py-2 px-3 border-b border-slate-700 border-l border-slate-700"></th>
                    <th colSpan={PAID_YEAR_COLS.length} className="text-center text-blue-400 font-semibold py-2 px-3 border-b border-slate-700 border-l border-slate-700">Paid</th>
                    <th colSpan={3} className="text-center text-purple-400 font-semibold py-2 px-3 border-b border-slate-700 border-l border-slate-700">Tools</th>
                  </tr>
                  <tr>
                    <th className="text-left text-slate-400 font-medium py-2 px-3 border-b border-slate-700"></th>
                    <th className="text-center text-slate-300 font-medium py-2 px-3 border-b border-slate-700 border-l border-slate-700 min-w-[120px]">Status</th>
                    <th className="text-center text-slate-300 font-medium py-2 px-3 border-b border-slate-700 border-l border-slate-700 min-w-[90px]">Amount</th>
                    {MGMT_COLS.map((col, ci) => (
                      <th
                        key={col.key}
                        className={`text-center text-slate-300 font-medium py-2 px-3 border-b border-slate-700 ${ci === 0 ? "border-l border-slate-700" : ""} ${ci === PAID_YEAR_COLS.length ? "border-l border-slate-700" : ""}`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leagues.map((league, idx) => {
                    const row = leagueMgmtData[league.league_id] || {};
                    const commitmentStatus = row.commitment_status || "";
                    return (
                      <tr key={league.league_id} className={idx % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                        <td
                          className={`py-2 px-3 font-medium whitespace-nowrap border-r border-slate-800 ${
                            commitmentStatus === "leaving" ? "text-red-500" : "text-white"
                          }`}
                        >
                          {league.name}
                        </td>
                        <td className="text-center py-1.5 px-2 border-l border-slate-700">
                          <select
                            value={commitmentStatus}
                            onChange={(e) => handleCommitmentChange(league.league_id, e.target.value as LeagueCommitmentStatus)}
                            className={`w-full px-2 py-1 text-xs rounded border focus:outline-none focus:border-blue-500 ${
                              commitmentStatus === "leaving"
                                ? "bg-red-950/40 border-red-800 text-red-400"
                                : commitmentStatus === "on_fence"
                                ? "bg-amber-950/30 border-amber-800 text-amber-400"
                                : commitmentStatus === "staying"
                                ? "bg-emerald-950/30 border-emerald-800 text-emerald-400"
                                : "bg-slate-800 border-slate-600 text-slate-300"
                            }`}
                          >
                            <option value="">—</option>
                            <option value="staying">Staying long term</option>
                            <option value="on_fence">On the fence</option>
                            <option value="leaving">Leaving EOY</option>
                          </select>
                        </td>
                        <td className="text-center py-1.5 px-2 border-l border-slate-700">
                          <div className="relative flex items-center">
                            <span className="absolute left-2 text-slate-400 text-xs pointer-events-none">$</span>
                            <input
                              type="text"
                              value={row.amount ?? ""}
                              onChange={(e) => handleAmountChange(league.league_id, e.target.value)}
                              onBlur={() => handleAmountBlur(league.league_id)}
                              placeholder="0"
                              className="w-20 pl-4 pr-2 py-1 text-xs text-white bg-slate-800 border border-slate-600 rounded focus:outline-none focus:border-blue-500 text-right"
                            />
                          </div>
                        </td>
                        {MGMT_COLS.map((col, ci) => (
                          <td
                            key={col.key}
                            className={`text-center py-2 px-3 ${ci === 0 ? "border-l border-slate-700" : ""} ${ci === PAID_YEAR_COLS.length ? "border-l border-slate-700" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={!!row[col.key]}
                              onChange={() => toggleLeagueMgmt(league.league_id, col.key)}
                              className="w-4 h-4 accent-blue-500 cursor-pointer"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── COMMISSIONER TOOLS ── */}
      {mgmtHubTab === "COMMISSIONER_TOOLS" && (
        <Card>
          {commLeagues.length === 0 ? (
            <p className="text-slate-400 text-sm">
              No leagues marked as Commissioner in League Management. Check the{" "}
              <button
                onClick={() => setMgmtHubTab("LEAGUE_MGMT")}
                className="text-blue-400 underline"
              >
                Commissioner
              </button>{" "}
              box for a league to use this tab.
            </p>
          ) : (
            <div>
              <div className="mb-5">
                <div className="text-xs text-slate-400 mb-1.5">Select League</div>
                <select
                  value={commToolsLeagueId}
                  onChange={(e) => handleCommLeagueSelect(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select a league</option>
                  {commLeagues.map((l) => (
                    <option key={l.league_id} value={l.league_id}>{l.name}</option>
                  ))}
                </select>
              </div>

              {commToolsLeagueId && (
                loadingCommToolsRosters ? (
                  <div className="text-sm text-slate-400">Loading owners...</div>
                ) : commToolsRosters.length === 0 ? (
                  <div className="text-sm text-slate-400">No roster data found.</div>
                ) : (() => {
                  const totalOwners = commToolsRosters.filter((r) => r.owner_id).length;
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr>
                            <th className="text-left text-slate-400 font-medium py-2 px-3 border-b border-slate-700 min-w-[160px]">Owner</th>
                            {PAID_YEAR_COLS.map((col) => {
                              const paidCount = commToolsRosters.filter(
                                (r) => r.owner_id && (commPaymentsData[commToolsLeagueId] || {})[r.owner_id]?.[col.key]
                              ).length;
                              const allPaid = totalOwners > 0 && paidCount === totalOwners;
                              return (
                                <th key={col.key} className="text-center text-blue-400 font-medium py-2 px-3 border-b border-slate-700">
                                  <div>{col.label}</div>
                                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                                    {paidCount}/{totalOwners} paid
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => toggleAllCommPayments(commToolsLeagueId, col.key, !allPaid)}
                                    className="mt-1 text-[10px] text-blue-400 hover:text-blue-300 transition font-normal"
                                  >
                                    {allPaid ? "Clear all" : "Mark all"}
                                  </button>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {commToolsRosters.map((roster, idx) => {
                            const ownerId = roster.owner_id;
                            if (!ownerId) return null;
                            const ownerUser = commToolsUsers[ownerId];
                            const displayName = ownerUser?.display_name || ownerUser?.username || ownerId;
                            const ownerPayments = (commPaymentsData[commToolsLeagueId] || {})[ownerId] || {};
                            return (
                              <tr key={ownerId} className={idx % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                                <td className="py-2 px-3 text-white font-medium whitespace-nowrap border-r border-slate-800">
                                  {displayName}
                                </td>
                                {PAID_YEAR_COLS.map((col) => (
                                  <td key={col.key} className="text-center py-2 px-3">
                                    <input
                                      type="checkbox"
                                      checked={!!ownerPayments[col.key]}
                                      onChange={() => toggleCommPayment(commToolsLeagueId, ownerId, col.key)}
                                      className="w-4 h-4 accent-blue-500 cursor-pointer"
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
                })()
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── BYLAWS ── */}
      {mgmtHubTab === "BYLAWS" && (
        <Card className="space-y-3">
          {leagues.length === 0 ? (
            <p className="text-slate-400 text-sm">Connect your Sleeper account to see your leagues.</p>
          ) : bylawsLeague ? (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-300">Bylaws for:</span>
                <select
                  className="bg-slate-800 border border-slate-700 text-sm text-white rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
                  value={bylawsLeague.league_id}
                  onChange={(e) => setBylawsLeagueId(e.target.value)}
                >
                  {leagues.map((lg) => <option key={lg.league_id} value={lg.league_id}>{lg.name}</option>)}
                </select>
              </div>
              <textarea
                className="w-full h-80 bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none"
                placeholder={`Record ${bylawsLeague.name}'s constitution, dues, scoring rules, keeper/rookie draft rules, tiebreakers…`}
                value={leagueBylaws[bylawsLeague.league_id] ?? ""}
                onChange={(e) => { saveLeagueBylaws(bylawsLeague.league_id, e.target.value); setLastBylawsSavedAt(Date.now()); }}
              />
              <p className="text-[10px] text-slate-600">
                {lastBylawsSavedAt
                  ? <span className="text-emerald-500">✓ Saved just now{supabaseUser ? " · syncing across devices" : ""}</span>
                  : supabaseUser ? "Bylaws sync across your devices." : "Log in with a DynastyZeus account to save your bylaws."}
              </p>
            </>
          ) : null}
        </Card>
      )}

    </div>
  );
}

export default React.memo(ManagementHub);
