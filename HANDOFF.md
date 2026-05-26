# DynastyZeus — Technical Handoff Document

A plain-English (but technical) overview of how this application is built, where the moving parts live, and what to look at first if things break. Written for a developer/technician who has never seen the project before.

---

## 1. What this app is

**DynastyZeus** is a single-owner web application that acts as a "command center" for dynasty fantasy football leagues hosted on Sleeper. It pulls live data from Sleeper, augments it with player values from FantasyCalc and rookie data from external sources, stores user-specific information (notes, trade attempts, scouting charts, etc.) in Supabase, and presents everything through a heavily-tabbed React UI.

It is **not** a multi-tenant SaaS — there are roughly 5 active users. That sizing matters because it justifies several simple-over-scalable choices made throughout the codebase (e.g. manual Supabase backups instead of automated, no full search index, no CDN beyond Vercel's defaults).

---

## 2. Tech stack at a glance

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.2.1** (App Router) | This is bleeding-edge Next.js. APIs differ from older Next.js documentation. See `AGENTS.md`. |
| Language | **TypeScript 5** (strict mode) | `noUnusedLocals` and `noUnusedParameters` are enforced. |
| UI library | **React 19.2.4** | Uses Server Components where appropriate; almost everything visible is `"use client"`. |
| Styling | **Tailwind CSS v4** via `@tailwindcss/postcss` | New v4 PostCSS plugin model — config is in `postcss.config.mjs`. |
| Database / Auth | **Supabase** (Postgres + Auth + RLS) | All user data lives here. Row Level Security is on for every user table. |
| Cache / Rate limit | **Upstash Redis** (optional) | Used by `lib/rateLimit.ts` for global per-IP rate limiting on API routes. Falls back to in-memory if env vars are absent. |
| Hosting | **Vercel** (Pro plan) | Cron jobs and serverless functions are Vercel-native. |
| Testing | **Vitest** + **@testing-library/react** | Tests live in `__tests__/`. |
| Linting | **ESLint 9** with `eslint-config-next` | Run via `npm run lint`. |
| Node version | **>= 20.0.0** | Enforced in `package.json`. |

---

## 3. Top-level file layout

```
dynastyzeus-app/
├── app/                    # Next.js App Router pages, API routes, top-level layout
│   ├── api/                # Server-side API routes (proxies + cron)
│   ├── components/         # Top-level shell components (HubRouter, MainLayout, modals)
│   ├── data/               # Static JSON (KTC values)
│   ├── hooks/              # Top-level state hooks composed in app/page.tsx
│   ├── providers/          # AppProviders.tsx — wraps the app in context providers
│   ├── layout.tsx          # Root HTML shell, fonts, ErrorBoundary
│   ├── page.tsx            # The home page — 18 lines, delegates to useAppState()
│   └── globals.css         # Tailwind directives + global styles
│
├── components/             # All major feature UIs (the "Hubs")
│   ├── AlertsPage/         # Alerts/notifications hub
│   ├── DataHub/            # Rankings, projections, value trends, etc.
│   ├── DraftHub.tsx + draftHub/ + draft/
│   ├── GamedayHub.tsx
│   ├── LeagueHub/          # League management, standings, sims, league mates
│   ├── ManagementHub.tsx   # Payment tracking, commissioner tools
│   ├── ScoutingHub.tsx     # College prospect scouting
│   ├── TradeHub.tsx + tradeHub/   # Trade calculator, finder, log, market
│   ├── scouting/           # Position-specific scouting boards (QB/RB/WR/TE)
│   ├── Dashboard.tsx
│   └── ErrorBoundary.tsx
│
├── hooks/                  # Reusable React hooks for data fetching/state
│   └── (useAlerts, useCalcValues, useProjections, useRecruits, etc.)
│
├── lib/                    # Pure utilities, contexts, API clients, constants
│   ├── *Context.tsx        # React contexts (Auth, League, Players, Roster, Values)
│   ├── helpers/            # Pure functions: math, lineup, picks, direction engine, etc.
│   ├── hooks/              # useLocalStorage with TTL
│   ├── recruiting/         # CFD/247 recruit matching logic
│   ├── scouting/           # Aggregate-merge logic for charting data
│   ├── apiHelpers.ts       # Shared server-side helpers (auth, response shapes)
│   ├── clientFetch.ts      # Client-side fetch with retry + TTL localStorage cache
│   ├── logger.ts           # Centralized logging (no raw console.log allowed)
│   ├── rateLimit.ts        # Upstash + in-memory rate limiter
│   ├── sleeperApi.ts       # Client-side Sleeper API wrappers (go through /api proxies)
│   ├── sleeperServer.ts    # Server-side Sleeper fetch helpers
│   ├── supabaseclient.ts   # Singleton Supabase client (anon key)
│   ├── types.ts            # Shared TypeScript types (Sleeper shapes, app models)
│   └── withRetry.ts        # Retry-with-exponential-backoff helper
│
├── supabase/
│   ├── schema.sql          # Full snapshot of the database schema (run once on a new project)
│   └── migrations/         # 22+ numbered migrations (001_… through 022_…) — apply in order
│
├── scripts/
│   ├── backup-supabase.bat # Double-click to run a manual DB backup on Windows
│   └── backup-supabase.ps1 # PowerShell script invoked by the .bat
│
├── public/                 # Static assets (favicons, default SVGs)
├── __tests__/              # Vitest test files
│
├── package.json            # Dependencies + npm scripts
├── next.config.ts          # Next.js config: CSP headers, image domains, caching
├── vercel.json             # Cron schedules
├── tsconfig.json           # TypeScript compiler config
├── vitest.config.mts       # Vitest test runner config
├── eslint.config.mjs       # ESLint flat config (ESLint 9)
├── postcss.config.mjs      # Tailwind v4 PostCSS plugin
├── CLAUDE.md / AGENTS.md   # Agent-facing notes (Next.js version warning)
└── HANDOFF.md              # ← this file
```

---

## 4. How the app starts up (the request lifecycle)

1. **Browser hits `/`.**
2. Next.js loads [app/layout.tsx](app/layout.tsx) — wraps everything in `<html>`/`<body>`, loads Geist fonts, mounts a top-level `<ErrorBoundary>`.
3. [app/page.tsx](app/page.tsx) renders. It is intentionally only 18 lines. It calls `useAppState()` and destructures four prop bundles which it spreads into four big components.
4. [app/hooks/useAppState.ts](app/hooks/useAppState.ts) is the **single composition hook** that gathers every piece of state the app needs — auth, leagues, players, projections, sim state, hub routing, etc. — and bundles them for the children. It internally calls the smaller hooks in [app/hooks/](app/hooks/) (`useAuthState`, `useNflState`, `useHubRouting`, `useSimulatorState`, etc.).
5. [app/providers/AppProviders.tsx](app/providers/AppProviders.tsx) wraps everything in 5 React Context providers (Auth, Players, League, Values, Roster) so deeply-nested components can read shared state without prop-drilling everything.
6. [app/components/MainLayout.tsx](app/components/MainLayout.tsx) renders the persistent top-bar / nav.
7. [app/components/HubRouter.tsx](app/components/HubRouter.tsx) acts as the in-app router. The app has **one URL** (`/`) — `HubRouter` looks at `mainTab` state and renders one of: Dashboard, AlertsPage, LeagueHub, DraftHub, DataHub, TradeHub, GamedayHub, ManagementHub, ScoutingHub. The non-active hubs are NOT mounted (everything else is loaded via `dynamic()` for code splitting).

> **Important architectural note:** the entire UI is a single-page client app. There are no routes other than `/` for the user-facing UI. Everything under `/api/*` is server-side.

---

## 5. The "Hubs" — what each major screen does

| Hub | Purpose | Where to look |
|---|---|---|
| **Dashboard** | Landing screen, Sleeper username connect, navigation tiles. | [components/Dashboard.tsx](components/Dashboard.tsx) |
| **Alerts** | Trade alerts, league transactions, injury reports, watchlist. | [components/AlertsPage/](components/AlertsPage/) |
| **League Hub** | Per-league standings, rosters, sims, league mate intel, notes, activity, power rankings, simulator. | [components/LeagueHub/](components/LeagueHub/) |
| **Draft Hub** | Live draft board, rookie big board, draft history, pick values, historical drafts. | [components/DraftHub.tsx](components/DraftHub.tsx) + [components/draftHub/](components/draftHub/) |
| **Data Hub** | Cross-league rankings, value trends, projections, league-mate exposure, depth charts, buy-low, my shares. | [components/DataHub/](components/DataHub/) |
| **Trade Hub** | Trade calculator, trade finder (suggests trades), trade log, attempts, market. | [components/TradeHub.tsx](components/TradeHub.tsx) + [components/tradeHub/](components/tradeHub/) |
| **Gameday Hub** | Live weekly matchup view with projections. | [components/GamedayHub.tsx](components/GamedayHub.tsx) |
| **Management Hub** | Commissioner tools, payment tracking. | [components/ManagementHub.tsx](components/ManagementHub.tsx) |
| **Scouting Hub** | College prospect scouting — separate charting boards per position (QB / RB / WR / TE). | [components/ScoutingHub.tsx](components/ScoutingHub.tsx) + [components/scouting/](components/scouting/) |

Each hub has its own internal tab system. The active hub plus active tab are tracked together in the top-level state via `useHubRouting`.

---

## 6. Data sources — where information comes from

### 6.1 Sleeper (`api.sleeper.app`)
The primary upstream data source. **All Sleeper calls go through Next.js proxy routes** under [app/api/sleeper/](app/api/sleeper/) — the browser never calls Sleeper directly. This was done so we can:
- Add rate limiting per-user
- Cache responses at the Vercel edge
- Avoid CORS issues
- Cache TTL'd data in the browser via `clientFetch.ts` + `localStorage`

Proxy routes mirror Sleeper's URL structure:
- `/api/sleeper/user/[username]` → resolve username → user_id
- `/api/sleeper/user-leagues/[userId]/[year]` → leagues for a user/year
- `/api/sleeper/league/[leagueId]/...` → rosters, users, matchups, drafts, traded-picks, transactions
- `/api/sleeper/draft/[draftId]/picks` → live draft picks

The client-side wrappers are in [lib/sleeperApi.ts](lib/sleeperApi.ts); the server-side fetch helpers are in [lib/sleeperServer.ts](lib/sleeperServer.ts).

### 6.2 FantasyCalc (`*.fantasycalc.com`)
Player values, trade calculator pricing, value trends. Called server-side via [app/api/fc-values/route.ts](app/api/fc-values/route.ts). Allowed in CSP `connect-src`.

### 6.3 Projection sources
- **FantasyPros** — [app/api/projections/fantasypros/route.ts](app/api/projections/fantasypros/route.ts)
- **NumberFire** — [app/api/projections/numberfire/route.ts](app/api/projections/numberfire/route.ts)

Both routes are cached at the Vercel edge for 5 minutes (see `next.config.ts` headers block).

### 6.4 NFL state / weekly stats
- [app/api/nfl-state/route.ts](app/api/nfl-state/route.ts) — current NFL week / season type.
- [app/api/stats/sleeper-weekly/route.ts](app/api/stats/sleeper-weekly/route.ts) — Sleeper's per-player weekly stats.

### 6.5 College/recruit data
- [app/api/recruiting/[year]/route.ts](app/api/recruiting/[year]/route.ts) — pulls recruit info; [lib/recruiting/](lib/recruiting/) handles matching CFD recruits to NFL prospects.

### 6.6 Supabase (our database)
Everything user-generated. See [§7](#7-supabase-database).

---

## 7. Supabase (database)

### 7.1 Structure
The complete schema lives in [supabase/schema.sql](supabase/schema.sql) — this is the snapshot you would run to spin up a brand-new project. Incremental changes are in [supabase/migrations/](supabase/migrations/) numbered `001_…` through `033_…` (and growing). **Apply them in order.**

Key table categories:
- **User content:** `notes`, `league_notes`, `league_management`, `comm_payments`, `player_notes`, `player_dispositions`, `league_player_tags`, `trade_attempts`, `dashboard_alerts_dismissed`, `watchlist`, `big_board_snapshots`, `rookie_board_overrides`
- **Caching tables:** `cache_*` (Sleeper response cache), `fc_values`, `fc_value_trends`
- **Scouting:** `prospects`, `prospect_games`, `route_plays`, `qb_plays`, `rb_plays`, `te_plays`, `wr_plays`, `gm_briefings`, plus aggregate views (`scouting_game_route_stats`, `scouting_game_snap_stats`)
- **NFL/recruit reference:** `player_nfl_draft_info`, `recruits`, plus `recruits_position_stars_view`
- **Simulator:** `league_simulations`, sim cache rows

### 7.2 Row Level Security (RLS)
**Every user-facing table has RLS enabled** with a policy like:
```sql
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text)
```
This means a user can only ever see/touch their own rows. The Supabase **anon key** is used in the client ([lib/supabaseclient.ts](lib/supabaseclient.ts)) — it is safe to expose because RLS does the access control.

The **service-role key** is used only server-side (in cron routes) and must never be sent to the browser. It bypasses RLS.

### 7.3 Migrations gotcha
Per project convention ([feedback_no_destructive_sql.md](C:/Users/bstefely.NPCSEALANTS/.claude/projects/c--Users-bstefely-NPCSEALANTS-dynastyzeus-app/memory/feedback_no_destructive_sql.md)): **no destructive SQL** (`DROP`, `DELETE`, `ALTER … DROP`, `TRUNCATE`) in migrations without explicit approval. Also: every new table must include explicit `GRANT`s to `authenticated` and `service_role` plus an RLS policy — Supabase removes default grants on new tables as of Oct 30, 2026.

### 7.4 Backups
Manual weekly backups via [scripts/backup-supabase.bat](scripts/backup-supabase.bat) (which calls [scripts/backup-supabase.ps1](scripts/backup-supabase.ps1)). Requires:
- `pg_dump` installed at `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe`
- `SUPABASE_DB_URL` in `.env.local`

Backups land in `C:\Users\bstefely.NPCSEALANTS\Documents\DynastyZeus Backups\` as `dz-YYYY-MM-DD-HHmm.sql`. **There is no automated backup** — this is intentional for the 5-user scale.

To restore: `psql "<SUPABASE_DB_URL>" -f dz-YYYY-MM-DD-HHmm.sql`

---

## 8. Cron jobs (Vercel)

Configured in [vercel.json](vercel.json). Both run every 2 hours.

| Path | Purpose |
|---|---|
| `/api/cron/leaguemate-alerts` | Scans recent trades across all users' leagues, generates alerts for each user about transactions involving their league-mates. |
| `/api/cron/league-transactions` | Refreshes the league transaction cache so the Alerts hub has fresh data without the user manually triggering it. |

Both are protected by a `CRON_SECRET` header check — Vercel injects the secret automatically. The implementations are at [app/api/cron/leaguemate-alerts/route.ts](app/api/cron/leaguemate-alerts/route.ts) and [app/api/cron/league-transactions/route.ts](app/api/cron/league-transactions/route.ts).

---

## 9. Environment variables (`.env.local`)

Lives in the project root, **never committed**. Required variables:

| Variable | Used by | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL. `NEXT_PUBLIC_` prefix is required so it ships to the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Anon key — safe to expose because RLS guards data. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Bypasses RLS. Used by cron routes. **Never expose to browser.** |
| `SUPABASE_DB_URL` | Backup script | Direct Postgres connection string for `pg_dump`. |
| `CRON_SECRET` | Cron routes | Shared secret Vercel sends in the `Authorization` header for cron triggers. |
| `UPSTASH_REDIS_REST_URL` | `lib/rateLimit.ts` | Optional. If absent, rate limiter falls back to in-memory. |
| `UPSTASH_REDIS_REST_TOKEN` | `lib/rateLimit.ts` | Pairs with the URL above. |

On Vercel, the same variables are set in **Project Settings → Environment Variables** (Production + Preview scopes).

---

## 10. Security model

Defined in [next.config.ts](next.config.ts). Applied as HTTP headers to every route.

- **CSP (Content-Security-Policy):**
  - `default-src 'self'` — block everything by default.
  - `script-src 'self' 'unsafe-inline'` — `unsafe-eval` is added **dev-only** because React dev mode needs it.
  - `img-src` allowlist: `sleepercdn.com`, `a.espncdn.com`, `static.www.nfl.com`, `images.unsplash.com`, `images.pexels.com`. **If you add a new image host, you must update BOTH the CSP and `images.remotePatterns` in `next.config.ts`** or images break.
  - `connect-src` allowlist: Supabase, Sleeper, FantasyCalc.
  - `frame-ancestors 'none'` — the app can't be iframed.
- **`X-Frame-Options: DENY`** — same idea, older header.
- **`X-Content-Type-Options: nosniff`**
- **`Strict-Transport-Security`** — force HTTPS for a year.
- **`Permissions-Policy`** — blocks camera/microphone/geolocation/payment.
- **Rate limiting:** every public API route should call `checkRateLimit(req)` from [lib/rateLimit.ts](lib/rateLimit.ts). Uses Upstash in production for global enforcement; in-memory in dev.

---

## 11. State management pattern

This took the longest to get right. The current shape (after multiple architecture phases):

1. **Top-level composition hook** ([app/hooks/useAppState.ts](app/hooks/useAppState.ts)) — orchestrates everything. **Do not bloat this further** — push new state into a feature hook.
2. **Feature hooks** ([app/hooks/](app/hooks/), [hooks/](hooks/)) — each owns one slice (auth, projections, rookie board, etc.).
3. **Context providers** ([app/providers/AppProviders.tsx](app/providers/AppProviders.tsx) + [lib/*Context.tsx](lib/)) — for shared values that many descendants read (players list, current league, FC values, current user). Avoids prop-drilling.
4. **`useLocalStorage` with TTL** ([lib/hooks/useLocalStorage.ts](lib/hooks/useLocalStorage.ts)) — persists user prefs and caches Sleeper responses across sessions.
5. **Tab/section state** — each hub has its own state hook (e.g. `useLeagueTabState`, `useAlertsState`, `useChartingState`).

---

## 12. Build, lint, test

```bash
npm install           # restore node_modules
npm run dev           # local dev server on http://localhost:3000
npm run build         # production build (must succeed before deploy)
npm run start         # serve the production build locally
npm run lint          # ESLint
npm run test          # Vitest one-shot
npm run test:watch    # Vitest watch mode
```

**CI gotcha:** the project's CI runs `tsc` *after* `next build` because Next.js generates `routes.d.ts` during the build step. Running `tsc` first will fail with missing types. See [memory: project_ci_gotchas.md](C:/Users/bstefely.NPCSEALANTS/.claude/projects/c--Users-bstefely-NPCSEALANTS-dynastyzeus-app/memory/project_ci_gotchas.md).

Other ESLint rules that bite frequently:
- `react-hooks/exhaustive-deps` — error, not warning.
- `react-set-state-in-effect` — error.
- `no-explicit-any` — error.
- `react/no-unescaped-entities` — error (escape `'` as `&apos;` in JSX text).
- `prefer-const` — error.

---

## 13. Deployment (Vercel)

- The `main` branch deploys automatically to production on push.
- Preview deployments are generated for any other branch/PR.
- The Vercel project must have all env vars configured (see [§9](#9-environment-variables-envlocal)).
- Cron jobs in [vercel.json](vercel.json) are picked up automatically on deploy — requires Vercel Pro.

To deploy a fix manually:
```bash
git checkout main
git pull
# make changes
npm run build         # smoke test locally first
git add -A
git commit -m "fix: …"
git push              # triggers Vercel deploy
```

---

## 14. Common failure modes & where to look

| Symptom | First place to check |
|---|---|
| App fully white-screens | Check the browser console + [components/ErrorBoundary.tsx](components/ErrorBoundary.tsx). Likely a runtime error in a child component — ErrorBoundary should catch it. |
| Images don't load | CSP `img-src` allowlist in [next.config.ts](next.config.ts) AND `images.remotePatterns`. Both must include the host. |
| Sleeper API failing | Check `/api/sleeper/...` proxy routes. Look for rate-limit (429) responses in browser network tab. |
| Supabase queries returning empty | RLS policy mismatch — verify `auth.uid()` matches the row's `user_id`. Re-check `npx supabase login` / session state. |
| Cron job didn't run | Vercel dashboard → Project → Cron tab. Check the `CRON_SECRET` env var matches what the route validates. |
| `tsc` failing with missing route types | Run `next build` first to regenerate `.next/types/`. |
| FantasyCalc values stale | [app/api/fc-values/route.ts](app/api/fc-values/route.ts) — check upstream status. The route caches at the edge. |
| Build fails on `noUnusedLocals` | Unused import or variable — remove it. TypeScript is strict here on purpose. |
| Rate limit complaints from one IP | Upstash Redis dashboard → look at the `rl:*` keys, or temporarily raise the limit in the offending route. |

---

## 15. Things intentionally NOT done (and why)

- **No automated DB backup pipeline.** With ~5 users, a weekly manual `pg_dump` is sufficient. See [scripts/backup-supabase.ps1](scripts/backup-supabase.ps1).
- **No multi-region deploy / CDN beyond Vercel defaults.** Latency is fine for the user base.
- **No e2e tests (Playwright/Cypress).** Vitest covers the critical pure logic — UI is hand-tested.
- **No internationalization.** English only.
- **No mobile-first layout for several hubs.** Desktop is the primary target; mobile works but isn't optimized.
- **Single page application with one URL.** Tab state lives in React state, not the URL. Browser back/forward does not navigate between hubs.
- **No AI integration.** Earlier versions used Anthropic's API to auto-summarize scouting notes; that path was removed and replaced with a plain numbered list of play notes on each prospect's Overview tab.

---

## 16. Quick reference: who calls what

```
Browser
  │
  ├─ Sleeper data       ──▶  /api/sleeper/...   ──▶  api.sleeper.app
  │                                                  (rate-limited, cached edge + localStorage)
  │
  ├─ FC values          ──▶  /api/fc-values     ──▶  fantasycalc.com
  │
  ├─ Projections        ──▶  /api/projections/  ──▶  fantasypros / numberfire
  │                          (s-maxage=300 at the edge)
  │
  ├─ NFL stats          ──▶  /api/nfl-state, /api/stats/sleeper-weekly
  │
  ├─ User data          ──▶  Supabase (direct, anon key, RLS-protected)
  │
  └─ User auth          ──▶  Supabase Auth

Vercel Cron (server-side, no browser)
  │
  ├─ every 2h  ──▶  /api/cron/leaguemate-alerts
  │                  └─ scans Sleeper transactions, writes alerts to Supabase
  │
  └─ every 2h  ──▶  /api/cron/league-transactions
                     └─ refreshes transaction cache in Supabase
```

---

## 17. First-day checklist for a new developer

1. Install Node 20+, clone the repo.
2. Get a copy of `.env.local` (request from the project owner — contains all secrets).
3. `npm install`
4. `npm run dev` — confirm the app loads at `http://localhost:3000`.
5. Try `npm run build` — confirm a production build succeeds.
6. Try `npm run test` — confirm Vitest passes.
7. Open [app/page.tsx](app/page.tsx) → [app/hooks/useAppState.ts](app/hooks/useAppState.ts) → [app/components/HubRouter.tsx](app/components/HubRouter.tsx) to see how the app composes itself.
8. Skim the migration files in [supabase/migrations/](supabase/migrations/) to understand the data model evolution.
9. Read [AGENTS.md](AGENTS.md) — it warns that this Next.js version differs from what you may have seen elsewhere.

---

*Document generated for handoff purposes. Keep it updated as the architecture changes — especially the cron schedules, env vars, and CSP allowlist.*
