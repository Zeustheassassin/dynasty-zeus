"use client";
import React, { useState } from "react";
import { supabase } from "../lib/supabaseclient";
import { SLEEPER_BASE_URL, getPaymentYears } from "../lib/constants";

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
  mgmtHubTab: "LEAGUE_MGMT" | "COMMISSIONER_TOOLS";
  setMgmtHubTab: (tab: "LEAGUE_MGMT" | "COMMISSIONER_TOOLS") => void;

  leagues: any[];
  leagueMgmtData: Record<string, Record<string, any>>;
  setLeagueMgmtData: React.Dispatch<React.SetStateAction<Record<string, Record<string, any>>>>;

  commPaymentsData: Record<string, Record<string, Record<string, boolean>>>;
  setCommPaymentsData: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, Record<string, boolean>>>>
  >;
  commToolsLeagueId: string;
  setCommToolsLeagueId: (id: string) => void;
  commToolsRosters: any[];
  setCommToolsRosters: (rosters: any[]) => void;
  commToolsUsers: Record<string, any>;
  setCommToolsUsers: (users: Record<string, any>) => void;
  loadingCommToolsRosters: boolean;
  setLoadingCommToolsRosters: (loading: boolean) => void;

  supabaseUser: any;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function ManagementHub({
  mgmtHubTab,
  setMgmtHubTab,
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
  supabaseUser,
}: ManagementHubProps) {

  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Build the payment year fields for an upsert from an arbitrary row object. */
  const buildPaymentFields = (row: Record<string, any>): Record<string, boolean> => {
    const fields: Record<string, boolean> = {};
    PAYMENT_YEARS.forEach((year) => {
      fields[`paid_${year}`] = row[`paid_${year}`] ?? false;
    });
    return fields;
  };

  // ── Handlers ─────────────────────────────────────────────────────────────

  const upsertLeagueMgmt = async (leagueId: string, updated: Record<string, any>) => {
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,league_id" }
    );
    if (error) {
      console.error("[ManagementHub] league_management upsert failed:", error.message);
      setSaveError("Save failed — check your connection and try again.");
      setTimeout(() => setSaveError(null), 4000);
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
      const rostersData = await rostersRes.json();
      const usersData = await usersRes.json();
      setCommToolsRosters(rostersData || []);
      const userMap: Record<string, any> = {};
      (usersData || []).forEach((u: any) => { userMap[u.user_id] = u; });
      setCommToolsUsers(userMap);
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
      console.error("[ManagementHub] commissioner_payments upsert failed:", error.message);
      setSaveError("Save failed — check your connection and try again.");
      setTimeout(() => setSaveError(null), 4000);
    }
  };

  const toggleAllCommPayments = async (leagueId: string, key: string, toValue: boolean) => {
    if (!supabaseUser) return;
    const ownerIds = commToolsRosters
      .filter((r: any) => r.owner_id)
      .map((r: any) => r.owner_id as string);

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
      console.error(`[ManagementHub] ${failed.length} commissioner_payments bulk upserts failed`);
      setSaveError("Some saves failed — check your connection and try again.");
      setTimeout(() => setSaveError(null), 4000);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const commLeagues = leagues.filter((l: any) => !!leagueMgmtData[l.league_id]?.commissioner);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

      {/* Header card */}
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Management Hub</div>
            <div className="mt-1 text-sm text-gray-200">
              Track dues, commissioner roles, and advance payments across all your leagues.
            </div>
          </div>
          {!supabaseUser && (
            <div className="text-xs text-gray-500 sm:text-right">
              Log in with a DynastyZeus account to save your settings.
            </div>
          )}
        </div>
      </div>

      {/* Save error banner */}
      {saveError && (
        <div className="rounded-xl border border-red-700 bg-red-900/40 px-4 py-2 text-xs text-red-300">
          {saveError}
        </div>
      )}

      {/* Sub-tab nav */}
      <div className="flex gap-1 bg-gray-800/60 rounded-xl p-1">
        <button
          onClick={() => setMgmtHubTab("LEAGUE_MGMT")}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
            mgmtHubTab === "LEAGUE_MGMT"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          League Management
        </button>
        <button
          onClick={() => setMgmtHubTab("COMMISSIONER_TOOLS")}
          className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
            mgmtHubTab === "COMMISSIONER_TOOLS"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Commissioner Tools
        </button>
      </div>

      {/* ── LEAGUE MANAGEMENT ── */}
      {mgmtHubTab === "LEAGUE_MGMT" && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          {leagues.length === 0 ? (
            <p className="text-gray-400 text-sm">Connect your Sleeper account to see your leagues.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-gray-400 font-medium py-2 px-3 border-b border-gray-700 min-w-[140px]"></th>
                    <th className="text-center text-gray-400 font-semibold py-2 px-3 border-b border-gray-700 border-l border-gray-700"></th>
                    <th colSpan={PAID_YEAR_COLS.length} className="text-center text-blue-400 font-semibold py-2 px-3 border-b border-gray-700 border-l border-gray-700">Paid</th>
                    <th colSpan={3} className="text-center text-purple-400 font-semibold py-2 px-3 border-b border-gray-700 border-l border-gray-700">Tools</th>
                  </tr>
                  <tr>
                    <th className="text-left text-gray-400 font-medium py-2 px-3 border-b border-gray-700"></th>
                    <th className="text-center text-gray-300 font-medium py-2 px-3 border-b border-gray-700 border-l border-gray-700 min-w-[90px]">Amount</th>
                    {MGMT_COLS.map((col, ci) => (
                      <th
                        key={col.key}
                        className={`text-center text-gray-300 font-medium py-2 px-3 border-b border-gray-700 ${ci === 0 ? "border-l border-gray-700" : ""} ${ci === PAID_YEAR_COLS.length ? "border-l border-gray-700" : ""}`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leagues.map((league: any, idx: number) => {
                    const row = leagueMgmtData[league.league_id] || {};
                    return (
                      <tr key={league.league_id} className={idx % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                        <td className="py-2 px-3 text-white font-medium whitespace-nowrap border-r border-gray-800">
                          {league.name}
                        </td>
                        <td className="text-center py-1.5 px-2 border-l border-gray-700">
                          <div className="relative flex items-center">
                            <span className="absolute left-2 text-gray-400 text-xs pointer-events-none">$</span>
                            <input
                              type="text"
                              value={row.amount ?? ""}
                              onChange={(e) => handleAmountChange(league.league_id, e.target.value)}
                              onBlur={() => handleAmountBlur(league.league_id)}
                              placeholder="0"
                              className="w-20 pl-4 pr-2 py-1 text-xs text-white bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-blue-500 text-right"
                            />
                          </div>
                        </td>
                        {MGMT_COLS.map((col, ci) => (
                          <td
                            key={col.key}
                            className={`text-center py-2 px-3 ${ci === 0 ? "border-l border-gray-700" : ""} ${ci === PAID_YEAR_COLS.length ? "border-l border-gray-700" : ""}`}
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
        </div>
      )}

      {/* ── COMMISSIONER TOOLS ── */}
      {mgmtHubTab === "COMMISSIONER_TOOLS" && (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          {commLeagues.length === 0 ? (
            <p className="text-gray-400 text-sm">
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
                <div className="text-xs text-gray-400 mb-1.5">Select League</div>
                <select
                  value={commToolsLeagueId}
                  onChange={(e) => handleCommLeagueSelect(e.target.value)}
                  className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select a league</option>
                  {commLeagues.map((l: any) => (
                    <option key={l.league_id} value={l.league_id}>{l.name}</option>
                  ))}
                </select>
              </div>

              {commToolsLeagueId && (
                loadingCommToolsRosters ? (
                  <div className="text-sm text-gray-400">Loading owners...</div>
                ) : commToolsRosters.length === 0 ? (
                  <div className="text-sm text-gray-400">No roster data found.</div>
                ) : (() => {
                  const totalOwners = commToolsRosters.filter((r: any) => r.owner_id).length;
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr>
                            <th className="text-left text-gray-400 font-medium py-2 px-3 border-b border-gray-700 min-w-[160px]">Owner</th>
                            {PAID_YEAR_COLS.map((col) => {
                              const paidCount = commToolsRosters.filter(
                                (r: any) => r.owner_id && (commPaymentsData[commToolsLeagueId] || {})[r.owner_id]?.[col.key]
                              ).length;
                              const allPaid = totalOwners > 0 && paidCount === totalOwners;
                              return (
                                <th key={col.key} className="text-center text-blue-400 font-medium py-2 px-3 border-b border-gray-700">
                                  <div>{col.label}</div>
                                  <div className="text-[10px] text-gray-500 font-normal mt-0.5">
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
                          {commToolsRosters.map((roster: any, idx: number) => {
                            const ownerId = roster.owner_id;
                            if (!ownerId) return null;
                            const ownerUser = commToolsUsers[ownerId];
                            const displayName = ownerUser?.display_name || ownerUser?.username || ownerId;
                            const ownerPayments = (commPaymentsData[commToolsLeagueId] || {})[ownerId] || {};
                            return (
                              <tr key={ownerId} className={idx % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                                <td className="py-2 px-3 text-white font-medium whitespace-nowrap border-r border-gray-800">
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
        </div>
      )}

    </div>
  );
}
