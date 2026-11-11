// ============================================================
// Cron — NFL contracts refresh (contracts plan, step 2)
// ============================================================
// Loads nflverse's historical_contracts.parquet (OverTheCap data) and the
// DynastyProcess id crosswalk, keeps each player's latest contract
// (lib/nflContracts.ts) and upserts one row per player into nfl_contracts
// (migration 096), onConflict otc_id. It never deletes: a released or unsigned
// player's latest deal comes back with is_active = false and his row flips.
// All positions are kept, so team rooms and cap commitments can be built
// later; the flags (expiring, long-term, cut risk) are derived in TypeScript
// when read, never stored.
//
// Schedule (vercel.json): daily in March–May (free agency, the draft, UDFA
// signings), Fridays the rest of the year (the crosswalk is committed early
// Friday UTC). The first load can be started from the Vercel dashboard's
// Cron Jobs "Run" button.
//
// Guards: if the parquet parses to fewer than MIN_ACTIVE active contracts or
// the crosswalk to fewer than MIN_ID_MAPPINGS ids, nothing is written (a
// broken file must not flip the league inactive or blank every sleeper_id).
//
// Auth mirrors the other crons: Authorization: Bearer ${CRON_SECRET}, and the
// service-role client (users have SELECT only).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { logger } from "../../../../lib/logger";
import { verifyCron } from "../../../../lib/server/verifyCron";
import { fetchContractSources } from "../../../../lib/server/nflContracts";
import { buildContractRows } from "../../../../lib/nflContracts";

const log = logger("cron/nfl-contracts");

export const maxDuration = 120;

/** ~2,500 contracts are active league-wide; far fewer means a truncated or changed file. */
const MIN_ACTIVE = 1500;
/** The crosswalk maps ~10,000+ gsis ids; far fewer means a broken download. */
const MIN_ID_MAPPINGS = 5000;
const BATCH = 500;
const SKILL = new Set(["QB", "RB", "WR", "TE"]);

export async function GET(req: NextRequest): Promise<Response> {
  const unauthorized = verifyCron(req, log);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    log.error("Supabase service-role env vars not configured");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  let sources: Awaited<ReturnType<typeof fetchContractSources>>;
  try {
    sources = await fetchContractSources();
  } catch (err) {
    log.error("contract sources unavailable — nothing written", { error: String(err) });
    return NextResponse.json({ ok: false, error: "Contract sources unavailable" }, { status: 502 });
  }

  const { activeInFile } = sources;
  if (activeInFile < MIN_ACTIVE || sources.gsisToSleeper.size < MIN_ID_MAPPINGS) {
    log.error("contract sources look broken — nothing written", {
      activeInFile, idMappings: sources.gsisToSleeper.size,
    });
    return NextResponse.json(
      { ok: false, error: "Contract sources look incomplete", activeInFile, idMappings: sources.gsisToSleeper.size },
      { status: 502 },
    );
  }

  const rows = buildContractRows(sources.contracts, sources.gsisToSleeper, {
    now: new Date(),
    sourceUpdatedAt: sources.sourceUpdatedAt,
  });

  let rowsWritten = 0;
  let failedBatches = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("nfl_contracts").upsert(batch, { onConflict: "otc_id" });
    if (error) {
      failedBatches++;
      log.error("nfl_contracts upsert failed", { batchStart: i, err: error.message });
      continue;
    }
    rowsWritten += batch.length;
  }

  const activeSkill = rows.filter((r) => r.is_active && SKILL.has(r.position));
  const summary = {
    ok: failedBatches === 0,
    rows: rows.length,
    rowsWritten,
    failedBatches,
    active: rows.filter((r) => r.is_active).length,
    activeSkill: activeSkill.length,
    activeSkillWithSleeperId: activeSkill.filter((r) => r.sleeper_id).length,
    sourceUpdatedAt: sources.sourceUpdatedAt,
  };
  if (failedBatches) log.error("nfl-contracts finished with failed batches", summary);
  else log.info("nfl-contracts refreshed", summary);
  return NextResponse.json(summary, { status: failedBatches ? 500 : 200 });
}
