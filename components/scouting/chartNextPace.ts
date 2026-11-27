// Scouting → Chart Next: the user's charting pace, in sample plays (the plays
// a Big Board sample counts), charted over the last PACE_DAYS. Four count-only
// reads (no rows come back), one per play table, each filtered the way
// prospect_sample_counts (migration 102) and the WR SAE sample count:
//
//   QB  qb_plays    graded throws: play_type <> 'run', accuracy set, not 'tipped_ball'
//   RB  rb_plays    known runs: one of the four run schemes, success set
//   WR  route_plays routes run (no_route_run = false)
//   TE  te_plays    rated routes: play_type = 'route_run', was_open set
//
// By when each play was saved (created_at), across every class. Owner-only RLS
// on the play tables keeps it to the user's own plays.

import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { PACE_DAYS, type PaceCounts } from "../../lib/scouting/chartNext";

const log = logger("chartNextPace");

const RUN_SCHEMES = ["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"];

/** Sample plays charted since `now − days`, by position; null if any count failed. */
export async function fetchChartingPace(now = new Date(), days = PACE_DAYS): Promise<PaceCounts | null> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const head = { count: "exact" as const, head: true };
  const results = await Promise.all([
    supabase.from("qb_plays").select("id", head).gte("created_at", since)
      .neq("play_type", "run").not("accuracy", "is", null).neq("accuracy", "tipped_ball"),
    supabase.from("rb_plays").select("id", head).gte("created_at", since)
      .in("run_type", RUN_SCHEMES).not("success", "is", null),
    supabase.from("route_plays").select("id", head).gte("created_at", since)
      .eq("no_route_run", false),
    supabase.from("te_plays").select("id", head).gte("created_at", since)
      .eq("play_type", "route_run").not("was_open", "is", null),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    log.error("charting pace counts", { msg: failed.error.message, code: failed.error.code });
    return null;
  }
  const [qb, rb, wr, te] = results.map((r) => r.count ?? 0);
  return { QB: qb, RB: rb, WR: wr, TE: te };
}
