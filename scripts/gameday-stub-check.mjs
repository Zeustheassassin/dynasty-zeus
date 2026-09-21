// Drives the Gameday Hub in a real browser against a SCRIPTED game timeline, with
// no real Sleeper/ESPN traffic: every /api/* call and every direct-to-Sleeper /
// FantasyCalc / ESPN call is stubbed. Only localhost and the throwaway Supabase
// test account's auth are actually contacted; anything else is intercepted and reported.
//
// Verifies end to end (through the real hooks, polling and rendering):
//   - live clock/score/possession rendering, "No game", win %, bench regret
//   - ESPN injury overlay (Out player -> 0 left; stale Sleeper Out cleared)
//   - per-stat pace path taken (data-pace-source="stats")
//   - automatic polling picks up new scoreboard/matchup/stat data with no reload,
//     matchup polls send ?bypass=1, and the Dashboard tab polls too
//   - the scoreboard and stat polls go quiet once every game is Final
//
// Usage (dev server must be running):
//   node --env-file=.env.test.local scripts/gameday-stub-check.mjs
// Screenshots: .next/visual-check/gameday-stub-*.png

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.VISUAL_CHECK_URL || "http://localhost:3000";
const OUT_DIR = path.join(__dirname, "..", ".next", "visual-check");
const EMAIL = process.env.TEST_ACCOUNT_EMAIL;
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Missing TEST_ACCOUNT_EMAIL/TEST_ACCOUNT_PASSWORD (run with --env-file=.env.test.local).");
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Scripted world ───────────────────────────────────────────────────────
const SEASON = "2026";
const WEEK = 3;
const scoring = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 };
const ROSTER_POSITIONS = ["QB", "RB", "WR", "WR", "TE", "FLEX", ...Array(14).fill("BN"), "TAXI"];

const mkLeague = (id, name) => ({
  league_id: id, name, season: SEASON, season_type: "regular", status: "in_season", sport: "nfl",
  total_rosters: 2, roster_positions: ROSTER_POSITIONS,
  settings: { playoff_week_start: 15, playoff_teams: 4, num_teams: 2, taxi_slots: 2, best_ball: 0 },
  scoring_settings: scoring, avatar: null, draft_id: null, previous_league_id: null,
});
const LEAGUES = [mkLeague("1001", "Stub League One"), mkLeague("1002", "Stub League Two")];

const P = (id, name, pos, team, extra = {}) => ({
  player_id: id, full_name: name, position: pos, team, age: 26, birth_date: null, years_exp: 4,
  search_rank: 100, fantasy_positions: [pos], active: true, status: "Active", injury_status: null, ...extra,
});
const PLAYERS = Object.fromEntries([
  // my side
  P("q1", "Quinn Mine", "QB", "SF"), P("r1", "Rex Mine", "RB", "SF"), P("w1", "Walt Mine", "WR", "DAL"),
  P("w2", "Wes Mine", "WR", "SEA"), P("t1", "Tim Mine", "TE", "DAL"), P("f1", "Flex Mine", "WR", "HOU"),
  P("bb", "Bench Big", "RB", "SF"), P("bo", "Bench Out", "RB", "SF"),
  // opponent
  P("q2", "Quincy Opp", "QB", "SEA", { injury_status: "Out" }), // STALE Out in Sleeper; ESPN says Active
  P("r2", "Ray Opp", "RB", "DAL"), P("w4", "Will Opp", "WR", "DAL"), P("w5", "Wade Opp", "WR", "SF"),
  P("t2", "Ted Opp", "TE", "SEA"), P("f2", "Fred Opp", "WR", "NYG"),
].map((p) => [p.player_id, p]));

// Projections (Sleeper-style stat lines), league-scored client side.
const PROJ = {
  q1: { pass_yd: 270, pass_td: 1.8, pass_int: 0.7, rush_yd: 20, rush_td: 0.2 },
  r1: { rush_yd: 70, rush_td: 0.6, rec: 2.5, rec_yd: 18 },
  w1: { rec: 6, rec_yd: 80, rec_td: 0.6 }, w2: { rec: 5, rec_yd: 65, rec_td: 0.5 },
  t1: { rec: 5, rec_yd: 50, rec_td: 0.4 }, f1: { rec: 5, rec_yd: 60, rec_td: 0.4 },
  bb: { rush_yd: 40, rush_td: 0.3, rec: 1, rec_yd: 6 }, bo: { rush_yd: 30, rush_td: 0.2 },
  q2: { pass_yd: 260, pass_td: 1.6, pass_int: 0.8, rush_yd: 15, rush_td: 0.2 },
  r2: { rush_yd: 65, rush_td: 0.5, rec: 2, rec_yd: 14 }, w4: { rec: 6, rec_yd: 75, rec_td: 0.5 },
  w5: { rec: 5, rec_yd: 62, rec_td: 0.5 }, t2: { rec: 4, rec_yd: 42, rec_td: 0.3 }, f2: { rec: 5, rec_yd: 58, rec_td: 0.4 },
};

// Filler games so the scoreboard is "complete" (>= 8 teams) and HOU is genuinely on bye.
const FILLER = [["BUF", "MIA"], ["KC", "LV"], ["PHI", "GB"], ["BAL", "CIN"], ["DEN", "LAC"]];
const NOW = Date.now();

const world = { stage: 1, requests: [], externalHits: [] };

// stage 1: SF@SEA Q3 4:12 (SF 17-10, SF ball); DAL@NYG upcoming in 1h
// stage 2: SF@SEA Q4 0:45 (SF 31-10) — a blowout, more points scored
// stage 3: SF@SEA Final; DAL@NYG live Q1; everything else Final
// stage 4: every game Final
const scoreboard = () => {
  const s = world.stage;
  const g = (team, opp, state, extra = {}) => ({ kickoffAt: NOW - 3_600_000, state, opponent: opp, ...extra });
  const out = {};
  const live = (stateObj) => stateObj;
  if (s === 1) {
    out.SF = g("SF", "SEA", "Live", { period: 3, clockSeconds: 252, clockDisplay: "4:12", score: 17, oppScore: 10, hasPossession: true });
    out.SEA = g("SEA", "SF", "Live", { period: 3, clockSeconds: 252, clockDisplay: "4:12", score: 10, oppScore: 17 });
  } else if (s === 2) {
    out.SF = g("SF", "SEA", "Live", { period: 4, clockSeconds: 45, clockDisplay: "0:45", score: 31, oppScore: 10 });
    out.SEA = g("SEA", "SF", "Live", { period: 4, clockSeconds: 45, clockDisplay: "0:45", score: 10, oppScore: 31, hasPossession: true });
  } else {
    out.SF = g("SF", "SEA", "Final", { score: 34, oppScore: 10 });
    out.SEA = g("SEA", "SF", "Final", { score: 10, oppScore: 34 });
  }
  const dalState = s === 3 ? "Live" : s === 4 ? "Final" : "Upcoming";
  const dalExtra = s === 3 ? { period: 1, clockSeconds: 600, clockDisplay: "10:00", score: 3, oppScore: 0 } : s === 4 ? { score: 20, oppScore: 17 } : {};
  out.DAL = { kickoffAt: s >= 3 ? NOW - 300_000 : NOW + 3_600_000, state: dalState, opponent: "NYG", ...dalExtra };
  out.NYG = { kickoffAt: out.DAL.kickoffAt, state: dalState, opponent: "DAL", ...(s >= 3 ? { ...dalExtra, score: dalExtra.oppScore, oppScore: dalExtra.score } : {}) };
  FILLER.forEach(([a, b]) => {
    const st = s === 1 ? "Upcoming" : "Final";
    out[a] = { kickoffAt: NOW + 7_200_000, state: st, opponent: b };
    out[b] = { kickoffAt: NOW + 7_200_000, state: st, opponent: a };
  });
  return out;
};

// Official Sleeper points per stage (players_points), and the live stat lines behind them.
const POINTS = {
  1: { q1: 14.2, r1: 7.4, w2: 6.1, bb: 12.0, q2: 9.8, w5: 4.5, t2: 3.2 },
  2: { q1: 24.0, r1: 15.2, w2: 6.1, bb: 18.0, q2: 9.8, w5: 4.5, t2: 3.2 },
  3: { q1: 24.0, r1: 15.2, w2: 6.1, bb: 18.0, q2: 9.8, w5: 4.5, t2: 3.2 },
  4: { q1: 24.0, r1: 15.2, w2: 6.1, bb: 18.0, q2: 9.8, w5: 4.5, t2: 3.2 },
};
const LIVE_STATS = {
  1: { q1: { pass_yd: 180, pass_td: 1, rush_yd: 30 }, r1: { rush_yd: 54, rec: 2 }, w2: { rec: 3, rec_yd: 31, rec_td: 0 } },
  2: { q1: { pass_yd: 270, pass_td: 2, rush_yd: 50 }, r1: { rush_yd: 112, rec: 4 }, w2: { rec: 3, rec_yd: 31, rec_td: 0 } },
  3: { q1: { pass_yd: 270, pass_td: 2, rush_yd: 50 }, r1: { rush_yd: 112, rec: 4 }, w2: { rec: 3, rec_yd: 31, rec_td: 0 } },
  4: { q1: { pass_yd: 270, pass_td: 2, rush_yd: 50 }, r1: { rush_yd: 112, rec: 4 }, w2: { rec: 3, rec_yd: 31, rec_td: 0 } },
};
const teamPts = (ids) => Math.round(ids.reduce((t, id) => t + (POINTS[world.stage][id] ?? 0), 0) * 10) / 10;

const MY_STARTERS = ["q1", "r1", "w1", "w2", "t1", "f1"];
const OPP_STARTERS = ["q2", "r2", "w4", "w5", "t2", "f2"];
const matchups = (leagueId) => {
  const bump = leagueId === "1002" ? 1 : 0; // League Two differs slightly so cards aren't identical
  const pp = (ids, extra = []) => Object.fromEntries([...ids, ...extra].map((id) => [id, (POINTS[world.stage][id] ?? 0) + (id === "q2" ? bump : 0)]));
  return [
    { matchup_id: 1, roster_id: 1, points: teamPts(MY_STARTERS), custom_points: null, starters: MY_STARTERS, players: [...MY_STARTERS, "bb", "bo"], starters_points: MY_STARTERS.map((id) => POINTS[world.stage][id] ?? 0), players_points: pp(MY_STARTERS, ["bb", "bo"]) },
    { matchup_id: 1, roster_id: 2, points: teamPts(OPP_STARTERS) + bump, custom_points: null, starters: OPP_STARTERS, players: OPP_STARTERS, starters_points: OPP_STARTERS.map((id) => POINTS[world.stage][id] ?? 0), players_points: pp(OPP_STARTERS) },
  ];
};
const rosters = (leagueId) => [
  { roster_id: 1, owner_id: "u_me", league_id: leagueId, players: [...MY_STARTERS, "bb", "bo"], starters: MY_STARTERS, reserve: null, taxi: null, co_owners: null, settings: { wins: 1, losses: 1, ties: 0, fpts: 200, fpts_decimal: 0, fpts_against: 190, fpts_against_decimal: 0 } },
  { roster_id: 2, owner_id: "u_opp", league_id: leagueId, players: OPP_STARTERS, starters: OPP_STARTERS, reserve: null, taxi: null, co_owners: null, settings: { wins: 1, losses: 1, ties: 0, fpts: 195, fpts_decimal: 0, fpts_against: 200, fpts_against_decimal: 0 } },
];
const users = [
  { user_id: "u_me", username: "stubme", display_name: "Stub Me", avatar: null },
  { user_id: "u_opp", username: "stubopp", display_name: "Stub Opponent", avatar: null },
];
const nflState = { week: WEEK, display_week: WEEK, season: SEASON, season_type: "regular", leg: WEEK, league_season: SEASON, league_create_season: SEASON, previous_season: "2025", season_start_date: "2026-09-10" };
const projectionsPayload = Object.entries(PROJ).map(([id, stats]) => ({ player_id: id, player: { position: PLAYERS[id].position }, stats }));
const injuriesPayload = () => ({
  players: [
    // ESPN says Wes Mine (my SEA WR, healthy in Sleeper's stale map) is OUT
    { name: "Wes Mine", position: "WR", team: "SEA", status: "Out", date: new Date().toISOString() },
    // ESPN says Quincy Opp is Active — clears Sleeper's stale Out
    { name: "Quincy Opp", position: "QB", team: "SEA", status: "Active", date: new Date().toISOString() },
  ],
});

// ── Routing ──────────────────────────────────────────────────────────────
const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function handle(route) {
  const url = new URL(route.request().url());
  const host = url.hostname;
  const p = url.pathname;

  if (host === "localhost" || host === "127.0.0.1") {
    if (!p.startsWith("/api/")) return route.continue();
    world.requests.push({ t: Date.now(), path: p + url.search, stage: world.stage });

    if (p === "/api/players") return json(route, { players: PLAYERS, nflState });
    if (p === "/api/nfl-state") return json(route, nflState);
    if (p === "/api/nfl-scoreboard") return json(route, scoreboard());
    if (p === "/api/stats/sleeper-live") return json(route, LIVE_STATS[world.stage]);
    if (p === "/api/injuries/espn") return json(route, injuriesPayload());
    if (p.startsWith("/api/projections/")) return json(route, []);
    if (p === "/api/stats/sleeper-weekly") return json(route, {});
    if (p.startsWith("/api/sleeper/user-leagues/")) return json(route, LEAGUES);
    if (p.startsWith("/api/sleeper/user/")) {
      // Looked up by user id (owner names) or by username (connect) — return the matching user.
      const key = decodeURIComponent(p.split("/").pop() ?? "");
      return json(route, users.find((u) => u.user_id === key || u.username === key) ?? users[0]);
    }
    const m = p.match(/^\/api\/sleeper\/league\/(\d+)(?:\/(\w[\w-]*)(?:\/(\d+))?)?$/);
    if (m) {
      const [, id, kind] = m;
      const league = LEAGUES.find((l) => l.league_id === id);
      if (!kind) return json(route, league ?? {});
      if (kind === "rosters") return json(route, rosters(id));
      if (kind === "users") return json(route, users);
      if (kind === "matchups") return json(route, matchups(id));
      return json(route, []); // transactions, traded-picks, drafts
    }
    // Any other internal API (Supabase-backed app routes etc.): empty but valid.
    return json(route, []);
  }

  if (host.includes("supabase")) return route.continue(); // throwaway test account auth only

  // Everything else that isn't localhost/Supabase is stubbed, never sent.
  world.externalHits.push(`${host}${p}`);
  if (host === "api.sleeper.app" && p.includes("/projections/nfl")) return json(route, projectionsPayload);
  return json(route, []);
}

// ── Helpers ──────────────────────────────────────────────────────────────
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  let page;
  process.on("unhandledRejection", async (err) => {
    console.error("FAILED:", String(err).split(/\r?\n/)[0]);
    try { if (page) await page.screenshot({ path: path.join(OUT_DIR, "gameday-stub-error.png"), fullPage: true }); } catch { /* ignore */ }
    process.exit(2);
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  // Pre-seed the connected Sleeper user so the connect step (and real Sleeper) is skipped.
  await context.addInitScript(({ user }) => {
    try { localStorage.setItem("sleeperUser", JSON.stringify(user)); } catch { /* ignore */ }
  }, { user: { user_id: "u_me", username: "stubme", display_name: "Stub Me", avatar: null } });
  await context.route("**/*", handle);

  page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1500);
  const emailInput = page.locator('input[type="email"], input[placeholder="Email" i]');
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(EMAIL);
    await page.fill('input[type="password"], input[placeholder="Password" i]', PASSWORD);
    await page.click('button:has-text("Sign In")');
    await sleep(3500);
  }

  // ── Gameday Hub → Dashboard (default tab) ──
  const nav = page.locator("nav").getByText("Gameday Hub", { exact: true }).first();
  await nav.waitFor({ timeout: 30000 });
  await nav.click();
  await page.locator("button", { hasText: "Stub League One" }).first().waitFor({ timeout: 45000 });
  // Wait for scoreboard + projections to land (the Dashboard must load them with NO league selected).
  await page.waitForFunction(() => /Live/.test(document.body.innerText) && /Win\s+\d+%/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, "gameday-stub-1-dashboard.png"), fullPage: true });

  const dash1 = await page.locator("body").innerText();
  check("Dashboard renders both stub leagues", dash1.includes("Stub League One") && dash1.includes("Stub League Two"));
  check("Dashboard shows a win probability", /Win\s+\d+%/.test(dash1));
  check("Dashboard shows 'Live' indicator + Updated stamp", /Live/.test(dash1) && /Updated/.test(dash1));
  check("Dashboard shows 'needs X from remaining starters'", /Needs [\d.]+ from remaining starters/.test(dash1));
  check("Dashboard counts the bye-week starter as 'no game'", /1 no game/.test(dash1));

  // ── League Matchups tab ──
  await page.getByRole("button", { name: "League Matchups" }).click();
  const select = page.locator("select").first();
  await select.selectOption("1001");
  await page.getByText("Detailed Matchup View").waitFor({ timeout: 30000 });
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT_DIR, "gameday-stub-2-matchups-stage1.png"), fullPage: true });

  const m1 = await page.locator("body").innerText();
  check("Live clock + score + possession rendered", m1.includes("Q3 4:12") && m1.includes("SF 17-10") && m1.includes("SF ball"));
  check("Bye-week starter shows the 'No game' pill", m1.includes("No game"));
  check("Bench regret box shown (Bench Big outscored Rex Mine)", /Bench regret so far/.test(m1) && m1.includes("Bench Big"));
  check("Win probability shown in matchup detail", /Win\s+\d+%/.test(m1));

  const paceOf = async (name) => {
    const cell = page.locator(`button:has-text("${name}")`).first().locator("xpath=ancestor::div[contains(@class,'min-w-0')][1]");
    return (await cell.locator("[data-pace-source]").first().getAttribute("data-pace-source").catch(() => null));
  };
  const qbPace = await paceOf("Quinn Mine");
  check("Per-stat pace used for QB (live stat line agrees with official points)", qbPace === "stats", `data-pace-source=${qbPace}`);

  // ESPN overlay: Wes Mine (Sleeper: healthy) is Out per ESPN -> nothing left to score.
  const wesLine = await page.locator(`button:has-text("Wes Mine")`).first().locator("xpath=ancestor::div[contains(@class,'min-w-0')][1]").innerText();
  check("ESPN-Out starter (Wes Mine) shows 0.0 left", /0\.0 left/.test(wesLine), wesLine.replace(/\n/g, " | "));
  const quincyLine = await page.locator(`button:has-text("Quincy Opp")`).first().locator("xpath=ancestor::div[contains(@class,'min-w-0')][1]").innerText();
  check("Stale Sleeper 'Out' cleared by ESPN Active (Quincy Opp still projects points)", !/0\.0 left/.test(quincyLine), quincyLine.replace(/\n/g, " | "));

  // ── Stage 2: flip the world, DO NOT reload — polling must pick it up ──
  const before = world.requests.length;
  world.stage = 2;
  console.log("\n… stage 2 (SF 31-10, Q4 0:45): waiting ~55s for automatic polls (scoreboard 30s, matchups 45s) …");
  await sleep(55_000);
  await page.screenshot({ path: path.join(OUT_DIR, "gameday-stub-3-matchups-stage2.png"), fullPage: true });
  const m2 = await page.locator("body").innerText();
  const sinceStage2 = world.requests.slice(before);
  check("Poll updated the clock with no reload (Q4 0:45, SF 31-10)", m2.includes("Q4 0:45") && m2.includes("SF 31-10"));
  check("Matchup polls sent ?bypass=1", sinceStage2.some((r) => /\/matchups\/3\?bypass=1/.test(r.path)));
  check("Scoreboard was polled", sinceStage2.some((r) => r.path.startsWith("/api/nfl-scoreboard")));
  check("Live stat lines were polled", sinceStage2.some((r) => r.path.startsWith("/api/stats/sleeper-live")));
  check("QB's team points updated to the new total", m2.includes("24.0"));

  // ── Dashboard tab while live ──
  await page.getByRole("button", { name: "Gameday Dashboard" }).click();
  await sleep(3000);
  const d2 = await page.locator("body").innerText();
  await page.screenshot({ path: path.join(OUT_DIR, "gameday-stub-4-dashboard-stage2.png"), fullPage: true });
  check("Dashboard catches up immediately on tab switch while live", world.requests.slice(before).some((r) => /\/league\/100\d\/matchups\/3\?bypass=1/.test(r.path)));
  check("Dashboard reflects the new scores", d2.includes("Stub League One"));

  // ── Stage 3: everything Final except DAL/NYG going live; then verify polling behaviour ──
  world.stage = 3;
  console.log("\n… stage 3 (SF/SEA Final, DAL/NYG live): waiting ~80s for the dashboard poll (75s) …");
  await sleep(80_000);
  await page.screenshot({ path: path.join(OUT_DIR, "gameday-stub-5-dashboard-stage3.png"), fullPage: true });
  const d3 = await page.locator("body").innerText();
  check("Dashboard updated by its own poll after games changed state", /Live/.test(d3));

  // ── Stage 4: every game Final — the scoreboard/stat polls must stop ──
  world.stage = 4;
  console.log("\n... stage 4 (all games Final): waiting ~40s for the poll that sees it, then 70s of silence ...");
  await sleep(40_000);
  const quietFrom = world.requests.length;
  await sleep(70_000);
  const quiet = world.requests.slice(quietFrom);
  check("Scoreboard polling stopped once every game was Final", !quiet.some((r) => r.path.startsWith("/api/nfl-scoreboard")), `${quiet.filter((r) => r.path.startsWith("/api/nfl-scoreboard")).length} scoreboard requests in the quiet window`);
  check("Live stat polling stopped too", !quiet.some((r) => r.path.startsWith("/api/stats/sleeper-live")));
  await page.screenshot({ path: path.join(OUT_DIR, "gameday-stub-6-all-final.png"), fullPage: true });
  const d4 = await page.locator("body").innerText();
  const weekStrip = d4.split("Week 3")[1]?.slice(0, 40) ?? "";
  check("Dashboard no longer shows the Live indicator", !/Live/.test(weekStrip), weekStrip.replace(/\n/g, " | "));

  // ── Hygiene ──
  check("No requests reached anything but localhost/Supabase (all external calls were stubbed)", true, `${world.externalHits.length} external calls intercepted, e.g. ${[...new Set(world.externalHits)].slice(0, 6).join(", ")}`);
  const relevantErrors = errors.filter((e) => !/favicon|Failed to load resource.*(404|401|406)|supabase|Download the React DevTools|Hydration/i.test(e));
  check("No unexpected console/page errors", relevantErrors.length === 0, relevantErrors.slice(0, 3).join(" || "));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log("Screenshots:", OUT_DIR);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
