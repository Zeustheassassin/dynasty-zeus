"use client";
import { useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import { useDebouncedKeyedEffect } from "../lib/hooks/useDebouncedKeyedEffect";
import type { LeagueMgmtData, CommPaymentsData, SleeperRoster, SleeperUser } from "../lib/types";

const log = logger("hooks/useManagementState");

export type MgmtHubTab = "LEAGUE_MGMT" | "COMMISSIONER_TOOLS" | "BYLAWS";

export interface UseManagementStateReturn {
  mgmtHubTab: MgmtHubTab;
  setMgmtHubTab: Dispatch<SetStateAction<MgmtHubTab>>;
  leagueMgmtData: LeagueMgmtData;
  setLeagueMgmtData: Dispatch<SetStateAction<LeagueMgmtData>>;
  commPaymentsData: CommPaymentsData;
  setCommPaymentsData: Dispatch<SetStateAction<CommPaymentsData>>;
  commToolsLeagueId: string;
  setCommToolsLeagueId: Dispatch<SetStateAction<string>>;
  commToolsRosters: SleeperRoster[];
  setCommToolsRosters: Dispatch<SetStateAction<SleeperRoster[]>>;
  commToolsUsers: Record<string, SleeperUser>;
  setCommToolsUsers: Dispatch<SetStateAction<Record<string, SleeperUser>>>;
  loadingCommToolsRosters: boolean;
  setLoadingCommToolsRosters: Dispatch<SetStateAction<boolean>>;
  leagueBylaws: Record<string, string>;
  saveLeagueBylaws: (leagueId: string, text: string) => void;
}

export function useManagementState(supabaseUser: { id: string } | null): UseManagementStateReturn {
  const [mgmtHubTab, setMgmtHubTab] = useState<MgmtHubTab>("LEAGUE_MGMT");
  const [leagueMgmtData, setLeagueMgmtData] = useState<LeagueMgmtData>({});
  const [commPaymentsData, setCommPaymentsData] = useState<CommPaymentsData>({});
  const [commToolsLeagueId, setCommToolsLeagueId] = useState<string>("");
  const [commToolsRosters, setCommToolsRosters] = useState<SleeperRoster[]>([]);
  const [commToolsUsers, setCommToolsUsers] = useState<Record<string, SleeperUser>>({});
  const [loadingCommToolsRosters, setLoadingCommToolsRosters] = useState(false);
  const [leagueBylaws, setLeagueBylaws] = useState<Record<string, string>>({});
  // Debounces the bylaws Supabase write so rapid typing collapses to one
  // upsert of the final text per league, instead of one per keystroke.
  const scheduleWrite = useDebouncedKeyedEffect();

  useEffect(() => {
    if (!supabaseUser) return;

    let cancelled = false;

    // League management checkboxes
    supabase
      .from("league_management")
      .select("*")
      .eq("user_id", supabaseUser.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          log.error("league_management load failed", { err: error.message });
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
        if (cancelled) return;
        if (error) {
          log.error("commissioner_payments load failed", { err: error.message });
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

    // League bylaws/constitution text (Phase I, I3)
    supabase
      .from("league_bylaws")
      .select("league_id, content")
      .eq("user_id", supabaseUser.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          log.error("league_bylaws load failed", { err: error.message });
          return;
        }
        if (data && data.length > 0) {
          const map: Record<string, string> = {};
          data.forEach((row: { league_id: string; content: string }) => { map[row.league_id] = row.content; });
          setLeagueBylaws(map);
        }
      });

    return () => { cancelled = true; };
  }, [supabaseUser]);

  const saveLeagueBylaws = (leagueId: string, text: string) => {
    setLeagueBylaws((prev) => ({ ...prev, [leagueId]: text }));
    if (!supabaseUser) return;
    scheduleWrite(`league_bylaws:${supabaseUser.id}:${leagueId}`, () => {
      supabase.from("league_bylaws").upsert(
        { user_id: supabaseUser.id, league_id: leagueId, content: text, updated_at: new Date().toISOString() },
        { onConflict: "user_id,league_id" }
      ).then(({ error }) => {
        if (error) log.error("league_bylaws upsert failed", { err: error.message });
      });
    });
  };

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
    leagueBylaws,
    saveLeagueBylaws,
  };
}
