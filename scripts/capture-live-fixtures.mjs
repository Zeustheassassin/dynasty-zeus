// Records what the live data sources ACTUALLY return during real NFL games, so
// the Gameday Hub's parsers/models can be checked against reality instead of
// documented shapes. Idles until a game is near, snapshots while games are
// live, exits once every game in the week is Final.
//
// Captures (all trimmed to what the app reads):
//   - ESPN scoreboard: status/clock/period/situation/competitors per game
//   - Sleeper live stats: /stats/nfl/regular/{season}/{week} (does it update in-game?)
//   - ESPN injuries: name/team/status/date (once at start, once at the end)
//
// Usage:  node scripts/capture-live-fixtures.mjs [--interval 120] [--out <dir>]
// Output: ~/dynastyzeus-captures/live/<date>/  (outside the repo)
// Stop:   Ctrl+C, or it exits by itself after the last game goes Final.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const INTERVAL_MS = Number(argVal("--interval", 120)) * 1000;
const day = new Date().toISOString().slice(0, 10);
// Outside the repo on purpose: `next build` can wipe .next/, which would destroy a
// capture that runs for hours.
const OUT_DIR = argVal("--out", path.join(os.homedir(), "dynastyzeus-captures", "live", day));
const SOON_MS = 15 * 60_000;
const MAX_RUNTIME_MS = 16 * 60 * 60_000;
const TRACKED = ["pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td", "pts_ppr", "pts_half_ppr", "pts_std", "gp", "off_snp"];

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_INJURIES = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";
const SLEEPER_STATS = (season, week) => `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const startedAt = Date.now();
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const log = (...m) => console.log(`[${new Date().toISOString()}]`, ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = (name, data) => fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data));

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 dynastyzeus-capture" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const trimScoreboard = (json) => ({
  week: json.week?.number,
  season: json.season?.year,
  events: (json.events ?? []).map((e) => {
    const c = e.competitions?.[0] ?? {};
    return {
      id: e.id,
      name: e.shortName,
      date: c.date ?? e.date,
      status: c.status ?? e.status,
      situation: c.situation ? { possession: c.situation.possession, down: c.situation.down, distance: c.situation.distance, isRedZone: c.situation.isRedZone } : null,
      competitors: (c.competitors ?? []).map((x) => ({ id: x.id, homeAway: x.homeAway, score: x.score, team: { id: x.team?.id, abbreviation: x.team?.abbreviation } })),
    };
  }),
});

const trimStats = (json) => {
  const out = {};
  for (const [id, stats] of Object.entries(json ?? {})) {
    const kept = {};
    for (const k of TRACKED) if (stats?.[k] != null) kept[k] = stats[k];
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
};

const trimInjuries = (json) => {
  const rows = [];
  for (const team of json.injuries ?? []) {
    for (const i of team.injuries ?? []) {
      rows.push({
        name: i.athlete?.displayName,
        position: i.athlete?.position?.abbreviation,
        team: team.displayName,
        status: i.status,
        date: i.date,
      });
    }
  }
  return rows;
};

async function snapshot(label, scoreboardJson, { withInjuries = false } = {}) {
  const ts = stamp();
  const season = scoreboardJson.season?.year;
  const week = scoreboardJson.week?.number;
  save(`${ts}-scoreboard.json`, trimScoreboard(scoreboardJson));
  try {
    if (season && week) save(`${ts}-sleeper-stats.json`, trimStats(await getJson(SLEEPER_STATS(season, week))));
  } catch (e) { log("stats fetch failed:", String(e)); }
  if (withInjuries) {
    try { save(`${ts}-injuries.json`, trimInjuries(await getJson(ESPN_INJURIES))); } catch (e) { log("injuries fetch failed:", String(e)); }
  }
  log(`snapshot (${label}) week ${week}`);
}

(async () => {
  log(`capturing to ${OUT_DIR}, every ${INTERVAL_MS / 1000}s while games are live`);
  let sawLive = false;
  let capturedRaw = false;
  let injuriesAtStart = false;

  while (Date.now() - startedAt < MAX_RUNTIME_MS) {
    let sb;
    try { sb = await getJson(ESPN_SCOREBOARD); } catch (e) { log("scoreboard fetch failed:", String(e)); await sleep(INTERVAL_MS); continue; }

    const events = sb.events ?? [];
    const states = events.map((e) => (e.competitions?.[0]?.status ?? e.status)?.type?.state);
    const kickoffs = events
      .filter((e, i) => states[i] === "pre")
      .map((e) => Date.parse(e.competitions?.[0]?.date ?? e.date))
      .filter(Number.isFinite);
    const anyLive = states.includes("in");
    const nextKickoff = kickoffs.length ? Math.min(...kickoffs) : Infinity;
    const soon = nextKickoff - Date.now() <= SOON_MS;

    if (anyLive || soon) {
      if (!injuriesAtStart) {
        await snapshot("start + injuries", sb, { withInjuries: true });
        injuriesAtStart = true;
      } else {
        await snapshot(anyLive ? "live" : "pre-kickoff", sb);
      }
      if (anyLive && !capturedRaw) {
        save(`${stamp()}-RAW-first-live-scoreboard.json`, sb); // full untrimmed payload, once
        capturedRaw = true;
      }
      sawLive = sawLive || anyLive;
      await sleep(INTERVAL_MS);
    } else if (sawLive && states.length && states.every((s) => s === "post")) {
      await snapshot("final + injuries", sb, { withInjuries: true });
      log("all games Final — done.");
      return;
    } else if (states.length && states.every((s) => s === "post")) {
      log("all games already Final and none seen live — nothing to capture.");
      return;
    } else {
      // Idle between game windows: wake 15 min before the next kickoff (max 10-min sleeps).
      const wait = Math.min(Math.max(nextKickoff - SOON_MS - Date.now(), 30_000), 10 * 60_000);
      log(`idle; next kickoff ${Number.isFinite(nextKickoff) ? new Date(nextKickoff).toLocaleString() : "unknown"}; sleeping ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  log("max runtime reached — stopping.");
})();
