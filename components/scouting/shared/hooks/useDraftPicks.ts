"use client";
import { useCallback, useEffect, useState } from "react";
import { logger } from "../../../../lib/logger";
import type { DraftPickRow } from "../../../../lib/nflDraft";
import { LANDING_FIRST_CLASS } from "../../../../lib/scouting/dynastyScore";
import { supabase } from "../../../../lib/supabaseclient";

const log = logger("useDraftPicks");
const COLS = "year,overall,round,pick,nfl_team_id,nfl_team,position,name,college";
const PAGE = 1000;

export interface UseDraftPicksReturn {
  /** Every stored NFL pick from LANDING_FIRST_CLASS's draft on (cfd_draft_picks, migration 090). */
  picks: DraftPickRow[];
  /** Read them again (after the Post-Draft tab loads a year). */
  reload: () => void;
}

/**
 * The stored NFL draft results Dynasty+ counts rookie competition from. A
 * missing table (migration 090 not applied) reads as no picks, so the board
 * just shows competition as not loaded.
 */
export function useDraftPicks(): UseDraftPicksReturn {
  const [picks, setPicks] = useState<DraftPickRow[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: DraftPickRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("cfd_draft_picks").select(COLS)
          .gte("year", LANDING_FIRST_CLASS).order("year").order("overall")
          .range(from, from + PAGE - 1);
        if (error) { log.warn("draft results not read (is migration 090 applied?)", { msg: error.message }); return; }
        all.push(...((data ?? []) as DraftPickRow[]));
        if (!data || data.length < PAGE) break;
      }
      if (!cancelled) setPicks(all);
    })().catch((e: unknown) => log.error("draft results read failed", { msg: String(e) }));
    return () => { cancelled = true; };
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { picks, reload };
}
