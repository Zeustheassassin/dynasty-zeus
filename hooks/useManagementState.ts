"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseclient";
import type { LeagueMgmtData, CommPaymentsData, SleeperRoster, SleeperUser } from "../lib/types";

export type MgmtHubTab = "LEAGUE_MGMT" | "COMMISSIONER_TOOLS";

export function useManagementState(supabaseUser: { id: string } | null) {
  const [mgmtHubTab, setMgmtHubTab] = useState<MgmtHubTab>("LEAGUE_MGMT");
  const [leagueMgmtData, setLeagueMgmtData] = useState<LeagueMgmtData>({});
  const [commPaymentsData, setCommPaymentsData] = useState<CommPaymentsData>({});
  const [commToolsLeagueId, setCommToolsLeagueId] = useState<string>("");
  const [commToolsRosters, setCommToolsRosters] = useState<SleeperRoster[]>([]);
  const [commToolsUsers, setCommToolsUsers] = useState<Record<string, SleeperUser>>({});
  const [loadingCommToolsRosters, setLoadingCommToolsRosters] = useState(false);

  useEffect(() => {
    if (!supabaseUser) return;

    // League management checkboxes
    supabase
      .from("league_management")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .then(({ data, error }) => {
        if (error) {
          console.error("[useManagementState] league_management load failed:", error.message);
          return;
        }
        if (data && data.length > 0) {
          const map: LeagueMgmtData = {};
          data.forEach((row: Record<string, unknown>) => {
            // Read all paid_YYYY keys dynamically so new year columns
            // added via migration are picked up without code changes.
            const paymentFields: Record<`paid_${number}`, boolean> = {};
            Object.keys(row).forEach((k) => {
              if (k.startsWith("paid_")) {
                (paymentFields as Record<string, boolean>)[k] = Boolean(row[k]);
              }
            });
            const leagueId = String(row.league_id);
            map[leagueId] = {
              ...paymentFields,
              commissioner: Boolean(row.commissioner),
              year_in_advance: Boolean(row.year_in_advance),
              picks_traded: Boolean(row.picks_traded),
              amount: typeof row.amount === "string" ? row.amount : "",
            };
          });
          setLeagueMgmtData(map);
        }
      });

    // Commissioner payments
    supabase
      .from("commissioner_payments")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .then(({ data, error }) => {
        if (error) {
          console.error("[useManagementState] commissioner_payments load failed:", error.message);
          return;
        }
        if (data && data.length > 0) {
          const map: CommPaymentsData = {};
          data.forEach((row: Record<string, unknown>) => {
            const leagueId = String(row.league_id);
            const ownerId = String(row.owner_id);
            if (!map[leagueId]) map[leagueId] = {};
            // Read all paid_YYYY keys dynamically — matches ManagementHub's approach.
            const payments: Record<string, boolean> = {};
            Object.keys(row).forEach((k) => {
              if (k.startsWith("paid_")) payments[k] = Boolean(row[k]);
            });
            map[leagueId][ownerId] = payments;
          });
          setCommPaymentsData(map);
        }
      });
  }, [supabaseUser]);

  return {
    mgmtHubTab,
    setMgmtHubTab,
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
  };
}
