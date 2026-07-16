# DynastyZeus — Technical Handoff

> **Audience:** a developer who has just been handed the keys and has never seen this project.
> **Goal:** explain what the app is, how the code is structured, how data flows, and how every major subsystem actually works — in enough depth to debug and extend it on day one.
>
> *Last reviewed: 2026-07-16 (HEAD `7102bf0`, + uncommitted Phase A stages A1-A5 and Phase B stages B1-B4: Phase A = dead RECOMMENDATIONS tab removed, gm_briefings drop migration written, FantasyCalc fetches consolidated onto the /api/fc-values proxy, dark-only CSS cleanup, recharts + shared chart-theme wrapper added. Phase B = deep-linkable `?hub=&tab=` URL sync with real back/forward ([app/hooks/useHubRouting.ts](app/hooks/useHubRouting.ts)), a Cmd+K command palette ([components/CommandPalette.tsx](components/CommandPalette.tsx)), a seasonal mobile bottom nav ([app/components/MainLayout.tsx](app/components/MainLayout.tsx)), Trade Hub's Market Trends tab merged into Data Hub's Value Trends tab as a "Market Pulse" view, and Draft Hub's two historical tabs merged into one with a type toggle). This document was rebuilt from a full read of the codebase; verify against source where a claim is load-bearing, and keep it updated as the architecture changes.*

---

## Table of contents
1. [What this app is](#1-what-this-app-is)
2. [Tech stack](#2-tech-stack)
3. [Top-level repo layout](#3-top-level-repo-layout)
4. [The request lifecycle — browser to rendered hub](#4-the-request-lifecycle--browser-to-rendered-hub)
5. [The HUB registry (lib/hubs.ts)](#5-the-hub-registry-libhubsts)
6. [Identity & Auth](#6-identity--auth)
7. [Data architecture & flow](#7-data-architecture--flow)
8. [State management — the deep dive](#8-state-management--the-deep-dive)
9. [Values, Direction & Season Simulator](#9-values-direction--season-simulator)
10. [Trade Hub + Trade Finder Engine](#10-trade-hub--trade-finder-engine)
11. [Scouting & Charting Hub](#11-scouting--charting-hub)
12. [Recruits & CFD Matching](#12-recruits--cfd-matching)
13. [Network Consensus Draft Board](#13-network-consensus-draft-board)
14. [Rookie Big Board](#14-rookie-big-board)
15. [Supabase (database)](#15-supabase-database)
16. [Server-side, Cron, Deployment, Security & Observability](#16-server-side-cron-deployment-security--observability)
17. [Dev workflow: build, lint, test](#17-dev-workflow-build-lint-test)
18. [CI pipeline (GitHub Actions)](#18-ci-pipeline-github-actions)
19. [ESLint & TypeScript rules that bite](#19-eslint--typescript-rules-that-bite)
20. [Test suite scope (526 tests, 22 files)](#20-test-suite-scope-526-tests-22-files)
21. [Common failure modes & where to look](#21-common-failure-modes--where-to-look)
22. [Things intentionally NOT done (and why)](#22-things-intentionally-not-done-and-why)
23. [Known open items & time bombs for the next owner](#23-known-open-items--time-bombs-for-the-next-owner)
24. [First-day checklist for a new developer](#24-first-day-checklist-for-a-new-developer)

---

## 1. What this app is

**DynastyZeus** is a single-owner web "command center" for dynasty fantasy-football leagues hosted on [Sleeper](https://sleeper.com). It pulls live league data from Sleeper, augments it with player trade values from [FantasyCalc](https://fantasycalc.com) and weekly projections from FantasyPros / numberFire, layers on a rookie draft board, a season simulator, a trade calculator + AI-free "trade finder," position-by-position college scouting boards, and league-management/commissioner tooling — then stores everything user-generated (notes, trade attempts, scouting charts, payment tracking) in [Supabase](https://supabase.com). The whole thing is presented as one heavily-tabbed React single-page app.

It is deliberately **not** a multi-tenant SaaS. There are roughly **five** active users (the owner and a handful of leaguemates). That sizing is the single most important architectural fact about the project, because it justifies a long list of *simple-over-scalable* choices you will run into:

- **Manual weekly `pg_dump` backups** instead of an automated pipeline ([scripts/backup-supabase.ps1](scripts/backup-supabase.ps1)).
- **One Vercel cron** rather than a job queue.
- **localStorage as the primary client cache** with hand-rolled TTLs ([lib/hooks/useLocalStorage.ts](lib/hooks/useLocalStorage.ts)), instead of a server-side cache layer.
- **In-memory rate-limit fallback** when Upstash isn't configured ([lib/rateLimit.ts](lib/rateLimit.ts)).
- **No file-based routing, no search index, no e2e tests, no i18n.** The entire user-facing UI lives at a single route (`/`); as of Phase B, hub/tab state is reflected into that URL's query string (`?hub=&tab=`) for deep-linking and browser back/forward, but this is a hand-rolled History API sync, not a router rebuild — see §4's "single-URL SPA model" callout.

When something looks under-engineered, assume it was a conscious trade-off for a five-user audience — not an oversight.

## 2. Tech stack

All versions below are taken verbatim from [package.json](package.json) (do not trust your training data for these — see the warning at the end of this section).

| Layer | Choice & exact version | Notes |
|---|---|---|
| Framework | **Next.js `16.2.1`** (App Router) | Bleeding-edge. APIs differ materially from older Next docs — read the in-repo guides before writing code. |
| UI runtime | **React `19.2.4`** + **react-dom `19.2.4`** | Pinned exact (no `^`). Almost every visible component is `"use client"`. |
| Language | **TypeScript `^5`** (`@types/node ^20`, `@types/react ^19`) | strict mode; `noUnusedLocals` / `noUnusedParameters` enforced. |
| Styling | **Tailwind CSS `^4`** via **`@tailwindcss/postcss ^4`** | v4 PostCSS-plugin model; config in [postcss.config.mjs](postcss.config.mjs). CSP allows `'unsafe-inline'` styles because Tailwind v4 inlines critical CSS. |
| Database / Auth | **`@supabase/supabase-js ^2.101.1`** (Postgres + Auth + RLS) | All user data. Browser uses the anon key; RLS does access control. |
| Rate limiting | **`@upstash/ratelimit ^2.0.8`** + **`@upstash/redis ^1.37.0`** | Optional; falls back to in-memory if env vars absent. |
| List virtualization | **`@tanstack/react-virtual ^3.13.23`** | Large tables (big boards, rankings). |
| Charts | **`recharts ^3.9.2`** | Added Phase A stage A5. [lib/chartTheme.ts](lib/chartTheme.ts) (colors, dark-only, validated categorical palette) + [components/charts/ChartCard.tsx](components/charts/ChartCard.tsx) (`ChartCard`, `ChartTooltip`, `ChartLegend`, shared axis/grid presets) are the shared wrapper every Phase D+ chart builds on — no chart-specific components exist yet. |
| Hosting / cron | **Vercel** (Pro plan) | `main` auto-deploys to prod; cron declared in [vercel.json](vercel.json) (Pro required). |
| Testing | **Vitest `^4.1.4`** + **`@testing-library/react ^16.3.2`** + **jsdom ^29** + **`@vitejs/plugin-react ^6.0.1`** | Tests in [__tests__/](__tests__/). On this Windows machine, run via **PowerShell** (`npm run test`) — Vitest 4 silently collects 0 tests under Git Bash. |
| Linting | **ESLint `^9`** + **`eslint-config-next 16.2.1`** | Flat config in [eslint.config.mjs](eslint.config.mjs). `exhaustive-deps`, `no-explicit-any`, `react-set-state-in-effect`, `no-unescaped-entities`, `prefer-const` are all **errors**, not warnings. |
| Node | **`>=20.0.0`** | Enforced in `package.json` `engines`. |

> ### Read this before writing any Next.js code
> [AGENTS.md](AGENTS.md) (and [CLAUDE.md](CLAUDE.md), which just `@`-includes it) carry a one-line-but-load-bearing warning: **"This is NOT the Next.js you know."** Next 16 has breaking changes to APIs, conventions, and file structure relative to what's in most training data and older docs. The instruction is explicit: **read the relevant guide in `node_modules/next/dist/docs/` before writing code, and heed deprecation notices.** Treat any Next.js pattern you "remember" as suspect until confirmed against the in-repo docs.

## 3. Top-level repo layout

Verified against the working tree root. One line per entry:

```
dynastyzeus-app/
├── app/                  # Next.js App Router: the single page, API routes, root layout
│   ├── api/              # ALL server-side routes (Sleeper proxies, FC/projection fetchers, cron)
│   ├── components/       # App shell + modals (AuthSection, MainLayout, HubRouter, app/components/modals/)
│   ├── data/             # Static JSON shipped with the app (e.g. KTC pick values)
│   ├── hooks/            # Top-level state hooks composed by useAppState (useHubRouting, useNflState, …)
│   ├── providers/        # AppProviders.tsx — the context-provider tree
│   ├── layout.tsx        # Root <html>/<body>, Geist fonts, top-level ErrorBoundary, metadata
│   ├── page.tsx          # The home page — 18 lines, delegates entirely to useAppState()
│   ├── loading.tsx       # App Router route-level loading fallback
│   ├── globals.css       # Tailwind v4 directives + global styles
│   └── favicon.ico
├── components/           # Every major feature UI ("Hubs") + shared widgets (ErrorBoundary, Dashboard, …)
├── hooks/                # Reusable data/state hooks (useCalcValues, useProjections, useAlerts, …)
├── lib/                  # Pure utils, contexts, API clients, constants, the direction/finder engines
│   ├── *Context.tsx      # Auth / Players / League / Values / Roster React contexts
│   ├── hubs.ts           # HUB REGISTRY — single source of truth for top-level tabs
│   ├── constants.ts      # External base URLs + every cache TTL + payment-year config
│   ├── helpers/          # Pure functions: math, lineup, picks, direction engine, scoring multipliers
│   ├── hooks/            # useLocalStorage (TTL + quota eviction), useModalBehavior
│   ├── recruiting/ scouting/   # Recruit-matching + scouting aggregate-merge logic
│   ├── sleeperApi.ts / sleeperServer.ts   # Client wrappers (via /api proxies) / server fetch helpers
│   ├── rateLimit.ts logger.ts withRetry.ts clientFetch.ts apiHelpers.ts  # Cross-cutting infra
│   └── types.ts          # Shared TypeScript shapes (Sleeper models + app models)
├── supabase/
│   ├── schema.sql        # Full schema snapshot (disaster-recovery / new-project bootstrap)
│   └── migrations/       # Numbered 001_… onward — apply in order; this chain is the source of truth
├── scripts/              # backup-supabase.bat → .ps1 (manual Windows pg_dump)
├── public/               # Static assets
├── __tests__/            # Vitest suite
├── db_setup.sql          # Legacy pre-migration manual setup (still present in the tree)
├── next.config.ts        # CSP headers, image remotePatterns, edge caching
├── vercel.json           # Cron schedule(s)
├── postcss.config.mjs eslint.config.mjs vitest.config.mts tsconfig.json   # Tooling configs
├── AGENTS.md / CLAUDE.md # The Next-16 warning
├── README.md HANDOFF.md OBSERVABILITY.md SEASON_ROLLOVER.md   # Docs
```

The split between **`app/components/`** and the top-level **`components/`** is worth internalizing on day one: `app/components/` holds the *shell* (the auth gate, the persistent nav, the in-app router, and the global modals), while top-level `components/` holds the actual feature screens (the Hubs). Likewise **`app/hooks/`** holds the page-composition hooks (everything `useAppState` stitches together) while top-level **`hooks/`** holds reusable data-fetching hooks.

## 4. The request lifecycle — browser to rendered hub

There is exactly one user-facing route. Hitting `/` walks this chain:

1. **Browser requests `/`.** Next 16 serves [app/layout.tsx](app/layout.tsx) — the root `<html lang="en">` / `<body>` shell. It loads the Geist + Geist Mono fonts via `next/font/google`, sets `<title>DynastyZeus</title>` metadata and a mobile-friendly viewport, and wraps all children in a top-level `<ErrorBoundary label="App">` ([app/layout.tsx:37](app/layout.tsx#L37)). This is the only Server Component in the user path.

2. **[app/page.tsx](app/page.tsx) renders** — intentionally **18 lines** and marked `"use client"`. It does essentially nothing except call one hook and fan its output into four components:
   ```tsx
   const { providerProps, authSectionProps, mainLayoutProps, hubRouterProps } = useAppState();
   return (
     <AppProviders {...providerProps}>
       <AuthSection {...authSectionProps} />
       <MainLayout {...mainLayoutProps}>
         <HubRouter {...hubRouterProps} />
       </MainLayout>
     </AppProviders>
   );
   ```

3. **[app/hooks/useAppState.ts](app/hooks/useAppState.ts) is the single composition hook** (~3,600 lines). It owns or aggregates *every* piece of cross-app state — auth, the connected Sleeper user, leagues, the player map, FantasyCalc + redraft values, projections, the season simulator, league-mate intel, the rookie board, hub routing, and dozens of loader effects — by calling the smaller feature hooks in [app/hooks/](app/hooks/) and [hooks/](hooks/) (`useAuthState`, `useHubRouting`, `useSleeperUser`, `useCalcValues`, `useProjections`, `useSimulatorState`, `useAlerts`, …). At the very end it packs everything into exactly the four prop bundles `page.tsx` consumes: `providerProps`, `authSectionProps`, `mainLayoutProps`, `hubRouterProps` ([app/hooks/useAppState.ts:3437](app/hooks/useAppState.ts#L3437) onward; final `return` at [:3630](app/hooks/useAppState.ts#L3630)). **Do not add new state directly here** — push it into a feature hook and surface it through one of the bundles.

4. **[app/providers/AppProviders.tsx](app/providers/AppProviders.tsx) establishes the context tree** so deeply-nested hub components can read shared state without prop-drilling. The nesting order (outermost → innermost) is:
   ```
   AuthProvider          (lib/AuthContext)    – the Supabase user
     PlayersProvider     (lib/PlayersContext) – the ~big Sleeper player map
       LeagueProvider    (lib/LeagueContext)  – selectedLeague, rosters, users
         ValuesProvider  (lib/ValuesContext)  – league-adjusted FC/redraft values,
                                                pick values, direction profiles, sim, dynamic picks
           RosterProvider (lib/RosterContext) – the user's own roster
             {children}
   ```
   Note that the values flowing *into* these providers are still computed in `useAppState` and passed as props — the providers exist to distribute them downward, not to own them.

5. **[app/components/AuthSection.tsx](app/components/AuthSection.tsx)** is the auth gate. It renders a fixed full-screen sign-in modal (email/password, reset, create-account) and returns `null` once `supabaseUser` is set. It sits as a sibling of `MainLayout`, so the layout below it is always present but rendered non-interactive (`pointer-events-none opacity-40`) until you're signed in (see [MainLayout.tsx:37](app/components/MainLayout.tsx#L37)).

6. **[app/components/MainLayout.tsx](app/components/MainLayout.tsx)** renders the persistent chrome: the sticky top bar (app title, a Cmd+K search button, dual auth-status dots for *Supabase account* vs *Sleeper connection*, league `<select>`, Disconnect/Log Out) and the horizontal hub nav — desktop only as of Phase B (`hidden sm:block`). The nav buttons are generated by mapping over the `HUBS` registry, and every tab except `DASHBOARD` is disabled until a Sleeper user is connected. On small screens the top nav is replaced by a **fixed mobile bottom nav** with a seasonal primary hub set (Trade/League/Gameday/Alert in-season, Trade/League/Data/Alert offseason — the in-season check mirrors the `isRegularSeason` pattern used throughout `useAppState.ts`) plus a "More" button opening a sheet with the remaining hubs; both nav bars live inside the same sign-in-gated dimmed wrapper. **Cmd+K / Ctrl+K** (also the search button) opens [components/CommandPalette.tsx](components/CommandPalette.tsx), a fuzzy-filtered list combining every hub/sub-tab as a jump target with a live player-name search (substring match on `full_name`, capped results) that opens the Player Profile Panel directly.

7. **[app/components/HubRouter.tsx](app/components/HubRouter.tsx)** is the in-app "router." It reads `mainTab` (and the relevant sub-tab) from props and conditionally renders **one** hub via a chain of `{mainTab === "…" && <Hub … />}` blocks, each wrapped in its own `<ErrorBoundary>`. Crucially:
   - **Non-active hubs are never mounted** — the conditional simply doesn't render them, so their effects and data fetches don't run.
   - **Most hubs are code-split** via `next/dynamic` with `{ ssr: false, loading: HubSkeleton }`: `DraftHub`, `DataHub`, `LeagueHub`, `TradeHub`, `ScoutingHub`, `UserScoutHub` ([HubRouter.tsx:44-49](app/components/HubRouter.tsx#L44)). The lighter hubs — `Dashboard`, `AlertsPage`, `ManagementHub`, `GamedayHub` — are imported statically. So switching to, say, the Trade Hub lazily downloads its bundle on first visit (showing a skeleton), then keeps it.

> **The single-URL SPA model:** there is still exactly one file-based route (`/`) — no `next/navigation` router rebuild, no per-hub pages. But as of Phase B, [app/hooks/useHubRouting.ts](app/hooks/useHubRouting.ts) mirrors `mainTab` (and the active hub's sub-tab) into that route's query string via the raw History API (`?hub=TRADE_HUB&tab=FINDER`), not `next/navigation`'s `useSearchParams`/`useRouter` — those hooks force a `Suspense` boundary for anything reading them, which this all-`"use client"` `page.tsx` doesn't have and doesn't need for a same-render URL cosmetic. A hub switch (`setMainTab`) calls `history.pushState`; a sub-tab change within the same hub calls `history.replaceState` (too fine-grained to spam the back stack with); a `popstate` listener restores state on browser back/forward without re-writing history. State is *also* still persisted to `localStorage` as a fallback for a plain `/` load with no query string. Everything under `/api/*` is the only other thing the server routes — and that's all server-side data plumbing, never user-facing pages.

## 5. The HUB registry (lib/hubs.ts)

[lib/hubs.ts](lib/hubs.ts) is the **single source of truth for the top-level tabs**. It exports a `const`-asserted `HUBS` array of `{ id, label, wide }`, and derives the `MainTab` union type straight from it (`typeof HUBS[number]["id"]`). Because `mainTab` is typed as that union, a typo in any `mainTab === "…"` comparison or `setMainTab("…")` call fails at **compile time** — previously `mainTab` was a plain string and typos failed silently.

How it drives the app:
- **Nav order + labels:** [MainLayout.tsx:108](app/components/MainLayout.tsx#L108) maps over `HUBS` to render the nav buttons.
- **Content width:** the `wide` flag feeds `isWideHub(id)` ([lib/hubs.ts:42](lib/hubs.ts#L42)), which `HubRouter` uses to choose a full-bleed vs centered (`max-w-3xl`) container.
- **Persistence + deep-link validation:** [app/hooks/useHubRouting.ts](app/hooks/useHubRouting.ts) restores `mainTab` (and each hub's sub-tab) from the URL query string first, then localStorage, then a hardcoded default — validating every candidate against `HUBS`/the relevant sub-tab union first, so a renamed/removed tab (or a stale `?tab=` from an old bookmark) falls back instead of selecting a dead one. See §4's "single-URL SPA model" callout for the URL-sync mechanics.

> **Caveat for maintainers:** `HUBS` drives the nav order, labels, and layout width — but **not** the render blocks. `HubRouter` still renders each hub with its own bespoke props in hand-written `{mainTab === "…" && …}` blocks (the file's own header comment says as much). Adding a hub therefore means: (1) add the registry entry here, **and** (2) add a render block (plus props) in `HubRouter`.

The ten hubs, in registry order, with their one-line purpose and width:

| `id` | Label | `wide` | Purpose |
|---|---|:---:|---|
| `DASHBOARD` | Dashboard | no | Landing screen + Sleeper username connect + navigation tiles ([components/Dashboard.tsx](components/Dashboard.tsx)). The only hub usable before connecting Sleeper. |
| `LEAGUES` | League Hub | yes | Per-league standings, rosters, season simulator, league-mate intel, notes, activity, power rankings ([components/LeagueHub/](components/LeagueHub/)). |
| `DATA_HUB` | Data Hub | no | Cross-league rankings, value trends (incl. the "Market Pulse" FantasyCalc trend view merged in from Trade Hub, Phase B4), projections, league-mate exposure, depth charts, buy-low, my shares ([components/DataHub/](components/DataHub/)). |
| `DRAFT` | Draft Hub | yes | Live draft board, rookie big board, draft history, pick values, historical big boards/league drafts (one merged tab with a type toggle, Phase B4) ([components/DraftHub.tsx](components/DraftHub.tsx)). |
| `TRADE_HUB` | Trade Hub | yes | Trade calculator, trade finder, and attempted/completed trade logs ([components/TradeHub.tsx](components/TradeHub.tsx)). Its old Market Trends tab was removed in Phase B4 — a small cross-link button now jumps to Data Hub's Value Trends tab instead. |
| `GAMEDAY_HUB` | Gameday Hub | yes | Live weekly matchup view with remaining-projection math ([components/GamedayHub.tsx](components/GamedayHub.tsx)). |
| `ALERTS` | Alert Hub | yes | Watchlist value/status alerts, league transactions (Trades/Waivers), injury reports ([components/AlertsPage/](components/AlertsPage/)). |
| `MANAGEMENT_HUB` | Management Hub | yes | League management + commissioner tools / payment tracking ([components/ManagementHub.tsx](components/ManagementHub.tsx)). |
| `SCOUTING_HUB` | Scouting Hub | yes | College-prospect charting boards, one per position (QB/RB/WR/TE) ([components/ScoutingHub.tsx](components/ScoutingHub.tsx), [components/scouting/](components/scouting/)). |
| `USER_SCOUT` | User Scout | yes | Read-only lookup of any Sleeper user's leagues/rosters/exposure, without overwriting your own Sleeper link ([components/UserScoutHub.tsx](components/UserScoutHub.tsx)). |

Note the labels are not all `"… Hub"` (`LEAGUES` shows **"League Hub"**, `ALERTS` shows **"Alert Hub"** singular), and the `id` rarely matches the label verbatim — always go by `id` in code.

---

## 6. Identity & Auth

DynastyZeus has **two completely independent identities** that beginners almost always conflate. Keep them separate in your head from day one:

| | **Supabase Auth account** | **Sleeper user** |
|---|---|---|
| What it is | An email/password login to *our* database | A fantasy-football account on Sleeper |
| Identified by | `auth.users.id` (a UUID) | `user_id` (a numeric string) + `username` / `display_name` |
| Created when | You sign up / sign in | You type a Sleeper username and click "Connect" |
| Stored where | Supabase Auth (session in browser) | `localStorage["sleeperUser"]` |
| Owns | Every user-generated row (notes, tags, alerts, etc.) | Nothing in our DB directly — it's external |
| Gates the UI | Yes — no login, no app | No — you can use the app logged in but not connected |

They are joined by **exactly one** table — [`user_sleeper_links`](supabase/migrations/023_user_sleeper_links.sql) — and nowhere else. A Supabase account does not "know" its Sleeper identity except through that row. You can be logged in with no Sleeper connected, and (within a session) you can switch which Sleeper user you're connected to without touching your Supabase login.

### Supabase Auth (the login that gates the app)

The browser talks to Supabase through a single anon-key client created once in [lib/supabaseclient.ts](lib/supabaseclient.ts):

```ts
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

The anon key is safe to ship to the browser because **RLS** does the real access control (see below). The client throws on startup if `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing.

Session handling lives in [app/hooks/useAuthState.ts](app/hooks/useAuthState.ts):
- On mount it calls `supabase.auth.getUser()` to hydrate the current session, then subscribes via `supabase.auth.onAuthStateChange` and stores the user in React state (`supabaseUser`). The subscription is cleaned up on unmount ([useAuthState.ts:26](app/hooks/useAuthState.ts#L26)).
- `signIn()` ([useAuthState.ts:68](app/hooks/useAuthState.ts#L68)) wraps `signInWithPassword` in a 10-second timeout race so a dead network/Supabase project surfaces a real error instead of hanging. It deliberately **does not** set `supabaseUser` itself — it lets `onAuthStateChange` fire and update state, avoiding a race with sign-out ([useAuthState.ts:97](app/hooks/useAuthState.ts#L97)).
- `signUp()` uses `supabase.auth.signUp` (email confirmation expected), and `resetPassword()` uses `resetPasswordForEmail` with `redirectTo` set to the app origin.
- The last-used email is remembered in `localStorage["lastLoginEmail"]` for convenience; the password is never persisted.

The login UI is [app/components/AuthSection.tsx](app/components/AuthSection.tsx): a fixed full-screen modal (`z-index: 9999`) that renders only when `supabaseUser` is `null` (`if (supabaseUser) return null;` at [AuthSection.tsx:34](app/components/AuthSection.tsx#L34)) — i.e. it is the gate that blocks the whole app until you log in. It's a pure presentational component; all logic is passed in from `useAuthState`.

The authenticated user is then shared app-wide via [lib/AuthContext.tsx](lib/AuthContext.tsx), a small memoized context exposing `{ supabaseUser, isLoggedIn }`. It is mounted in [app/providers/AppProviders.tsx](app/providers/AppProviders.tsx#L50) (`<AuthProvider supabaseUser={supabaseUser}>`), and consumers read it with `useAuth()`. **Important:** this context carries *only* the Supabase identity — it knows nothing about Sleeper.

`signOut()` lives in [useAppState.ts](app/hooks/useAppState.ts#L480) (not in `useAuthState`) because logging out has to tear down far more than auth state: it clears notes, league management data, watchlists, dashboard alerts, several `localStorage` keys, **and calls `disconnectSleeper()`** so the app returns fully to the logged-out, unconnected state.

### Connecting a Sleeper user

The Sleeper side is owned by [hooks/useSleeperUser.ts](hooks/useSleeperUser.ts) and is entirely separate from auth:
- `connectSleeper()` ([useSleeperUser.ts:88](hooks/useSleeperUser.ts#L88)) takes the typed username, calls `sleeperApi.getUserByUsername(...)` (which routes through the `/api/sleeper/*` proxy with a localStorage TTL cache), and resolves the Sleeper `user_id`. Sleeper returns `200` + a null body for unknown usernames, so the code guards on `!data?.user_id` ([useSleeperUser.ts:105](hooks/useSleeperUser.ts#L105)).
- On success it stores the **whole Sleeper user object** in `localStorage["sleeperUser"]` ([useSleeperUser.ts:113](hooks/useSleeperUser.ts#L113)) and fetches the user's dynasty leagues for `CURRENT_YEAR` (filtered by `isDynastyLeague`).
- On mount it **hydrates** from `localStorage["sleeperUser"]` and re-fetches leagues, so a returning user is auto-connected ([useSleeperUser.ts:59](hooks/useSleeperUser.ts#L59)).
- `disconnectSleeper()` clears state and removes `localStorage["sleeperUser"]`.

There is also a separate, session-lifetime in-memory cache for *other* owners' Sleeper user objects in [lib/sleeperUserCache.ts](lib/sleeperUserCache.ts) — a `Map` keyed by `owner_id`, used to avoid re-fetching the same opponents when several leagues share owners. This is unrelated to *your* connected identity; it's just a fetch dedupe for league rosters.

### The join table: `user_sleeper_links` (and why it exists)

The whole reason this table exists is the **server-side cron**. Every interactive Sleeper fan-out (consensus board, etc.) gets the Sleeper `user_id` from the client at request time. A cron has no client and no browser `localStorage`, so it needs a server-readable Supabase-user → Sleeper-user mapping. That's `user_sleeper_links` ([supabase/migrations/023_user_sleeper_links.sql](supabase/migrations/023_user_sleeper_links.sql)):

```sql
CREATE TABLE IF NOT EXISTS user_sleeper_links (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  sleeper_user_id  text NOT NULL,
  sleeper_username text NOT NULL DEFAULT '',
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

The PK is `user_id` — **one Sleeper account per Supabase user**. Re-linking upserts the row instead of duplicating it.

**Who writes it:** the client, in an effect in [useAppState.ts:459](app/hooks/useAppState.ts#L459). When both a Supabase user *and* a connected Sleeper `user.user_id` exist, it upserts `{ user_id, sleeper_user_id, sleeper_username, updated_at }` with `onConflict: "user_id"`. It re-runs whenever the Sleeper `user_id`/username changes, so a re-link is captured.

**Who reads it:** the cron at [app/api/cron/league-transactions/route.ts](app/api/cron/league-transactions/route.ts). It selects `user_id, sleeper_user_id` for every registered user ([route.ts:277](app/api/cron/league-transactions/route.ts#L277)) and, for each pair, fans out that user's own dynasty leagues to fetch recent transactions, then upserts them into `league_transactions_cache`. The cron is gated by a constant-time `Bearer ${CRON_SECRET}` check ([route.ts:246](app/api/cron/league-transactions/route.ts#L246)) and uses a **service-role** Supabase client that bypasses RLS ([route.ts:273](app/api/cron/league-transactions/route.ts#L273)), since it reads every user's row. It is scheduled every 2 hours in [vercel.json](vercel.json).

### Spying / "User Scout" — and the documented danger of username switching

There is a real, recurring footgun here. The *naive* way to look at another manager's leagues would be to reuse `connectSleeper()` and just type their username. **Don't** — and the codebase has been deliberately built so you can't fall into it:

Switching the connected username via `connectSleeper()` would:
1. **Overwrite `localStorage["sleeperUser"]`** with the other person's account, hijacking your own session.
2. **Re-fire the `user_sleeper_links` upsert** ([useAppState.ts:459](app/hooks/useAppState.ts#L459)), repointing *your* Supabase account at *their* Sleeper `user_id`.
3. Therefore **repoint the cron** to scan their leagues under your account, polluting `league_transactions_cache` with their data — the documented root cause of "ghost alerts."

The safe design intent is captured in memory ([project_spy_username_switching.md](C:/Users/bstefely.NPCSEALANTS/.claude/projects/c--Users-bstefely-NPCSEALANTS-dynastyzeus-app/memory/project_spy_username_switching.md)): a **read-only lookup that never touches identity state**. That is [hooks/useSpyState.ts](hooks/useSpyState.ts), surfaced through [components/UserScoutHub.tsx](components/UserScoutHub.tsx). Its header comment ([useSpyState.ts:2](hooks/useSpyState.ts#L2)) spells out the contract: it loads any Sleeper user's leagues/rosters/picks and reproduces the full connected-user derivations (direction, standings, season sim) but with **no side effects** on the logged-in account:
- never calls `connectSleeper` / `setLocalStorageItem("sleeperUser")`,
- never upserts `user_sleeper_links` or any Supabase table,
- never triggers the cron,
- never writes the sim/league caches.

Mechanically: `lookup()` ([useSpyState.ts:281](hooks/useSpyState.ts#L281)) resolves the target username to a `user_id` and holds the focal roster (`r.owner_id === targetUserId`) in local React state only ([useSpyState.ts:104](hooks/useSpyState.ts#L104)); everything is fetched through read-only `sleeperApi` proxies + FantasyCalc and lives in memory. So Scouting a friend's roster has zero effect on your Supabase account, your Sleeper connection, or the cron.

### How RLS ties everything to `auth.uid()`

Every user-generated row is scoped to the logged-in Supabase user, never to the Sleeper identity. `user_sleeper_links` enables RLS with a single self-policy ([023_user_sleeper_links.sql:32](supabase/migrations/023_user_sleeper_links.sql#L32)):

```sql
CREATE POLICY "user_sleeper_links_self" ON user_sleeper_links FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);
```

This is the same `auth.uid()::text = user_id::text` pattern used across every user-facing table. The client uses the anon key, so a user can only ever read/write their *own* rows; the cron uses the service-role key to read all rows and bypasses RLS by design. Net effect: your Supabase UUID is the unit of ownership, and the only place your Sleeper identity is durably linked to it is the one RLS-protected row in `user_sleeper_links`.

---

## 7. Data architecture & flow

DynastyZeus pulls from a handful of third-party feeds (none of which it owns), layers its own user data on top, and aggressively caches everything so that ~5 users clicking between hubs almost never hit a live API twice. There are **three tiers**, and almost every read in the app is a journey through them:

- **Tier A — Live upstream APIs, proxied through Next route handlers.** Sleeper, FantasyCalc, FantasyPros, numberFire/FanDuel, a Google Sheet, and CollegeFootballData. The browser never talks to any of these directly; it talks to `/api/*` route handlers that fetch on the server.
- **Tier B — Supabase.** All user-generated content (notes, trade attempts, payments, scouting charts, watchlists, etc.). Read directly from the browser with the anon key, guarded by Row Level Security.
- **Tier C — Derived / cached layers.** Two independent caches sit in front of Tier A: a **per-browser `localStorage` TTL cache** ([lib/clientFetch.ts](lib/clientFetch.ts)) and a set of **Supabase cache tables** (`fc_values_cache`, `sleeper_stats_cache`, `cross_league_rosters_cache`, plus the cron-fed `league_transactions_cache` and `consensus_draft_cache`). On top of those, Next.js's own **server-side Data Cache** (`next: { revalidate }`) and Vercel's **edge cache** (`s-maxage`) do a third layer of de-duplication.

---

### A. Why every Sleeper call is proxied

Historically the browser called `api.sleeper.app` directly. The "Phase M" refactor (see the header comment in [lib/clientFetch.ts:1](lib/clientFetch.ts#L1)) moved **all** Sleeper traffic behind `/api/sleeper/*` route handlers. Four reasons, all of which are still load-bearing:

1. **Rate limiting.** Sleeper soft-caps aggressive fan-out callers (~1000 req/min — see [lib/sleeperServer.ts:11](lib/sleeperServer.ts#L11)). A 34-league user used to fire ~240 Sleeper requests on a cold session. Routing through the proxy lets every route call `checkRateLimit(req, ...)` from [lib/rateLimit.ts](lib/rateLimit.ts) to enforce a **per-IP** budget before a single upstream byte is fetched.
2. **Edge / server caching.** Each proxy passes `next: { revalidate: N }` to `fetch`, which engages the Next.js Data Cache. The *first* user to request a league's rosters in a 10-minute window pays the Sleeper round-trip; everyone else (and that same user on a hub switch) is served from cache.
3. **CORS.** Sleeper does not send permissive CORS headers for arbitrary browser origins. A same-origin `/api/...` call sidesteps that entirely.
4. **Browser TTL cache.** Because the URL is now same-origin and stable, [lib/clientFetch.ts](lib/clientFetch.ts) can key a `localStorage` entry off it, so repeat reads inside the TTL window **never touch the network at all** — not even the proxy.

> **Important nuance:** "all Sleeper calls are proxied" is true for the *league/draft/user* endpoints but **not** for three call paths. See [§A.2](#a2-the-three-un-proxied-sleeper-paths-the-exceptions). Don't assume a feature that reads Sleeper is behind the proxy — three aren't.

#### A.1 The full proxy catalog

The client-side chokepoint is [lib/sleeperApi.ts](lib/sleeperApi.ts) — a single `sleeperApi` object whose functions map 1:1 onto proxy routes under [app/api/sleeper/](app/api/sleeper/). Every Sleeper proxy route follows an identical four-step shape (verified across [rosters](app/api/sleeper/league/[leagueId]/rosters/route.ts), [user](app/api/sleeper/user/[username]/route.ts), [user-leagues](app/api/sleeper/user-leagues/[userId]/[year]/route.ts), [draft picks](app/api/sleeper/draft/[draftId]/picks/route.ts)):

```
1. checkRateLimit(req, 60, 60_000, '<keyPrefix>')   → 429 on overflow
2. validate the path param (ID_RE = /^[0-9]{1,30}$/, USERNAME_RE, YEAR_RE)  → 400 on bad input
3. fetch upstream with  next: { revalidate: SLEEPER_*_REVALIDATE_S }
   (or  cache: 'no-store'  when ?bypass=1 is present)
4. non-OK upstream → log.error + 502 ; success → NextResponse.json(body)
```

| Proxy route | Sleeper upstream | Client wrapper | Server revalidate | Browser TTL |
|---|---|---|---|---|
| [`/api/sleeper/user/[username]`](app/api/sleeper/user/[username]/route.ts) | `/user/{username}` | `getUserByUsername`, `getUserById` | 3600s | 60m |
| [`/api/sleeper/user-leagues/[userId]/[year]`](app/api/sleeper/user-leagues/[userId]/[year]/route.ts) | `/user/{id}/leagues/nfl/{year}` | `getUserLeagues` | 1800s | 10m |
| [`/api/sleeper/league/[leagueId]`](app/api/sleeper/league/[leagueId]/route.ts) | `/league/{id}` | `getLeagueInfo` | 3600s | 30m |
| [`/api/sleeper/league/[leagueId]/rosters`](app/api/sleeper/league/[leagueId]/rosters/route.ts) | `/league/{id}/rosters` | `getLeagueRosters` | 600s | 5m |
| [`/api/sleeper/league/[leagueId]/users`](app/api/sleeper/league/[leagueId]/users/route.ts) | `/league/{id}/users` | `getLeagueUsers` | 1800s | 10m |
| [`/api/sleeper/league/[leagueId]/matchups/[week]`](app/api/sleeper/league/[leagueId]/matchups/[week]/route.ts) | `/league/{id}/matchups/{week}` | `getLeagueMatchups` | 300s | 1m |
| [`/api/sleeper/league/[leagueId]/transactions/[week]`](app/api/sleeper/league/[leagueId]/transactions/[week]/route.ts) | `/league/{id}/transactions/{week}` | `getLeagueTransactions` | 900s | 8m |
| [`/api/sleeper/league/[leagueId]/traded-picks`](app/api/sleeper/league/[leagueId]/traded-picks/route.ts) | `/league/{id}/traded_picks` | `getLeagueTradedPicks` | 1800s | 10m |
| [`/api/sleeper/league/[leagueId]/drafts`](app/api/sleeper/league/[leagueId]/drafts/route.ts) | `/league/{id}/drafts` | `getLeagueDrafts` | 3600s | 30m |
| [`/api/sleeper/draft/[draftId]/picks`](app/api/sleeper/draft/[draftId]/picks/route.ts) | `/draft/{id}/picks` | `getDraftPicks` | 60s | 30s |

The TTLs are defined twice and **deliberately paired**: server-side `SLEEPER_*_REVALIDATE_S` in [lib/constants.ts:51](lib/constants.ts#L51) and client-side `TTL` in [lib/sleeperApi.ts:49](lib/sleeperApi.ts#L49). The invariant (documented at [lib/sleeperApi.ts:44](lib/sleeperApi.ts#L44)) is **client TTL ≤ server revalidate window**, so the browser never serves something the server has already discarded.

**Live-draft bypass.** `getDraftPicks(draftId, bypassCache = true)` appends `?bypass=1` to the fetch URL (see `appendBypassParam` at [lib/sleeperApi.ts:83](lib/sleeperApi.ts#L83)). The proxy reads that param and switches to `cache: 'no-store'`, so an in-progress draft never serves stale picks. Cleverly, the **`cacheKey` stays the un-suffixed URL** ([lib/sleeperApi.ts:66](lib/sleeperApi.ts#L66)), so a fresh bypass result repopulates the same `localStorage` slot a normal read would later check. `bypass` is also plumbed through `getLeagueRosters`, `getLeagueUsers`, `getLeagueTransactions`, `getLeagueTradedPicks`, and `getLeagueDrafts`.

#### A.2 The three un-proxied Sleeper paths (the exceptions)

Three call paths in [lib/sleeperApi.ts:243](lib/sleeperApi.ts#L243) **bypass both the proxy and the `localStorage` cache** and fetch `api.sleeper.app` directly via a separate `withRetry`-wrapped `get`/`getOrNull` helper ([lib/sleeperApi.ts:258](lib/sleeperApi.ts#L258)):

- **`getAllPlayers()`** → `https://api.sleeper.app/v1/players/nfl` — the ~5 MB master player map.
- **`getNFLState()`** → `https://api.sleeper.app/v1/state/nfl`.
- **`getRookieBoardADP(year)`** → `https://api.sleeper.app/projections/nfl/{year}?...` (note: projections live at the **host root, not under `/v1`** — `SLEEPER_PROJECTIONS_BASE` in [lib/constants.ts:13](lib/constants.ts#L13)).

These are explicitly "flakiest call paths" (the comment at [lib/sleeperApi.ts:254](lib/sleeperApi.ts#L254)), so each is wrapped in `withRetry(..., 3)`.

There is a **subtle inconsistency worth flagging**: a `/api/players` proxy route **does exist** ([app/api/players/route.ts](app/api/players/route.ts)) and even slims the payload server-side from ~5 MB to ~500 KB by keeping only the fields the app uses, but `sleeperApi.getAllPlayers()` does **not** call it (the comment at [lib/sleeperApi.ts:245](lib/sleeperApi.ts#L245) says switching would change the function signature, so it was left direct). Likewise an `/api/nfl-state` proxy exists and **is** used by [app/hooks/useNflState.ts:16](app/hooks/useNflState.ts#L16), while `sleeperApi.getNFLState()` still hits Sleeper directly — so NFL state is fetched two different ways depending on the caller. Treat the `sleeperApi` outliers and the proxy routes as parallel paths, not one canonical path. *(Confirm which path a given feature uses before assuming caching behavior.)*

Separately, **Sleeper projections** are read directly (not via proxy) inside [hooks/useProjections.ts](hooks/useProjections.ts): the "Sleeper/RotoWire" source fetches `SLEEPER_PROJECTIONS_BASE` straight from the browser, while the two *opt-in* extra sources go through the proxies `/api/projections/fantasypros` and `/api/projections/numberfire`.

---

### B. `clientFetch` — retry + TTL `localStorage` cache + quota eviction

[lib/clientFetch.ts](lib/clientFetch.ts) is the Tier-C browser cache that fronts the Sleeper proxies. Its public entry point is `cachedFetch<T>(url, { ttlMs, cacheKey?, bypass? })`. Flow ([lib/clientFetch.ts:171](lib/clientFetch.ts#L171)):

1. **SSR guard.** If `window` is undefined (server render), skip the cache entirely but still `fetchAndParse` (which retries) — there is no `localStorage` server-side.
2. **Read.** Unless `bypass`, look up `sleeperCache:<cacheKey ?? url>` in `localStorage`. `readCache` ([lib/clientFetch.ts:72](lib/clientFetch.ts#L72)) parses the `{ data, expiresAt }` envelope; if `expiresAt` is missing/past or the entry is corrupt, it **deletes the key and returns a miss**.
3. **In-flight coalescing.** A module-level `Map<string, Promise>` ([lib/clientFetch.ts:37](lib/clientFetch.ts#L37)) keyed on the fetch URL ensures concurrent callers for the same cold URL **share one network request** — preventing a "cache stampede" (several hooks/tabs requesting the same league at once) from multiplying proxy load. The map is keyed on the *fetch* URL (which includes `?bypass`) so a bypass refresh and a normal read don't accidentally share a promise.
4. **Fetch + retry.** `fetchAndParse` ([lib/clientFetch.ts:44](lib/clientFetch.ts#L44)) calls `withRetry(fn, 3, shouldRetry)`. It distinguishes **non-retryable 4xx** (any 4xx except 429) via a custom `NonRetryableHttpError` — so a deterministic 404/400 throws immediately instead of burning three retries, while 429s and 5xx and network blips are retried.
5. **Write.** On success, `writeCache` ([lib/clientFetch.ts:133](lib/clientFetch.ts#L133)) stores `{ data, expiresAt: Date.now() + ttlMs }`.

**Quota eviction** is the most interesting part. `localStorage` is ~5–10 MB; a multi-league user's roster/draft cache can fill it. On a `QuotaExceededError` (detected by name *or* numeric code across browsers — [lib/clientFetch.ts:89](lib/clientFetch.ts#L89)), `writeCache` retries up to 4 times, calling `evictOldEntries()` ([lib/clientFetch.ts:103](lib/clientFetch.ts#L103)) each time. Eviction only ever touches keys with the `sleeperCache:` prefix (never user data), sorts them by `expiresAt`, and drops **every already-expired entry, plus 25% of the total — whichever is larger**. If eviction frees nothing, it gives up quietly with a logged warning rather than looping forever.

`sleeperApi`'s internal `cachedGet`/`cachedGetOrNull` ([lib/sleeperApi.ts:66](lib/sleeperApi.ts#L66)) wrap `cachedFetch` to preserve the two existing error contracts: `get*` functions throw on failure, `getOrNull*` swallow and return `null`/`[]`.

#### B.1 `withRetry` — exponential back-off

[lib/withRetry.ts](lib/withRetry.ts) is a tiny, generic retry primitive used by both `clientFetch` and several server routes. `withRetry(fn, attempts = 3, shouldRetry = () => true)` runs `fn`, and on throw waits `200 × 2^i` ms (200 → 400 → 800…) before the next attempt. It re-throws the last error if attempts are exhausted **or** `shouldRetry(err)` returns `false` (used by `clientFetch` to skip retries on non-retryable 4xx). Server routes also use it for **non-blocking cache writes** — e.g. `fc-values` fires `withRetry(() => supabase.upsert(...))` without `await`, so a flaky cache write retries silently and never blocks the response (see [app/api/fc-values/route.ts:43](app/api/fc-values/route.ts#L43)).

Note there is a **second, independent retry implementation** for server-side fan-out: `safeFetch` in [lib/sleeperServer.ts:45](lib/sleeperServer.ts#L45). It has different semantics — it **returns `null` instead of throwing** (the deliberate contract for batch jobs where one failed request shouldn't abort the batch), uses a longer back-off (600ms·2^i on 429s, 400ms·2^i on network errors), and enforces a per-request timeout via `AbortSignal.timeout`. It pairs with `withConcurrency` ([lib/sleeperServer.ts:82](lib/sleeperServer.ts#L82)), which runs a fan-out in strict `Promise.all`-per-slice batches to cap in-flight requests. These are used **only** by server jobs that bypass the proxy: the consensus compiler and the league-transactions cron. **Never import `sleeperServer` from client code** — it has no cache and will hammer Sleeper directly ([lib/sleeperServer.ts:18](lib/sleeperServer.ts#L18)).

#### B.2 `rateLimit` — Upstash with in-memory fallback

[lib/rateLimit.ts](lib/rateLimit.ts) gates every public API route. `checkRateLimit(req, limit = 60, windowMs = 60_000, keyPrefix = '')` resolves the client IP from `x-forwarded-for` (first hop) / `x-real-ip` / `'unknown'`, then:

- **Upstash path (production):** if `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set, it lazily `import()`s `@upstash/ratelimit` + `@upstash/redis` and uses a **sliding-window** limiter. Because the counter lives in Redis, the limit is enforced **globally across all serverless instances**. Limiter instances are memoized per `(limit, windowMs, keyPrefix)` ([lib/rateLimit.ts:46](lib/rateLimit.ts#L46)).
- **In-process fallback (dev/CI, or if Upstash import fails):** a module-level `Map` bucket per `keyPrefix:ip` ([lib/rateLimit.ts:101](lib/rateLimit.ts#L101)). Accurate within one process but **resets on cold start** and is **not** shared across instances. It self-prunes when the store exceeds 500 entries or randomly ~1% of calls.

Either way an over-limit request gets a `429` with `Retry-After` and `X-RateLimit-*` headers. Per-route budgets vary by cost: Sleeper proxies use **60/min**, FantasyCalc **30/min**, the projections scrapers **20/min**, the ~5 MB players proxy **10/min**, and the very expensive consensus compile is throttled to **5 per 10 minutes** ([app/api/compile-consensus/route.ts:398](app/api/compile-consensus/route.ts#L398)).

---

### C. The other upstreams and their cache strategy

Beyond Sleeper, six more upstreams are proxied. They split into **three caching styles**: Supabase-backed cache tables, Next Data Cache (`revalidate`), and Vercel edge cache (`s-maxage`).

**Supabase cache-table pattern** (read cache → on miss/stale, fetch upstream → non-blocking `withRetry` upsert → return). Three routes share this exact shape:

- **FantasyCalc** — [app/api/fc-values/route.ts](app/api/fc-values/route.ts). Player trade values. Validates `numQbs ∈ {1,2}`, reads `fc_values_cache` keyed on `num_qbs`, TTL = **24h** (`FC_VALUES_TTL_MS`). On any upstream/parse failure it returns `[]` rather than erroring.
- **Sleeper weekly stats** — [app/api/stats/sleeper-weekly/route.ts](app/api/stats/sleeper-weekly/route.ts). Per-player actuals. Validates `season` (4-digit, 2015–2040) and `week` (1–18 via `parseIntParam` from [lib/apiHelpers.ts](lib/apiHelpers.ts)), reads `sleeper_stats_cache` keyed on `(season, week)`, TTL = **7 days** (completed weeks never change). Consumed by [hooks/usePlayerStats.ts:153](hooks/usePlayerStats.ts#L153), which adds its own module-level in-memory cache on top.
- **Cross-league rosters** — [app/api/cross-league-rosters/route.ts](app/api/cross-league-rosters/route.ts). Given `(sleeper_user_id, league_id)`, fetches that league's rosters and extracts the one owned by the user. Reads `cross_league_rosters_cache`, TTL = **6h**.

**Next Data Cache (`revalidate`) pattern** — no Supabase row, just `next: { revalidate }` on the upstream `fetch`:

- **FantasyPros** — [app/api/projections/fantasypros/route.ts](app/api/projections/fantasypros/route.ts). **Scrapes HTML** (not a JSON API): fetches `fantasypros.com/.../{qb,rb,wr,te}.php` for all four positions in parallel with a spoofed browser `User-Agent`/`Referer`, then regex-parses player rows out of the markup. Revalidate = **1h** (`FANTASYPROS_REVALIDATE_S`). Brittle by nature — if FantasyPros changes its HTML, `parseFPProjections` silently returns fewer rows.
- **numberFire / FanDuel** — [app/api/projections/numberfire/route.ts](app/api/projections/numberfire/route.ts). POSTs a **GraphQL** query to FanDuel Research's API (`NUMBERFIRE_GQL_URL`), no auth, all skill positions in one call. Applies a 0.5 TE-premium server-side. Revalidate = 1h.
- **NFL state** — [app/api/nfl-state/route.ts](app/api/nfl-state/route.ts). Proxies `/state/nfl`, revalidate **1h**, returns `502`/`null` on failure.
- **Players** — [app/api/players/route.ts](app/api/players/route.ts). Fetches the ~5 MB player map **and** NFL state in parallel, then **slims the player map to ~500 KB** by keeping only ~11 fields per player (including `injury_status`, needed by Gameday badges/alerts). Players revalidate **24h**, state **1h**. Degrades gracefully — returns players without `nflState` if state fails.
- **Rookie board sheet** — [app/api/rookie-board-sheet/route.ts](app/api/rookie-board-sheet/route.ts). Proxies a **published Google Sheet CSV** (`ROOKIE_BOARD_SHEET_URL`), revalidate **6h**, returns `text/plain`. The proxy exists mainly to collapse slow (500ms–2s) Sheet exports into one upstream request per 6h window.

**College recruiting** — [app/api/recruiting/[year]/route.ts](app/api/recruiting/[year]/route.ts) — is the odd one out: it's a **read-from-Supabase / write-from-CFD** route, not an upstream proxy. `GET` returns cached `recruits` + `recruits_meta` rows for a year from Supabase (using a **per-request authed client** built from the caller's `Authorization: Bearer` token, so RLS applies). `POST` calls the CollegeFootballData API server-side (the `CFD_API_KEY` never reaches the browser), replaces that year's rows in 500-row batches, and stamps `recruits_meta`. Writes are rate-limited to **10/min** to protect CFD's 1000-calls/month quota.

**Consensus compile** — [app/api/compile-consensus/route.ts](app/api/compile-consensus/route.ts) — is the heaviest route. A `POST` streams **NDJSON** progress events back to the client (`Content-Type: application/x-ndjson`, `maxDuration = 300`). It uses `safeFetch` + `withConcurrency` to expand the user's connected-league graph across Sleeper, collect completed rookie drafts, and aggregate ADP into `consensus_draft_cache` / `consensus_draft_meta`. It builds an authed Supabase client from the caller's `accessToken` and uses an **atomic-ish upsert-then-prune** write so a partial failure can't wipe a good cache.

#### C.1 Edge caching via `s-maxage`

[next.config.ts](next.config.ts) attaches one set of `Cache-Control` headers for the projection routes only:

```
source: "/api/projections/:path*"
Cache-Control: s-maxage=300, stale-while-revalidate=60
```

`s-maxage=300` lets Vercel's edge serve the projection response from its shared cache for 5 minutes (`s-maxage` applies to shared caches, not the browser), and `stale-while-revalidate=60` lets it serve slightly-stale data for 60s while it refreshes in the background. **No other `/api/*` route sets edge cache headers** — they rely solely on the Next.js Data Cache (`revalidate`) for server-side reuse. The same config file also defines the **image `remotePatterns`** (`sleepercdn.com`, `a.espncdn.com`, `static.www.nfl.com`, `images.unsplash.com`, `images.pexels.com`) which **must be kept in lock-step with the CSP `img-src` allowlist** in the same file — change one without the other and images break. Likewise the CSP `connect-src` allowlist (`api.sleeper.app`, `*.fantasycalc.com`, `*.supabase.co`) is what permits the un-proxied direct Sleeper/FantasyCalc browser calls noted in §A.2.

---

### Who-calls-what

```
                          ┌──────────────────────────── BROWSER ────────────────────────────┐
                          │                                                                   │
  sleeperApi.ts ──┐       │  Tier C (browser): clientFetch.ts                                 │
  (league/draft/  │       │   • localStorage "sleeperCache:" TTL  • in-flight coalescing      │
   user reads)    └─────▶ │   • withRetry(3) (skip non-retryable 4xx)  • quota eviction       │
                          │                                                                   │
                          └───────┬───────────────────────────────────────────────┬──────────┘
                                  │ same-origin /api/* fetch                        │ DIRECT (no proxy, CSP-allowed)
                                  ▼                                                 ▼
   ┌──────────────────────── NEXT.js ROUTE HANDLERS (server) ─────────────┐   api.sleeper.app
   │ every route:  checkRateLimit() ─ rateLimit.ts ─ Upstash | in-memory   │   • /players/nfl   (getAllPlayers, ~5MB)
   │                                                                        │   • /state/nfl     (getNFLState)
   │  /api/sleeper/*        next:{revalidate}  ──────────────────────────▶ │   • /projections/* (useProjections "sleeper" src,
   │     rosters,users,matchups,transactions,traded-picks,drafts,          │                     getRookieBoardADP)
   │     league,user,user-leagues,draft/picks    (?bypass ⇒ no-store)   ───▶ api.sleeper.app/v1
   │                                                                        │
   │  /api/players, /api/nfl-state   next:{revalidate} ─────────────────▶ api.sleeper.app/v1
   │  /api/stats/sleeper-weekly      Supabase cache + withRetry upsert ──▶ api.sleeper.app/v1
   │                                       │  cache hit/miss               │
   │  /api/fc-values                 Supabase cache + withRetry upsert ──▶ api.fantasycalc.com
   │  /api/cross-league-rosters      Supabase cache + withRetry upsert ──▶ api.sleeper.app/v1
   │                                                                        │
   │  /api/projections/fantasypros   next:{revalidate}+edge s-maxage ───▶ fantasypros.com (HTML scrape)
   │  /api/projections/numberfire    next:{revalidate}+edge s-maxage ───▶ fdresearch-api.fanduel.com (GraphQL)
   │  /api/rookie-board-sheet        next:{revalidate}  ────────────────▶ docs.google.com (CSV)
   │  /api/recruiting/[year]         GET reads Supabase / POST ─────────▶ api.collegefootballdata.com
   │  /api/compile-consensus         safeFetch+withConcurrency ─────────▶ api.sleeper.app/v1  (NDJSON stream out)
   └─────────────────────────────────────────┬──────────────────────────┘
                                              │  Supabase cache-table reads/writes
                                              ▼
   BROWSER (direct, anon key, RLS) ─────────▶ SUPABASE  (user content + cache tables:
                                                          fc_values_cache, sleeper_stats_cache,
                                                          cross_league_rosters_cache,
                                                          consensus_draft_*, league_transactions_cache)
                                              ▲
   VERCEL CRON (server, no browser) ──────────┘
     every 2h ─▶ /api/cron/league-transactions
        (service-role key, bypasses RLS) ─ safeFetch+withConcurrency ─▶ api.sleeper.app/v1
        writes league_transactions_cache  (reads user_sleeper_links for Sleeper↔Supabase mapping)
```

---

## 8. State management — the deep dive

This is the part of the app most likely to confuse a newcomer, because there is **no Redux, no Zustand, no React Query**. State is hand-rolled out of three layers that fit together in a specific way:

1. **One giant composition hook** — [`useAppState()`](app/hooks/useAppState.ts) — that owns or gathers *every* piece of top-level state and returns four prop "bundles".
2. **Feature hooks** that each own one slice of that state (auth, projections, simulator, gameday, …). `useAppState` calls them and re-exports what they expose.
3. **Five React contexts** that re-broadcast the *most widely-read* values (players map, current league, FC values, the user's roster, the auth user) so deep components don't have to be prop-drilled.

Persistence is layered on top via [`useLocalStorage`](lib/hooks/useLocalStorage.ts) (plain prefs + a TTL cache) and Supabase (the durable store). The rule of thumb: **localStorage paints instantly, Supabase is the source of truth, and a monotonic guard / ref keeps the two from fighting.**

### The 18-line page and the 4 prop bundles

[`app/page.tsx`](app/page.tsx) is deliberately tiny. It calls `useAppState()` once and spreads four bundles into four components:

```tsx
const { providerProps, authSectionProps, mainLayoutProps, hubRouterProps } = useAppState();
return (
  <AppProviders {...providerProps}>
    <AuthSection {...authSectionProps} />
    <MainLayout {...mainLayoutProps}>
      <HubRouter {...hubRouterProps} />
    </MainLayout>
  </AppProviders>
);
```

The four bundles are assembled at the very bottom of [`useAppState`](app/hooks/useAppState.ts#L3436) ([returned at L3630](app/hooks/useAppState.ts#L3630)):

| Bundle | Goes to | What's in it |
|---|---|---|
| `providerProps` | [`AppProviders`](app/providers/AppProviders.tsx) | The 13 values that back the 5 contexts (players, selectedLeague, rosters, users, the two league-adjusted value maps, pickFcValues, fcNameValues, the two direction profiles, the live simulation, dynamic pick values, myRoster). |
| `authSectionProps` | `AuthSection` | Login/signup form state + the three auth actions. |
| `mainLayoutProps` | `MainLayout` | The nav: user, leagues, `selectedLeague`, `loadRoster`, `mainTab`/`setMainTab`, sign-out/disconnect. |
| `hubRouterProps` | [`HubRouter`](app/components/HubRouter.tsx) | **Everything else** — ~180 fields. This is the firehose that the active hub destructures. |

> **Why a firehose and not contexts for everything?** Because [`HubRouter`](app/components/HubRouter.tsx) is the in-app router — it switches between hubs purely on `mainTab` and renders one hub at a time (the rest are `dynamic()`-imported and unmounted). Passing the props lets each hub stay a plain function of its inputs. The contexts exist only for the handful of values that *deeply-nested* components need (see [the trace below](#a-concrete-trace-current-leagues-rosters--a-hub-component)).

### `useAppState`: the composition hook (and why it's allowed to be huge)

[`useAppState.ts`](app/hooks/useAppState.ts) is ~3,600 lines. It does three distinct jobs:

1. **Compose ~17 feature hooks.** It calls [`useAuthState`](app/hooks/useAuthState.ts), [`usePlayerAnnotations`](app/hooks/usePlayerAnnotations.ts), [`useHubRouting`](app/hooks/useHubRouting.ts), [`useNflState`](app/hooks/useNflState.ts), [`useGamedayState`](app/hooks/useGamedayState.ts), [`useActivityState`](app/hooks/useActivityState.ts), [`useSimulatorState`](app/hooks/useSimulatorState.ts) (all under `app/hooks/`), plus the data-loader hooks under `hooks/`: [`useSleeperUser`](hooks/useSleeperUser.ts), [`useCalcValues`](hooks/useCalcValues.ts), [`useProjections`](hooks/useProjections.ts), [`useLeagueOverview`](hooks/useLeagueOverview.ts), [`useUserExposure`](hooks/useUserExposure.ts), [`useUserTrades`](hooks/useUserTrades.ts), [`useDraftScout`](hooks/useDraftScout.ts), [`useTradeAttempts`](hooks/useTradeAttempts.ts), [`useLeagueMateIntel`](hooks/useLeagueMateIntel.ts), [`useCrossLeagueMateIntel`](hooks/useCrossLeagueMateIntel.ts), [`useAlerts`](hooks/useAlerts.ts), `useManagementState`, `useRookieBoardState`, `usePlayerStats`.
2. **Own the "core" league state directly** — `selectedLeague`, `roster`/`rosters`, `players`, `picks`/`allPicks`, `users`, `standings`, `pickFcValues`, etc. — plus the big `loadRoster` orchestration callback ([L893](app/hooks/useAppState.ts#L893)).
3. **Run the heavy derivation engines as `useMemo`s.** The draft prediction engine (`draftPredictionEngine`), dynamic pick values (`selectedLeagueDynamicPickValues`), league-mate profiles (`tradePartnerRankings`), and the direction profile (`selectedLeagueDirection` / `…Adjusted`) are all inline memos — hundreds of lines each. *(A `tradeRecommendationCards` engine also lived here until Phase 3 of the personal-rankings work removed it — it had become dead output, its `TradeHub` prop never destructured.)*

**The governing rule: do *not* add new state directly to `useAppState`. Push it into a feature hook and call that hook here instead.** That is exactly how the codebase grew — `useGamedayState`, `useActivityState`, `useSimulatorState`, `usePlayerAnnotations` were all carved out of what used to be one monolithic `page.tsx`.

There is a deliberate exception worth knowing: **the user decided to leave the inline derivation engines (trade recs, draft prediction, dynamic pick values, direction) as-is** rather than extract them into hooks. This was a conscious "it works fine, revisit only if asked" call (recorded in the project audit memory). So when you see 600-line memos inside `useAppState`, that's intentional, not tech debt nobody noticed.

A few patterns repeat throughout `useAppState` and are worth recognizing on sight:

- **TDZ refs for callbacks.** `loadRoster` is defined as a `useCallback` *after* effects that need it, so the file stashes it in a ref: [`loadRosterRef`](app/hooks/useAppState.ts#L318) is set at [L1073](app/hooks/useAppState.ts#L1073) and read inside the "load all leagues" effect. Same trick for `selectedLeagueRef` / `leaguesRef2` ([L246–249](app/hooks/useAppState.ts#L246)).
- **Tab-gated lazy loading.** Most data isn't fetched until its hub opens. There's a wall of effects keyed on `mainTab` + subtab (e.g. [Trade Hub → load FC values, L641](app/hooks/useAppState.ts#L641); [Data Hub → projections, L820](app/hooks/useAppState.ts#L820)). This is why opening a hub for the first time shows a loading state.
- **Module-level player cache.** `_playersInMemory` ([L67](app/hooks/useAppState.ts#L67)) caches the ~6 MB Sleeper player map for the session so a remount (dev strict-mode double-invoke, Sleeper reconnect) skips the re-fetch.

### The feature hooks (what each one owns)

| Hook | Owns | Notable behavior |
|---|---|---|
| [`useAuthState`](app/hooks/useAuthState.ts) | Supabase auth user + login form | Subscribes to `supabase.auth.onAuthStateChange`; `signIn` races the call against a 10s timeout. Remembers last email in localStorage (`lastLoginEmail`). |
| [`usePlayerAnnotations`](app/hooks/usePlayerAnnotations.ts) | League notes, player notes, dispositions (buy/sell), per-league CORE/WANT_TO_TRADE tags, ignored owners | **Dual-write pattern:** every setter writes localStorage synchronously *and* upserts Supabase. Reads `supabaseUser` through a ref so the save callbacks stay dependency-free and never go stale. |
| [`useHubRouting`](app/hooks/useHubRouting.ts) | The 5 tab selections | Lazy-init from localStorage, validated against registries; persists on change (detail below). |
| [`useNflState`](app/hooks/useNflState.ts) | Current NFL week/season | `loadNflState` is a no-op if already loaded (guards via `nflStateRef`). |
| [`useGamedayState`](app/hooks/useGamedayState.ts) | Live matchups + selected matchup | Thin — just `loadGamedayMatchups` calling `sleeperApi.getLeagueMatchups`. |
| [`useActivityState`](app/hooks/useActivityState.ts) | League activity feed, weekly matchup history | `ownerDraftTendencies` is a frozen empty map kept only for back-compat (the client-side compiler was removed). |
| [`useSimulatorState`](app/hooks/useSimulatorState.ts) | Season simulation, committed sim snapshots, draft-slot picks | The most stateful feature hook — see [its own section](#the-simulator-the-trickiest-feature-hook). |
| [`useCalcValues`](hooks/useCalcValues.ts) | Generic (numQbs-keyed) FC dynasty + redraft values, via the `/api/fc-values` proxy | `loadCalcValues(numQbs)` short-circuits if already loaded for that format; `calcSeq` ref discards stale responses. `loadRedraftValues(numQbs)` refetches when the SF/1-QB format changes. Both go through the cached proxy, not FantasyCalc directly (as of Phase A stage A3). |
| [`useProjections`](hooks/useProjections.ts) | Weekly/season projection rows | Multi-source weighted consensus (FantasyPros 0.45 / numberFire 0.35 / Sleeper 0.20). Extra sources are opt-in and persisted via `useLocalStorage`. `requestIdRef` discards superseded loads. |
| [`useLeagueOverview`](hooks/useLeagueOverview.ts) | Cross-league rosters/picks/users map | Fans out one Sleeper call set per league in parallel; `overviewSeq` ref guards stale results. |
| [`useUserExposure`](hooks/useUserExposure.ts) / [`useUserTrades`](hooks/useUserTrades.ts) / [`useDraftScout`](hooks/useDraftScout.ts) | The "spy on another Sleeper user" read-only lookups | All three are **read-only** by design (they never touch the user's own link/cron — see the spy-username memory). Each has a `requestSeq`/`userCache` to avoid clobbering and re-fetching. |
| [`useLeagueMateIntel`](hooks/useLeagueMateIntel.ts) / [`useCrossLeagueMateIntel`](hooks/useCrossLeagueMateIntel.ts) | In-league + cross-league trade tendencies of opponents | `useCrossLeagueMateIntel` only fires on the League-Mates tab or Trade Finder/Recommendations, and only fetches *missing* owners (it diffs against what's already cached). |
| [`useTradeAttempts`](hooks/useTradeAttempts.ts) | The trade-attempt log (Supabase) | Standard CRUD against `trade_attempts`; reads user via ref. |
| [`useAlerts`](hooks/useAlerts.ts) | Dashboard alerts, watchlist, dismissed IDs | localStorage keys are **scoped by user id** (`watchlists_v1_<uid>`, etc.); `persistedAlertIdsRef` stops loaded alerts from being re-UPSERTed (which would re-stamp `updated_at` and resurrect stale "ghost" alerts). |

### The 5 contexts (and the exact nesting order)

[`AppProviders`](app/providers/AppProviders.tsx) wraps the tree in five providers. The nesting order is **outer → inner**:

```
AuthProvider
  └ PlayersProvider
      └ LeagueProvider
          └ ValuesProvider
              └ RosterProvider
                  └ {children}
```

| Context | File | Exposes (hook) | Notes |
|---|---|---|---|
| Auth | [`AuthContext.tsx`](lib/AuthContext.tsx) | `useAuth()` → `{ supabaseUser, isLoggedIn }` | Memoised on `supabaseUser`. |
| Players | [`PlayersContext.tsx`](lib/PlayersContext.tsx) | `usePlayers()` → the full `Record<id, SleeperPlayer>` | **Not** wrapped in `useMemo` — the value *is* the `players` object, which only changes identity when the map is replaced, so no extra memo is needed. |
| League | [`LeagueContext.tsx`](lib/LeagueContext.tsx) | `useLeague()` → `{ selectedLeague, rosters, users }` | Memoised — comment notes ~22 consumers. |
| Values | [`ValuesContext.tsx`](lib/ValuesContext.tsx) | `useValues()` → 8 value/derived fields (FC dynasty + redraft maps, pick values, name values, both direction profiles, live sim, dynamic pick values) | Memoised on each field — comment notes ~18 consumers. |
| Roster | [`RosterContext.tsx`](lib/RosterContext.tsx) | `useMyRoster()` → `{ myRoster }` | The current user's own roster in the active league, or null. |

Every memoised provider exists for one reason: a keystroke in the login box (or a sim re-run, or a projection refresh) changes some unrelated top-level state and re-renders `useAppState`; the `useMemo` on each context value keeps consumers from re-rendering unless a value they actually read changed.

> **Migration note:** components can read these values *either* from `hubRouterProps` (still passed) *or* from the context hooks. Both paths are live simultaneously — e.g. [`RostersTab`](components/LeagueHub/RostersTab.tsx#L43) reads `players` from `usePlayers()`, `selectedLeague`/`users` from `useLeague()`, `myRoster` from `useMyRoster()`, and direction from `useValues()`, while still receiving `loadRoster` as a prop. New code should prefer the context hooks for the five context-backed values.

### `useHubRouting`: tab state that survives a reload

[`useHubRouting`](app/hooks/useHubRouting.ts) owns five selections — `mainTab` (which hub) plus one subtab per multi-tab hub (`tradeHubSection`, `leagueHubTab`, `dataHubTab`, `draftHubSection`). The whole app has **one URL** (`/`); these states *are* the router.

Two things make it robust:

- **Lazy-init from localStorage, validated against a registry.** Each `useState` initializer calls `restore(key, allowed, fallback)` ([L21](app/hooks/useHubRouting.ts#L21)). `mainTab`'s allowed set is derived from the [`HUBS`](lib/hubs.ts) registry; `leagueHubTab`'s from [`LEAGUE_HUB_GROUPS`](lib/leagueHubGroups.ts); the others from local `as const` tuples. If a stored value is no longer a valid option (a tab was renamed or removed), it silently falls back to the default instead of selecting a dead tab.
- **Persist-on-change effects.** Five one-line effects ([L39–43](app/hooks/useHubRouting.ts#L39)) write each selection back to localStorage. (Writing to an external store is a legitimate effect, not a banned set-state-in-effect.)

`getLocalStorageItem` returns the default during SSR (`window` undefined), so the lazy initializers are SSR-safe.

### `useLocalStorage`: TTL cache + quota eviction + cross-session persistence

[`lib/hooks/useLocalStorage.ts`](lib/hooks/useLocalStorage.ts) exports a hook plus three standalone helpers (`getLocalStorageItem` / `setLocalStorageItem` / `removeLocalStorageItem`) — the standalone helpers are what `useAppState` and the feature hooks actually use most. Three behaviors matter:

1. **Plain cross-session persistence.** Tabs, sleeperUser, annotations, committed sims, etc. are stored as bare JSON (no expiry). `getLocalStorageItem` returns the default on SSR, missing key, or parse error.
2. **Quota eviction that only sacrifices the TTL cache.** `setLocalStorageItem` retries up to 3× on a `QuotaExceededError`. Each failure calls [`evictExpiringEntries()`](lib/hooks/useLocalStorage.ts#L35), which scans localStorage for values that JSON-parse to an object with a numeric `expiresAt` field, sorts them oldest-first, and drops everything expired *plus* 25% of the total. **Plain values (tabs, user, annotations) have no `expiresAt`, so they're never evicted** — a full Sleeper cache can no longer wedge a small write of your tab state.
3. **The TTL "cache" itself lives in a sibling module.** The `expiresAt`-shaped entries that eviction targets are written by [`lib/clientFetch.ts`](lib/clientFetch.ts) under the `sleeperCache:` prefix. `cachedFetch` is the browser cache in front of the `/api/sleeper/*` proxies: it reads/writes `{ data, expiresAt }` entries, coalesces concurrent identical requests (one network call shared across callers — prevents a cold-cache stampede), and has its *own* quota-eviction routine ([`evictOldEntries`](lib/clientFetch.ts#L103)) that only touches `sleeperCache:`-prefixed keys. So there are **two independent eviction routines** — `useLocalStorage`'s (any `expiresAt` entry) and `clientFetch`'s (prefixed entries only) — both protecting against quota wedging from different angles.

### The simulator: the trickiest feature hook

[`useSimulatorState`](app/hooks/useSimulatorState.ts) is the one feature hook that's genuinely stateful, and it shows off the localStorage-paint / Supabase-truth / ref-guard pattern at its most careful:

- **`committedSimsByLeague`** (a frozen snapshot per league, the one the League Hub displays) is lazy-init'd from localStorage (`committedSimRows_v2`) and dual-written to Supabase (`league_simulations`) by `saveSimulationToSupabase`.
- **`myDraftSlotPicks`** (the user's manual draft-board overrides) loads localStorage first for an instant paint, then Supabase overwrites it as source of truth. A `lastSyncedDraftPicksRef` records the last loaded/saved value so the **save effect can tell a user edit apart from a system load** — without this, legacy localStorage data was being re-uploaded to Supabase on every page open, perpetually undoing user resets ([load L124](app/hooks/useSimulatorState.ts#L124), [save L158](app/hooks/useSimulatorState.ts#L158)).
- **`simQueue`** is a little state machine: `handleRunAllSims` queues all league IDs and loads the first; an effect watches for `readyLeagueId === simQueue[0]`, commits that sim, advances the queue, and loads the next league. `draftLeagueRef` ensures a league switch mid-run never writes the outgoing league's picks under the incoming league's ID.

The `readyLeagueId` gate is also how `useAppState` avoids computing a roster's direction profile with half-loaded data: `loadRoster` sets `selectedLeague` synchronously but `rosters`/`allPicks` arrive async, so [`selectedLeagueDirection`](app/hooks/useAppState.ts#L1360) returns `null` until `readyLeagueId === selectedLeague.league_id` *and* both value maps are populated.

### A concrete trace: current league's rosters → a hub component

This is the canonical path that ties all the layers together. Suppose the user clicks a league in the nav:

1. **`MainLayout` calls `loadRoster(league)`** (passed down in `mainLayoutProps`). The implementation is [`loadRoster` in `useAppState`](app/hooks/useAppState.ts#L893).
2. **`loadRoster` sets `selectedLeague` synchronously** and saves the league to `recentLeagues` in localStorage. It then checks a **2-hour localStorage cache** keyed `leagueData_<leagueId>` ([L906](app/hooks/useAppState.ts#L906)). On a miss it fires three Sleeper calls in parallel: `sleeperApi.getLeagueRosters`, `getLeagueTradedPicks`, `getLeagueDrafts`.
3. **`sleeperApi.getLeagueRosters(leagueId)`** ([lib/sleeperApi.ts#L124](lib/sleeperApi.ts#L124)) calls `cachedFetch('/api/sleeper/league/<id>/rosters', { ttlMs: 300_000 })`. [`cachedFetch`](lib/clientFetch.ts#L171) checks the `sleeperCache:`-prefixed localStorage entry; on a hit within TTL it returns instantly with no network. On a miss it hits the proxy.
4. **The proxy route** [`app/api/sleeper/league/[leagueId]/rosters/route.ts`](app/api/sleeper/league/[leagueId]/rosters/route.ts) rate-limits the request, validates the league id, then fetches `https://api.sleeper.app/.../rosters` with Next's server-side Data Cache (`next: { revalidate: SLEEPER_LEAGUE_ROSTERS_REVALIDATE_S }`). So there are **three cache layers** in front of Sleeper: the browser `sleeperCache:` TTL, the `leagueData_<id>` 2-hour bundle, and the edge Data Cache.
5. **Back in `loadRoster`**, the result drives `setRosters(allRosters)`, finds the user's own roster (`setRoster(myRoster)`), computes `picks`/`allPicks`, resolves owner display names via `fetchSleeperUser` (its own module cache), builds `standings`/`users`, and finally `setReadyLeagueId(league.league_id)`.
6. **`useAppState` re-runs**, recomputes the memo bundles, and feeds the new `rosters`/`selectedLeague`/`users`/`myRoster` into `providerProps`.
7. **`AppProviders` re-broadcasts** them: `rosters`, `selectedLeague`, `users` flow through [`LeagueProvider`](lib/LeagueContext.tsx); `myRoster` through [`RosterProvider`](lib/RosterContext.tsx).
8. **The hub component reads them from context.** [`RostersTab`](components/LeagueHub/RostersTab.tsx#L43) calls `const { selectedLeague, users } = useLeague(); const { myRoster } = useMyRoster();` — no prop drilling. Because the providers are memoised, only components that read a changed value re-render.

The same data also flows the prop route — `rosters` is in `hubRouterProps` — so older components that haven't migrated to `useLeague()` still work. Both are intentionally live at once.

---

## 9. Values, Direction & Season Simulator

This section covers DynastyZeus's *analytical core*: where player and pick values come from, how they get bent to fit a specific league's scoring, the strategy "Direction" engine that labels every roster, and the Monte-Carlo season simulator that produces playoff odds. These three layers feed almost every other screen (Trade Finder, League Hub, Data Hub, User Scout). The Trade Finder section covers how the finder *consumes* the Direction engine; this section explains how Direction (and the values it sits on) is *produced*.

### Where player values come from

As of Phase A stage A3 (2026-07-16), all FantasyCalc reads for the main app go through one cached proxy — there is no direct-to-`api.fantasycalc.com` fetch left in `useCalcValues`. (`hooks/useRookieBoardState.ts` and `hooks/useSpyState.ts` still fetch FantasyCalc directly, uncached — flagged as a follow-up, out of A3's scope.)

**The proxy.** [app/api/fc-values/route.ts](app/api/fc-values/route.ts) accepts `numQbs` (1 or 2) and `isDynasty` (defaults `true`). It checks a Supabase cache — `fc_values_cache` for dynasty, `fc_redraft_values_cache` for redraft (24h TTL via [`FC_VALUES_TTL_MS`](lib/constants.ts#L32)) — before hitting `api.fantasycalc.com/values/current` (dynasty adds `numTeams=12&ppr=1`; redraft doesn't, matching the pre-consolidation query shape). Rate-limited (30 req/min) and retried on cache-write.

**Two consumers, two shapes, same proxy:**

1. **Generic values (player + pick values + market trends).** [fetchFantasyCalcValues()](lib/helpers/picks.ts#L88) calls the proxy and splits the response into `playerValues` (keyed by Sleeper ID), `pickValues` (draft picks — see below), and `trendData` (raw `value`/`redraftValue`/`trend30Day`/`tradeFrequency` for QB/RB/WR/TE only, fed to the market-trends UI). In [useAppState](app/hooks/useAppState.ts#L562), `playerValues` is merged straight onto the in-memory player map (`data[id].value = fcValues[id]`), so **`players[id].value` IS the raw superflex (numQbs=2) FantasyCalc dynasty value.** That generic value is the universal fallback used everywhere a league-adjusted value is missing.

2. **Trade Hub's `calcFcValues` + `redraftValues`.** [hooks/useCalcValues.ts](hooks/useCalcValues.ts) also calls the proxy, keyed only by `numQbs` (via [`getLeagueNumQbs()`](lib/helpers/scoring.ts#L90) reading the selected league's roster slots) — not by `leagueId`. `loadCalcValues(numQbs)` short-circuits if that format is already loaded; `loadRedraftValues(numQbs)` refetches when a league switches between 1-QB and superflex. Both use a monotonic `calcSeq`/loaded-format guard so a slow fetch can't clobber a newer one. The app's own per-league adjustment on top of these generic values is the multiplier step below (`leagueAdjustedFcValues`) — FantasyCalc's own `leagueId`-based auto-detection is no longer used; the app's `computeScoringMultipliers` is the only per-league adjustment now.

A small static KTC ranking file exists at [app/data/ktcValues.json](app/data/ktcValues.json) (~30 hand-coded `name → value` entries), but it is **not imported anywhere in the TS/TSX codebase** — it is dead/legacy data and plays no role in the live value pipeline.

### League-adjusted values (Tier-3 scoring)

Raw FantasyCalc values assume a fixed baseline ([`FC_BASELINE_SCORING`](lib/helpers/scoring.ts#L34): full PPR, 4-pt pass TD, **no TEP**; superflex QB premium is already baked in via `numQbs=2`). Real leagues deviate, so [computeScoringMultipliers()](lib/helpers/scoring.ts#L116) derives per-position multipliers (QB/RB/WR/TE) from how `selectedLeague.scoring_settings` differs from that baseline — translating PPR deltas, TE/RB/WR reception premiums, and pass-TD scoring into approximate season-point swings, converting to a value multiplier, and **clamping to ±30%**.

In [useAppState](app/hooks/useAppState.ts#L1268), these multipliers produce:
- `leagueAdjustedFcValues` — raw `calcFcValues` scaled per position (falls back to raw `calcFcValues` when no league is selected).
- `leagueAdjustedRedraftValues` — the same multipliers applied to raw `redraftValues`.

These adjusted maps are what TradeHub, LeagueHub, the Direction engine, and the simulator consume. Absolute dynasty rankings in DataHub/DraftHub deliberately use **raw** `calcFcValues` instead, so a league's scoring quirks don't distort the universal board.

### Dynamic pick values

Pick values come out of `fetchFantasyCalcValues` as `pickFcValues`. The proxy parses FantasyCalc's pick entries into two key shapes: specific current-year slots (`"2026-1.06"`) and future rounds (`"2027-1"`), averaging duplicate slot entries, deriving future 2nd/3rd/4th rounds from current-year ratios, and *mirroring* the furthest-published year forward one season so a completed rookie draft doesn't leave next-next-year picks valueless. [lib/helpers/picks.ts](lib/helpers/picks.ts) also exposes [getPickValueKey()](lib/helpers/picks.ts#L34) / [getStoredPickValue()](lib/helpers/picks.ts#L47) (slot key → round-key fallback) and snake-draft slot math.

On top of the static `pickFcValues`, `useAppState` builds [`selectedLeagueDynamicPickValues`](app/hooks/useAppState.ts#L1443) — a `Record<string, DynamicPickValue>` keyed `season-round-rosterId`. This is where the *simulator feeds back into value*: each unowned future pick's worth is computed from the issuing roster's simulated `slotProbabilities`. The team's expected draft slot is rank-based (sort all rosters by mean expected slot; worst team = slot 1), and the expected value is **linearly interpolated** between the floor (best-team) and ceiling (worst-team) slot values — deliberately smoothing FantasyCalc's huge slot-1 premium so slot 2 reads as near-top rather than halfway down. Current-year picks with a locked slot bypass the projection and use their exact FC slot value. Each entry also carries early/mid/late probabilities, likely slots, a derived finish range, the issuer's name, and the issuer's playoff odds.

### The ValuesContext surface

[lib/ValuesContext.tsx](lib/ValuesContext.tsx) is the read-side distribution point — a memoized context so the ~18 `useValues()` consumers only re-render when a field they read changes. It exposes:

| Field | What it is |
|---|---|
| `leagueAdjustedFcValues` | per-position-scaled dynasty values |
| `leagueAdjustedRedraftValues` | per-position-scaled redraft values |
| `pickFcValues` | flat FantasyCalc pick map (slot/round keyed) |
| `fcNameValues` | name-keyed FC values (from the rookie board, for name matching) |
| `selectedLeagueDirection` | raw rank-based direction profile |
| `selectedLeagueDirectionAdjusted` | **authoritative** strategy profile (rank + age + sim) |
| `selectedLeagueSimulation` | the full live `LeagueSimulation` object |
| `selectedLeagueDynamicPickValues` | sim-driven per-pick value map |

Note the field is **`leagueAdjustedFcValues`**, not `calcFcValues`, at the context boundary — several consumers (e.g. [BuyLowTab](components/DataHub/BuyLowTab.tsx#L15), [ValueTrendsTab](components/DataHub/ValueTrendsTab.tsx#L67)) alias it back to `calcFcValues` locally. The prompt's `calcFcValues`/`redraftValues` are the *pre-adjustment* hook outputs from `useCalcValues`; they are not on the context.

### The Direction engine (the strategy/value layer)

The Direction engine lives in [lib/helpers/direction/](lib/helpers/direction/) (re-exported via the barrel [lib/helpers/direction.ts](lib/helpers/direction.ts)) and answers one question per roster: *what should this team be doing — buying, selling, or stuck?* It is the same engine the Trade Finder uses to gate suggestions.

It runs in three composable stages:

1. **Rank bucket** — [getLeagueDirectionBucket()](lib/helpers/direction/bucket.ts#L22) places a roster on a 3×3 grid of *dynasty rank* (long-term asset value) × *redraft rank* (win-now production), using percentile cuts (top-20/33/67%) so 8- and 14-team leagues scale correctly. Cells map to 10 labels (`Elite`, `True Contender`, `Almost There`, `Rebuilder`, `Fading Contender`, `Purgatory`, `Stranded`, `Window Closing`, `Fading Out`, `Hopeless`), each with a Tailwind color.

2. **Full profile** — [getRosterDirectionProfile()](lib/helpers/direction/roster.ts#L37) computes both ranks from the value maps, plus core age, young/old core counts, draft-capital totals, per-position strength/weakness ranks, human-readable strengths/concerns, and a `summary` + `actions` playbook per bucket. The crucial wiring: it takes `dynastyValueForPlayer` = `leagueAdjustedFcValues[id] ?? players[id].value`, `redraftValues` = `leagueAdjustedRedraftValues`, and `pickValues` = `pickFcValues` ([useAppState](app/hooks/useAppState.ts#L1379)). It returns `null` until rosters, picks, and *both* value maps are loaded and `readyLeagueId` matches — consumers must show a loading state.

3. **Adjusted bucket** — [getAdjustedDirectionBucket()](lib/helpers/direction/scoring.ts#L65) is the authoritative label. It blends the rank bucket with a [computeWindowScore()](lib/helpers/direction/scoring.ts#L5) (core age vs the ~26 dynasty-prime line, young builders +, aging vets −) and simulated *playoff pressure* `(playoffOdds − 50) / 12.5`. The composite nudges the bucket up or down a tier, then **hard playoff-odds floors** override it: a team with 0% odds can't stay an "Elite/Contender" label regardless of paper value. In [useAppState](app/hooks/useAppState.ts#L1393), `selectedLeagueDirectionAdjusted` prefers the **committed** (user-saved) sim's playoff odds over the live sim, because the live sim re-seeds each session and can swing wildly — using the committed odds keeps the strategy label stable across renders.

Direction also exposes the canonical buyer/seller classifier [classifyOppDirection()](lib/helpers/direction/scoring.ts#L43) and the `CONTENDER_BUCKETS`/`SELLER_BUCKETS`/`HARD_SELL_BUCKETS` constant sets — a deliberate single source of truth so the Trade Finder's "is this team a buyer?" tests can't drift apart. Partner-fit helpers (`getTradePartnerFit`, `getCrossLeaguePreferenceFit`, `getCrossLeagueTradeBehaviorFit`, `getLeagueMateMotivation`) also live here and are detailed in the Trade Finder section.

### The Season Simulator depth model

[lib/helpers/simulation.ts](lib/helpers/simulation.ts) → `simulateLeague()` is a **pure function** (every input is an explicit argument, no closures), so the same engine runs both for the connected user (via [app/hooks/useSimulatorState.ts](app/hooks/useSimulatorState.ts), persisted) and for read-only spying on other users' leagues (via [hooks/useSpyState.ts](hooks/useSpyState.ts#L364), no persistence). Behavior is identical; only persistence differs.

How a season is simulated:

- **Player scoring** ([scorePlayer](lib/helpers/simulation.ts#L79)): prefers a real weekly/season projection; falls back to `leagueAdjustedRedraftValues / 250`; for true rookies (`years_exp === 0`) falls back to `leagueAdjustedFcValues / 425`. Those `/250` and `/425` divisors convert dynasty value into pseudo-fantasy-points.
- **Per-week lineup rebuild** ([pickBestStarters](lib/helpers/simulation.ts#L108)): for each simulated week, players are sorted by score and greedily slotted into the league's actual lineup positions (FLEX = RB/WR/TE, SUPER_FLEX = QB/RB/WR/TE). Bench depth is the next-best 5.
- **Bye weeks** ([getPlayerByeWeek](lib/helpers/simulation.ts#L97)): uses the player's explicit `bye_week`, else a team→bye map built from the player pool, else a deterministic hash of the NFL team code. Players on bye in a simulated week are pulled from the available pool.
- **Injury roll**: each week, every player has a flat **6.5%** chance (`rng() < 0.065`) of being unavailable, forcing a lineup re-pick from depth.
- **Projected rookies** (offseason only): [lib/helpers/rookieProjection.ts](lib/helpers/rookieProjection.ts) runs a simplified BPA snake/linear draft so each team's projected rookies join its pool (`projectedRookiesByRoster`). In-season it returns empty because rookies are already on Sleeper rosters; explicit guards prevent double-counting once a rookie draft is `complete`.
- **Team scoring**: a team's weekly score is its lineup score scaled by an availability ratio plus normal noise (`weeklyStdDev`). The std-dev itself is a position-weighted volatility multiplier (QB steady, WR swingy) modulated by dynasty-vs-redraft value ratio and rolling usage stats. In-season, scores and variance are **blended toward the team's actual weekly results** (weighted recent-4 mean; full historical std-dev kicks in by ~6 games).
- **Schedule**: uses actual Sleeper matchups where available, fills the rest with a generated round-robin.

The Monte-Carlo loop runs **350 sims (offseason) / 250 (in-season)** with a deterministic seed (`leagueId` hash + per-sim offset + `simSalt`), accumulating finish counts, playoff/bye/title counts, and slot probabilities, then simulating the playoff bracket (with byes per `playoff_teams`). Outputs per roster: expected wins, avg/projected finish, finish range, **playoff/bye/title/1.01 odds**, all-play record, luck score, and per-week win probabilities. The seed determinism + `simSalt` is why "Run All Sims" produces stable-but-refreshable results.

### Caching: `league_simulations`

The live sim is recomputed in a memo every render ([useSimulatorState](app/hooks/useSimulatorState.ts#L195)), but the *summary* is persisted. [saveSimulationToSupabase()](app/hooks/useSimulatorState.ts#L231) writes one row per roster to the Supabase table [`league_simulations`](supabase/schema.sql#L259) (`playoff_odds`, `title_odds`, `expected_wins`, `avg_finish`, `finish_range`, `computed_at`; unique on `user_id,league_id,roster_id`), plus a frozen `committedSimsByLeague` snapshot in `localStorage` (`committedSimRows_v2`). On login these rows are bulk-loaded into `leagueSimCache`, keeping in-memory values only when newer than the DB. The "Run All Sims" flow is a queue state machine: it loads each league's roster, waits for `readyLeagueId` to match, commits that league's sim, advances. The committed odds are what the adjusted Direction bucket reads — so the strategy label and the displayed odds stay in sync.

### Value-trend buy-low / sell-high (`player_value_snapshots`)

A separate, **generic-value** baseline drives value-change detection. `saveSnapshotNow()` and the alert effect in [useAppState](app/hooks/useAppState.ts#L3193) write a per-user JSONB snapshot of all QB/RB/WR/TE `players[id].value` (the *generic* FC value, intentionally **not** `leagueAdjustedFcValues`, so a league's scoring change doesn't fake a trend) to [`player_value_snapshots`](supabase/schema.sql#L206) — one row per user, the whole map in a `jsonb` column. The [ValueTrendsTab](components/DataHub/ValueTrendsTab.tsx) compares "now" vs that "then" snapshot to compute Δ% and suggest sell-window / buy-window trades. Value-change *alerts* gate on this Supabase baseline being ≥12h old and the prior value > 0, which is what stopped the historical false "X gained 2,274" fires from FC API session inconsistency. Note: the [BuyLowTab](components/DataHub/BuyLowTab.tsx) is a *different* mechanism — it's a dynasty-rank-vs-projection-rank gap model (age-weighted), not snapshot-trend based.

---

## 10. Trade Hub + Trade Finder Engine

The Trade Hub is the most sophisticated subsystem in the app. Everything else (values, simulation, direction engine, cross-league scouting) ultimately exists to feed it. The headline feature is the **Trade Finder**: it does not just rank trades by value — it tries to surface trades the *opponent* would actually accept because the deal makes strategic sense for *their* roster, not just yours.

### Files at a glance

- [components/TradeHub.tsx](components/TradeHub.tsx) — the shell: sub-tab nav, shared calculator state, the stale-PENDING auto-marker, and the roster-preview modal.
- [components/tradeHub/TradeFinder.tsx](components/tradeHub/TradeFinder.tsx) — candidate generation (the ~20 trade-format loops) + the gating filters; wires everything into `runFinderPipeline`.
- [components/tradeHub/finderPipeline.ts](components/tradeHub/finderPipeline.ts) — the ~1,485-line scoring/slotting brain. **This is where acceptance, fit, value, structure, and signals are computed and a trade is kept or killed.**
- [components/tradeHub/hooks/useScoringFactors.ts](components/tradeHub/hooks/useScoringFactors.ts) — factory returning the direction-aware scoring closures (`getDirectionTradeScore`, `getTradeLineupSafety`, `posScore`, `getTradeIntent`, `failsDirectionGuardrail`).
- [components/tradeHub/FinderScoring.ts](components/tradeHub/FinderScoring.ts) — player/pick classifiers (`isOldProducerBuy`, `isFutureInsulationAsset`, `getAgeUrgency`…) and the `isBalanced` value gate.
- [components/tradeHub/finderTypes.ts](components/tradeHub/finderTypes.ts) — `TradeResult` shape + `valueBearingGive` (strips the sweetener from value math).
- [lib/helpers/direction/](lib/helpers/direction/) — the direction engine: [roster.ts](lib/helpers/direction/roster.ts) (profile builder + partner-fit), [bucket.ts](lib/helpers/direction/bucket.ts) (the 3×3 grid), [scoring.ts](lib/helpers/direction/scoring.ts) (window score, adjusted bucket, the canonical `classifyOppDirection`).

---

### The six sub-areas

The shell is [TradeHub.tsx](components/TradeHub.tsx). The sub-tab is a single string union — `"CALCULATOR" | "FINDER" | "RECOMMENDATIONS" | "TRADE_LOG" | "ATTEMPTS" | "MARKET"` ([TradeHub.tsx:22](components/TradeHub.tsx#L22)) — but note the nav at [TradeHub.tsx:132-200](components/TradeHub.tsx#L132) renders only **five** buttons (Calculator, Finder, Market, Attempts, Completed-Trades). `RECOMMENDATIONS` is a *legacy* value still threaded through the type and the cross-league-intel gate ([useCrossLeagueMateIntel.ts:42](hooks/useCrossLeagueMateIntel.ts#L42)) but **TradeHub.tsx renders no Recommendations component** — there is no `tradeHubSection === "RECOMMENDATIONS"` branch in the JSX. Treat "Recommendations" as a dormant alias for the Finder.

1. **Trade Calculator** — [TradeCalculator.tsx](components/tradeHub/TradeCalculator.tsx) + [CalculatorResult.tsx](components/tradeHub/CalculatorResult.tsx). Manual builder: pick an opponent roster, add give/receive players and picks, and get a WIN/EVEN/LOSE verdict. The verdict math lives in [calculatorUtils.ts](components/tradeHub/calculatorUtils.ts): `computeRosterDropCost` (value forfeited when a side must drop players to fit a net body gain), `computeStarDiscounts` (a star is worth less when split into multiple smaller pieces — a pick-tier-scaled haircut), and `EVEN_NET_THRESHOLD = 100` ([calculatorUtils.ts:6](components/tradeHub/calculatorUtils.ts#L6)) defines the "essentially even" band. The "Open in Calculator" button on any Finder card pre-loads these fields ([TradeFinder.tsx:1332-1341](components/tradeHub/TradeFinder.tsx#L1332)).
2. **Trade Finder** — the crown jewel; detailed below.
3. **Recommendations** — see above: not a live surface.
4. **Trade Log / "Completed Trades"** — [TradeLog.tsx](components/tradeHub/TradeLog.tsx); lazy-loads the user's real Sleeper trade history (`loadUserTrades`) when first opened ([TradeHub.tsx:185-189](components/TradeHub.tsx#L185)).
5. **Attempted Trades** — [TradeAttempts.tsx](components/tradeHub/TradeAttempts.tsx); the user's own logged offers from the `trade_attempts` Supabase table (PENDING/ACCEPTED/DECLINED/COUNTERED/NO_RESPONSE). The nav badge counts PENDING attempts for the selected league ([TradeHub.tsx:178-182](components/TradeHub.tsx#L178)).
6. **Market Trends** — [TradeMarket.tsx](components/tradeHub/TradeMarket.tsx); four read-only views over FantasyCalc trend data (rebuilding/contending targets by dynasty-vs-redraft gap, trending up/down 30-day, most-traded by `tradeFrequency`).

A small but important behavior in the shell: [TradeHub.tsx:108-122](components/TradeHub.tsx#L108) auto-marks any ME-initiated PENDING attempt older than 2 days as `NO_RESPONSE` (a `useRef` set guards against re-firing). This silently converts ghosted offers into the half-weight decline signal described below.

---

### The Finder philosophy: ~52% you / ~48% them

The governing idea (encoded all over `finderPipeline.ts`) is that a *perfect* suggestion is one the opponent will say yes to because it solves *their* roster problem — a contender getting win-now production, a rebuilder getting picks and youth — while still being a small win for you. Concretely this manifests as two layers:

- A **hard acceptance gate** that kills trades an opponent has no directional reason to accept, *before* ranking (`oppDirOk`, the `ACCEPT_FLOOR` filter, `failsDirectionGuardrail`).
- An **asymmetric value reward**: `balancePenalty` ([finderPipeline.ts:772-774](components/tradeHub/finderPipeline.ts#L772)) penalizes *you* overpaying steeply (`-(|net|/150)^1.5 * 3`) but caps *your* gain reward at a small `min(net/150, 4)`. So a lopsided-in-your-favor deal can't dominate the board — it would never get accepted. After all the acceptance gates pass, [FinderResults.tsx:101-106](components/tradeHub/FinderResults.tsx#L101) then sorts the survivors by *your* net gain, most-favorable first.

---

### The pipeline end-to-end

#### 1. Setup & memoization ([TradeFinder.tsx](components/tradeHub/TradeFinder.tsx))

The entire generation+scoring run is wrapped in one giant `useMemo` (`finderModel`, [TradeFinder.tsx:237-1114](components/tradeHub/TradeFinder.tsx#L237)) so typing in the isolated search inputs and unrelated parent re-renders never re-run the O(n²)+ loops. Inputs are read through `useDeferredValue` ([TradeFinder.tsx:151-154](components/tradeHub/TradeFinder.tsx#L151)) so the heavy work happens during React idle time. The whole finder is gated behind `selectedLeagueDirectionAdjusted` being non-null ([TradeFinder.tsx:1123-1129](components/tradeHub/TradeFinder.tsx#L1123)) — showing a spinner is preferred over showing trades driven by a stale/wrong direction during a league switch.

Per-roster player arrays are pre-built once into `finderRosterPlayersMap` ([TradeFinder.tsx:136-149](components/tradeHub/TradeFinder.tsx#L136)) — only QB/RB/WR/TE with `value > 0`, dynasty values pre-applied, sorted descending.

#### 2. Auto-strategy detection (no manual toggles)

The finder reads the user's adjusted direction bucket and sim playoff odds and *derives* a strategy ([TradeFinder.tsx:296-363](components/tradeHub/TradeFinder.tsx#L296)):
- `iAmTankingFinder` = has-sim AND `playoffOdds < 50` AND not a stockpiled rebuild.
- `isStockpiledRebuild` = dynasty top-third (`dynRank <= ceil(n*0.33)`) AND `ownedFirstsCount >= 5` (≥2 acquired firsts) — a team poised to *consolidate*, which must NOT be told to chase even more picks ([TradeFinder.tsx:306-316](components/tradeHub/TradeFinder.tsx#L306)).
- `isHardSellSide` (Stranded/Fading Out/Hopeless), `draftCapitalMode`, `finderPreferFuturePicks`, `finderTankMode`, `isChampionshipPush` (Elite/True Contender AND odds ≥ 70). These produce the `autoStrategyLabel` shown in [FinderDirectionPanel.tsx](components/tradeHub/FinderDirectionPanel.tsx) ("Championship Push", "Consolidate", "Full Rebuild", "Soft Sell"…).

#### 3. Candidate generation (the format loops)

For each opponent roster (excluding ignored owners and respecting the optional owner filter, [TradeFinder.tsx:553](components/tradeHub/TradeFinder.tsx#L553)), the finder pairs my pieces against theirs across ~20 formats: 1-for-1 through 4-for-4, plus pick-equalizer formats ("1 + pick for 1", "1 for 1 + pick"…), pure draft-capital formats (only when `draftCapitalMode`, [TradeFinder.tsx:583-632](components/tradeHub/TradeFinder.tsx#L583)), and a **Lottery** format (a sub-700 young upside player for one of my 3rd+-round picks, [TradeFinder.tsx:1004-1038](components/tradeHub/TradeFinder.tsx#L1004)).

**Pools.** My give pool (`myTop`) is skill players worth `>= LOW_VALUE_FLOOR` (700) and not blocked by a "Not Willing to Trade" disposition or a CORE tag ([TradeFinder.tsx:451-452](components/tradeHub/TradeFinder.tsx#L451)). The opponent receive pool (`oppTop`) is the symmetric thing, minus "Zero Interest"/"Skip" buys ([TradeFinder.tsx:573-574](components/tradeHub/TradeFinder.tsx#L573)). Picks come from `allPicks` filtered to the owner, valued via `finderPickValue` (which uses the league's dynamic per-slot prediction for the current/next year and falls back to stored round-average 2+ years out, [TradeFinder.tsx:376-379](components/tradeHub/TradeFinder.tsx#L376)), sorted by draft-year priority then round then value, capped at 8 per opponent / 6 for me.

**Per-candidate gates at generation time** (cheap rejects before the expensive scoring):
- `isBalanced(give, receive)` — the value gate in [FinderScoring.ts:129-140](components/tradeHub/FinderScoring.ts#L129): the adjusted gap must be ≤ 600 absolute AND the lighter side ≥ 85% of the heavier. Crucially, surplus bodies below 700 grant **zero** waiver/balance credit (`tradeWaiverAdj`, [FinderScoring.ts:104-119](components/tradeHub/FinderScoring.ts#L104)), so a sub-700 throw-in can't manufacture fake balance.
- `qbSafe` / `oppQbSafe` — neither side may be left with fewer than 3 top-32 QBs (bypassed for me in Tank Mode), [TradeFinder.tsx:491-504](components/tradeHub/TradeFinder.tsx#L491).
- `oppReceiveOk` — an *impact* incoming player (value ≥ 2000) at QB/WR/TE must crack the opponent's post-trade top-N at the position (QB top-3, WR top-5, TE top-2), [TradeFinder.tsx:506-527](components/tradeHub/TradeFinder.tsx#L506).
- `packageOk` / `myPkgOk` — at most one QB and one TE per package (lifted for me in Tank Mode), [FinderScoring.ts:88-92](components/tradeHub/FinderScoring.ts#L88).

**The sweetener.** For each opponent, [TradeFinder.tsx:645-651](components/tradeHub/TradeFinder.tsx#L645) searches my *full* roster for a sub-700 piece that the opponent already rosters on ≥2 of their *other* dynasty leagues (`ownedPlayerCounts`). If found, a value-neutral variant of an otherwise-balanced 1-for-1 is added with `sweetenerPlayerId` set ([TradeFinder.tsx:667-676](components/tradeHub/TradeFinder.tsx#L667)). It rides as pure goodwill.

A `MAX_CANDIDATES = 50000` freeze-guard caps total generation ([TradeFinder.tsx:551](components/tradeHub/TradeFinder.tsx#L551)); pin/target selections relax the per-format depth caps just enough to surface the rarer combos (`myCap`/`oppCap`, [TradeFinder.tsx:638-639](components/tradeHub/TradeFinder.tsx#L638)).

#### 4. `runFinderPipeline` — scoring, gating, slotting ([finderPipeline.ts:84](components/tradeHub/finderPipeline.ts#L84))

**Pre-guardrail hard filters** ([finderPipeline.ts:295-306](components/tradeHub/finderPipeline.ts#L295)) drop trades before scoring: blocked dispositions, pin/target mismatches, wrong-owner handcuff packages, bad same-team combos, Tank-Mode-must-receive-only-youth, and three philosophy gates:
- `oppDirOk` ([finderPipeline.ts:223-245](components/tradeHub/finderPipeline.ts#L223)) — judged on the opponent's *adjusted bucket* via the canonical `classifyOppDirection`. A hopeless team won't take your 1st + only aging vets; an elite/contender won't give up players for your picks-only.
- `lowValueBalancerOk` (the **anti-padding gate**, [finderPipeline.ts:252-272](components/tradeHub/finderPipeline.ts#L252)) — if removing a sub-700 body (other than a flagged sweetener) breaks `isBalanced`, that body was manufacturing fake balance → kill the whole trade. Lottery/draft-capital exempt.
- `userWindowOk` ([finderPipeline.ts:290-293](components/tradeHub/finderPipeline.ts#L290)) — a non-win-now team must never *acquire* an aging vet (`isOldProducerBuy`). Win-now = championship push, a contender bucket, or odds ≥ 50 (and not a seller bucket, and not actively tanking). This is the rule a pick-rich "Consolidate" team needs.

**PENDING suppression** ([finderPipeline.ts:327-342](components/tradeHub/finderPipeline.ts#L327)): the headline give/receive of any of my live PENDING offers to an opponent are blocked from re-surfacing for that opponent ([finderPipeline.ts:451-460](components/tradeHub/finderPipeline.ts#L451)).

#### 5. The five scoring buckets

Every surviving candidate is scored into five legible buckets ([finderPipeline.ts:1346-1365](components/tradeHub/finderPipeline.ts#L1346)). `WEIGHTS` is the single tuning point; all weights are currently 1.

- **`acceptanceBucket`** = `oppDirectionScore + crossLeagueIntelScore + partnerFitScore + attemptIntelScore + activeTraderBonus + oppDropCostPenalty + sweetenerBonus`. The dominant term is `oppDirectionScore` ([finderPipeline.ts:499-677](components/tradeHub/finderPipeline.ts#L499)): a per-bucket model of what the *opponent* wants (a hopeless team rewards receiving picks/youth `+16/+9`, penalizes receiving vets `-10`; an elite team rewards net redraft and penalizes receiving picks `-12`). It also folds in opponent position concentration, SuperFlex QB demand, a QB-depth-excess penalty scaled by `giveQualityFactor`, and an injury-replacement bonus. The whole thing is `*1.25` at the end. `sweetenerBonus = r.sweetenerPlayerId ? 4 : 0`.
- **`userFitBucket`** = `getDirectionTradeScore + lineupSafety.score + teamWindowBonus + starterQualityBonus + depthAwareTierBonus + rosterBalanceScore + championshipBonus + futurePickBonus + standingsPressureScore`. `getDirectionTradeScore` ([useScoringFactors.ts:248-382](components/tradeHub/hooks/useScoringFactors.ts#L248)) is the user-side mirror of `oppDirectionScore` — a per-bucket reward for moves that fit *your* strategy (tanker rewards selling old producers + buying future firsts; contender rewards weak-position adds + consolidation; Consolidate rewards condensing depth into young studs without hoarding more picks).
- **`valueEdgeBucket`** = `r.score + balancePenalty + starPremiumScore + pickSlotScore + handcuffBonus`. **This bucket is never clamped** — value always counts ([finderPipeline.ts:1363](components/tradeHub/finderPipeline.ts#L1363)).
- **`structureBucket`** = `formatBonus + rosterConsolidationBonus` (2-piece trades `+12`, 5-piece `-10`; consolidation bonus fires when `rosterOverflow > 0`).
- **`signalsBucket`** = disposition + market-trend + format-win-rate + season-timing + usage + cross-league-exposure + sell-high-confirm + want-to-trade bonuses.

`BUCKET_CLAMP = 100000` ([finderPipeline.ts:1357](components/tradeHub/finderPipeline.ts#L1357)) so `clampBucket` is **effectively off** — the bucketed sum is byte-identical to a flat sum of all ~30 terms. Lowering it to ~40 would bound the non-value buckets so a high-scale term (e.g. consolidation up to 50) can't swamp value. It is documented as deliberately off pending real-league visual review.

#### 6. The reject gates and ranking

After bucketing, three hard filters run ([finderPipeline.ts:1379-1390](components/tradeHub/finderPipeline.ts#L1379)):
1. Lineup-safety validity (`lineupSafety.valid`, which itself blocks contender depth-collapse, [useScoringFactors.ts:141-217](components/tradeHub/hooks/useScoringFactors.ts#L141)).
2. **`strategyScore > 0`** — the core reject gate. A trade whose total strategy score is non-positive is dropped entirely.
3. **`ACCEPT_FLOOR = -10`** ([finderPipeline.ts:442](components/tradeHub/finderPipeline.ts#L442)) — the acceptance-first gate: on a *standard swap* (not Lottery/draft-capital), `oppDirectionScore` must be `>= -10`. Neutral-fair trades land mildly negative and survive; the genuine "they'd never accept" structural mismatches (elite asked for picks-only ≈ −18) are rejected.

Critically, `rankScore = strategyScore + midValueSoftPenalty` ([finderPipeline.ts:1374](components/tradeHub/finderPipeline.ts#L1374)). `midValueSoftPenalty` ([finderPipeline.ts:1340-1345](components/tradeHub/finderPipeline.ts#L1340)) is a small capped (−8 max) de-rank for pieces in the opinion-dependent 700–1000 band. It is applied to the *ranking only*, kept out of the `strategyScore > 0` reject gate so it can reorder but never drop a trade. The sort is `rankScore` desc, then `bucketPriority` (draft-year preference, only a tiebreak), then a seeded pseudo-random `sort` so the Refresh button reshuffles ([finderPipeline.ts:1391-1398](components/tradeHub/finderPipeline.ts#L1391)).

#### 7. Slotting, dedup, caps

[finderPipeline.ts:1402-1469](components/tradeHub/finderPipeline.ts#L1402): the board is the top **12** headline trades plus **5** bonus buy-low slots (1-for-1 where the received player is on `buyLowPlayerIds`). Dedup uses a sorted-asset fingerprint (`seen`) plus a fuzzy `areTradesTooSimilar` (same opponent + ≥50% piece overlap on the same format). Caps when neither a player nor an owner is pinned: any one player in ≤2 surfaced trades (`playerCount >= 2`), ≤4 trades per opponent (`oppCount >= 4`), and at most **2** complex (≥5-piece) trades (`MAX_COMPLEX_TRADES`). Finally `recentFingerprints` ([finderPipeline.ts:1471-1481](components/tradeHub/finderPipeline.ts#L1471)) hides any trade matching one I logged in the last 28 days — [FinderResults.tsx:71-89](components/tradeHub/FinderResults.tsx#L71) suppresses these and shows the "N recently-offered trades hidden" note.

---

### The Direction engine (computed for BOTH my team and every opponent)

The strategic spine. [getRosterDirectionProfile](lib/helpers/direction/roster.ts#L37) builds a profile per roster: it ranks every team by total dynasty value (players + picks) and by redraft value, then maps `(dynRank, redRank, leagueSize)` through a **percentile 3×3 grid** ([getLeagueDirectionBucket](lib/helpers/direction/bucket.ts#L22)) into a raw bucket — top-third dynasty × top-third redraft = "Elite"/"True Contender", bottom × bottom = "Hopeless", etc. The thresholds are `ceil(n*0.20/0.33/0.67)` so an 8-team and a 14-team league scale identically. It also computes `coreAge`, `youngCoreCount`, `oldCoreCount`, per-position ranks (used as `weakPositions`/`strongPositions`), pick totals, and a human summary/actions list (shown in [FinderDirectionPanel.tsx](components/tradeHub/FinderDirectionPanel.tsx)).

The raw bucket is then **adjusted** by [getAdjustedDirectionBucket](lib/helpers/direction/scoring.ts#L65), which folds in two signals: `computeWindowScore` (age/youth, [scoring.ts:5-17](lib/helpers/direction/scoring.ts#L5)) and sim **playoff pressure** (`(playoffOdds - 50) / 12.5`). The composite can promote/demote a bucket (an Elite team with an aging core slides to "Fading Contender"; a Rebuilder with a young core can jump to "Almost There"), and hard playoff-odds floors override the gradient at the extremes (0% odds knocks any contender down to "Rebuilder"). This adjusted bucket is what the whole finder reads as `finderDirection`.

For opponents, the **single source of truth** for buyer/seller classification is [classifyOppDirection](lib/helpers/direction/scoring.ts#L43): thresholds <30 hopeless, <50 rebuild, ≥78 elite, ≥65 contender, ≥50 fading, with `isSeller` (hopeless|rebuild) and `isBuyer` (elite|contender) mutually exclusive in cascade priority. The same function is called by `oppDirOk`, `oppDirectionScore`, `crossLeagueIntelScore`, and the leaguemate rankings so an opponent is never classified three different ways. `CONTENDER_BUCKETS`/`SELLER_BUCKETS` ([scoring.ts:23-25](lib/helpers/direction/scoring.ts#L23)) are the canonical user-side sets shared by `getDirectionTradeScore`, `failsDirectionGuardrail`, and `userWindowOk`.

---

### Cross-league intel (the sweetener + acceptance nudges)

[useCrossLeagueMateIntel.ts](hooks/useCrossLeagueMateIntel.ts) fetches **live from Sleeper** — and *only* on the Finder/Recommendations tab (or the League Mates tab), gated at [useCrossLeagueMateIntel.ts:34-43](hooks/useCrossLeagueMateIntel.ts#L34). For each opponent it walks all of that owner's *other* dynasty leagues to compute:
- `ownedPlayerCounts` — the full map of playerId → how many of their other leagues roster him. This powers the **sub-700 sweetener** (≥2 other leagues = personal affinity, [TradeFinder.tsx:645-651](components/tradeHub/TradeFinder.tsx#L645)). The hook deliberately keeps the *full* map, not just top-3 ([useCrossLeagueMateIntel.ts:221-223](hooks/useCrossLeagueMateIntel.ts#L221)).
- `tradePreferredPositions` and `youngQbWrBuyRate`/`veteranRbBuyRate` — from their last-30-day completed trades (startup-draft picks filtered out). These feed `crossLeagueIntelScore` ([finderPipeline.ts:1072-1120](components/tradeHub/finderPipeline.ts#L1072)): giving them a position they keep buying is `+7`; asking for a player they repeatedly hoard (`repeatedPlayers`) is `-8`.

This intel is enriched into `LeagueMateView`/`TradePartnerRanking` (with `fitScore`, `playoffOdds`, `directionProfile`, …) and reaches the pipeline as `leagueMateProfileByRosterId` and `tradePartnerRankings`.

---

### Logged attempts & the NEW decline memory (commit ff8d1a5)

The `trade_attempts` Supabase table ([lib/types.ts:838-854](lib/types.ts#L838); CRUD in [useTradeAttempts.ts](hooks/useTradeAttempts.ts)) is the user's own offer ledger. It feeds the pipeline in several ways:
- **`attemptIntelScore`** ([finderPipeline.ts:787-868](components/tradeHub/finderPipeline.ts#L787)) — time-decayed (full weight ≤14 days, half ≤56 days). THEM-initiated offers reveal appetite (their give = sell interest `+11`, their ask = buy interest, my received-as-give `+14`). My still-live/ACCEPTED offers are standing interest.
- **`activeTraderBonus`** ([finderPipeline.ts:1047-1070](components/tradeHub/finderPipeline.ts#L1047)) — 30-day engagement bonus per opponent; `-4` if they've declined/ghosted everything ≥2 times.
- **`formatWinRates`** ([finderPipeline.ts:345-361](components/tradeHub/finderPipeline.ts#L345)) — resolved FINDER attempts feed an `archetypeWinRateBonus` per piece-count format (`2v1` etc.) once you have ≥2 data points.
- **PENDING suppression** and **`recentFingerprints`** (above).

**The decline memory** (verified against commit `ff8d1a5`, [finderPipeline.ts:809-865](components/tradeHub/finderPipeline.ts#L809)): a deal I floated that the owner *refused* now routes to two decaying per-player maps instead of being read as interest. DECLINED counts full weight; NO_RESPONSE (a ghost) counts half. COUNTERED is treated as *engagement*, not refusal, so it stays in the "live" interest branch. The penalties are **directional**: a player I asked for and couldn't get (`declinedReceive`) → `-12 * weight` on the receive side ([finderPipeline.ts:850-851](components/tradeHub/finderPipeline.ts#L850)); a player I offered and they wouldn't take (`declinedGive`) → `-8 * weight` on the give side ([finderPipeline.ts:861-864](components/tradeHub/finderPipeline.ts#L861)). Both are capped via `DECLINE_WEIGHT_CAP = 1.5` so chasing one player with several escalating offers can't stack an unbounded penalty that buries every other package merely containing him. The give-side penalty is **sweetener-exempt** (a sweetener must remain a pure +4 nudge). The commit also fixed a real bug: a DECLINED/NO_RESPONSE attempt previously fell into the `else` branch and was scored as *positive* standing interest — now it correctly subtracts.

---

### User-opinion inputs: dispositions & tags

The Finder's buy/sell opinion now comes entirely from the personal-ranking signal (below). The old manual Sell/Buy dropdowns were removed in Phase 3; what feeds the engine:
- **`finderDispositions`** (`{ sell, buy }` per player) — softer values ("Trade at All Costs", "Lower than Market", "Buy at Market"…) feed `dispositionScore` in the signals bucket ([finderPipeline.ts:480-498](components/tradeHub/finderPipeline.ts#L480)). Derived from the personal board (not manual input) and threaded into the Trade Hub / Finder under the historic `playerDispositions` prop name. The scoring contract in `finderPipeline.ts` is unchanged.
- **Block predicates (Stage 6).** Hard blocks read the signal, not strings. The give-side block (`isBlockedSellDisposition`) is **CORE-tag-only**; the receive-side block (`isBlockedBuyDisposition`) reads the raw personal signal directly — `finderSignals[id] === "STRONG_SELL"` ([TradeFinder.tsx](components/tradeHub/TradeFinder.tsx)). `finderSignals` is the `Record<id, PersonalSignal>` map threaded `useAppState → HubRouter → TradeHub → TradeFinder` alongside `finderDispositions`.
- **`leaguePlayerTags`** (per-league `CORE | WANT_TO_TRADE`, stored in `league_player_tags`) — **CORE = never sell** (the sole give-side hard block now); **WANT_TO_TRADE = actively shopping**, which adds a flat `+20` `wantToTradeBonus` ([finderPipeline.ts:1309](components/tradeHub/finderPipeline.ts#L1309)) to any trade that gives that player. The tagged-players strip is rendered at [TradeFinder.tsx:1262-1307](components/tradeHub/TradeFinder.tsx#L1262). This is the **only remaining manual per-player overlay**.

> **Phase 3 removal (done).** The manual `playerDispositions` Sell/Buy dropdowns (RankingsTab + PlayerProfilePanel), the `savePlayerDisposition`/`playerDispositions` state in `usePlayerAnnotations`, the Supabase load in `useAppState`, and all their prop plumbing through `HubRouter`/`DataHub`/`TradeHub` are gone, along with the `sellColor`/`buyColor` helpers and the dead `tradeRecommendationCards` engine. The Supabase **`player_dispositions` table is left orphaned on purpose** — no `DROP` (needs separate approval per [feedback_no_destructive_sql]).

**Personal rankings (the buy/sell signal source — Phases 1-3 + Stage 6 all live).** A **Personal** view in the Data Hub Rankings tab ([RankingsTab.tsx](components/DataHub/RankingsTab.tsx)) lets the user keep their own drag-/type-to-rank ordered board (one global list of player_ids, persisted by [usePersonalRankings](app/hooks/usePersonalRankings.ts) — localStorage `personalRankings_v1` + Supabase `personal_rankings`, migration `040`). The gap between the user's rank and the market-consensus dynasty rank becomes a buy/sell signal. All logic is pure in [lib/helpers/personalRankings.ts](lib/helpers/personalRankings.ts):
  - `buildConsensusOrder(players, valueOf)` — the shared market board (skill positions, positive dynasty value, value-descending). Used by **both** the Personal view and the Finder feed so they can't drift.
  - `reconcilePersonalOrdering` — seeds an untouched board from consensus (everyone NEUTRAL), splices in newcomers at their consensus rank, drops players who left the universe.
  - `derivePersonalSignal(personalRank, consensusRank)` — **percentage** gap `|personalRank − consensusRank| / consensusRank` → `STRONG_SELL | SELL | NEUTRAL | BUY | STRONG_BUY`. Defaults: **≥12% ⇒ Sell/Buy, ≥20% ⇒ Super Sell/Super Buy, plus a 6-spot absolute floor and a top-25 Super guard** (`DEFAULT_PERSONAL_SIGNAL_THRESHOLDS = { sellPct: 12, strongPct: 20, minGap: 6, topGuardRank: 25, topGuardStrongGap: 9 }`). Measuring relative to the market rank keeps a 10-spot disagreement meaningful deep on the board without firing on top-of-board shuffles; the `minGap` floor (applied first) requires at least a 6-spot gap before any signal, which protects roughly ranks 1–50 (at rank 50, 12% already equals 6 spots — above it the % dominates, below it the floor does). The **top guard** then caps the Super tier inside the top 25: a 6–8 spot move there is a big % but a small real disagreement, so it stays plain Sell/Buy — reaching Super Sell/Buy in the top 25 needs a 9+ spot gap. UI labels (in `PERSONAL_SIGNAL_META`): Super Sell / Sell / Hold / Buy / Super Buy — the raw ± rank gap is still shown in the "vs Mkt" column; the % is computed only to pick the signal, never displayed.
  - `buildPersonalSignals(personalOrdering, consensusOrder)` — the **canonical sparse `Record<id, PersonalSignal>`** (NEUTRAL omitted). This is what the Finder's block predicates read (Stage 6).
  - `personalSignalToDisposition` + `buildPersonalDispositions(...)` — the **Phase-2 scoring adapter**, now a thin wrapper over `buildPersonalSignals` (so the two can't drift): maps each signal to the legacy `{ sell, buy }` strings `dispositionScore` keys off of.
  - `useAppState` builds the consensus once (`consensusOrderForFinder`) and derives both `finderSignals` and `finderDispositions` from it (memos just below `leagueAdjustedFcValues`), routing them to the Finder. The view presorts from live consensus and has a **Reset to market** button (`savePersonalOrdering([])` → re-seed) behind a confirm.
  - **Persistence (cross-device).** [`usePersonalRankings`](app/hooks/usePersonalRankings.ts) dual-persists: localStorage `personalRankings_v1` for instant reload **and** the Supabase `personal_rankings` table (one jsonb `ordering` row per user, PK `user_id`, RLS `auth.uid() = user_id`) as the source of truth. `useAppState` hydrates that row on login, so the board follows the user across devices (desktop ↔ phone).

**Player profile panel — team depth chart.** The slide-over [PlayerProfilePanel.tsx](app/components/modals/PlayerProfilePanel.tsx) (the ⓘ info-circle pop-out in RankingsTab) renders a **Depth Chart** card for the player's own team + position group, between the Status and ownership cards. It reuses the Data Hub depth-chart logic inline — build the position group from the `players` prop, sort by `depth_chart_order` then dynasty value descending (the slim `/api/players` proxy strips `depth_chart_order`, so in practice this is value order), and reuse `injuryBadge`/`ageColor` from [dataHubHelpers.tsx](components/DataHub/dataHubHelpers.tsx). The current player's row is highlighted, depth #1 gets a **Starter** badge, and rows on a roster you own get a blue dot. The panel was widened `max-w-sm` → `max-w-lg` to fit it.

---

### Important boundary: aggregate behavior only, never a per-player ledger

A deliberate design line: completed-trade data is used **only as the other owner's aggregate behavior** (their last-30-day buy rates, preferred positions, ownership affinity) — never as a per-player "they once traded X" ledger inside the finder. The cross-league hook *does* compute `acquiredPlayers` and `acquiredPlayerCounts` ([useCrossLeagueMateIntel.ts:139-148, 173-180](hooks/useCrossLeagueMateIntel.ts#L139)), and `league_transactions_cache` exists elsewhere in the app, but **neither is wired into the finder's scoring**. The reasons (documented in user memory `project_trade_finder_decline_memory.md`): a per-player completed-trade ledger is noisy and easily polluted (the username-switch spying problem is the root cause of ghost data in `league_transactions_cache`), and the finder already has cleaner directional signals — the owner's *aggregate* tendency plus the user's *own* logged attempts/declines. The finder's per-player memory comes exclusively from the user's `trade_attempts` table, not from scraped completed trades.

---

## 11. Scouting & Charting Hub

The Scouting Hub is DynastyZeus's film-study workbench: you create college **prospects**, log **games** for them, then chart every play by position. The raw plays roll up into per-prospect stats, an "Above Expected" metric per position, a sortable Big Board, and a per-game log. It is one of the nine top-level hubs ([components/ScoutingHub.tsx](components/ScoutingHub.tsx)), lazy-mounted by [HubRouter](app/components/HubRouter.tsx) only when its tab is active.

### Top-level data flow

[ScoutingHub.tsx](components/ScoutingHub.tsx) is the data owner. On mount it fires one `Promise.all` ([ScoutingHub.tsx:108-165](components/ScoutingHub.tsx#L108)) that loads:

- `prospects` (ordered by `personal_rank`)
- `scouting_games`
- The three server-side aggregate views: `prospect_route_stats`, `league_route_baselines`, `prospect_game_snap_stats`
- The per-position stat stubs: `prospect_rb_stats`, `prospect_qb_stats` (with `total_throws`), `prospect_te_stats` (with `total_routes`)

It then calls [buildProspectsWithStats](lib/scouting/aggregateMerge.ts#L190) to merge `prospects` + view rows + league baselines into `ProspectWithStats` objects — the shared currency passed to every child tab. **Raw plays are not loaded here.** RB/QB/TE plays are fetched lazily and only on demand: a child (Big Board, Games Log, Analysis) calls `loadPositionPlays(pos)` ([ScoutingHub.tsx:176-184](components/ScoutingHub.tsx#L176)), which fetches the `*_plays` table via [fetchPlaysByGame](components/ScoutingHub.tsx#L52) — the game-id IN list is chunked (80 ids/request) and each chunk paginated 1000 rows at a time — and caches the result keyed by the joined game-id string (`fetchedPlaysRef`) so a position is fetched at most once per parent reload. The chunking keeps the request URL under the gateway's URI-length cap; without it a class with hundreds of games produced a >20k-char URL that PostgREST intermittently 414-rejected, leaving QB/RB/TE Analysis blank. On fetch failure the `fetchedPlaysRef` marker is cleared so the next tab activation retries instead of sticking on a blank table until a full hub reload. WR route data needs no raw-play fetch on these tabs because `prospect_route_stats` already projects everything.

The header shows a per-draft-class, per-position breakdown (prospect count, fully/partial-charted, games, snaps), recomputed in the `headerBreakdown` memo ([ScoutingHub.tsx:282-301](components/ScoutingHub.tsx#L282)).

The hub has six tabs ([ScoutingHub.tsx:257-264](components/ScoutingHub.tsx#L257)): **Prospects** (position sub-tabs WR/RB/QB/TE), **Big Board**, **Games Charted**, **Analysis**, **Recruits**, **Recruit Statistics**. The Prospects tab routes to one of four position hubs ([WRHub](components/scouting/wr/WRHub.tsx) / [RBHub](components/scouting/rb/RBHub.tsx) / [QBHub](components/scouting/qb/QBHub.tsx) / [TEHub](components/scouting/te/TEHub.tsx)), each lazy-loaded via `dynamic(..., { ssr: false })`.

### The per-position charting boards — shared vs. position-specific

Every position board is built on a single shared shell plus a position-specific play logger. This is the key architectural pattern to understand.

**Shared** (used identically by all four):
- [shared/ChartingBoard.tsx](components/scouting/shared/ChartingBoard.tsx) — the presentational shell: back button, prospect header, the **Edit Bio** panel (name/school/height/weight/birthday/ranks/NFL-role dropdowns/charting status/draft round-pick-team), the tab bar, the games sidebar (add/select/inline-edit/delete game), and slots for position-specific content via render props (`renderOverview`, `renderPlayLogger`, `renderGamesTable`, optional `renderHeaderStats` / `renderGameBadge` / `renderExtraTab`). It takes an `accentColor` of `"blue"` or `"green"` and maps it to a Tailwind class bundle ([ChartingBoard.tsx:51-70](components/scouting/shared/ChartingBoard.tsx#L51)).
- [shared/hooks/useChartingState.ts](components/scouting/shared/hooks/useChartingState.ts) — owns all shell **state and mutations**: loads `scouting_games` for the prospect, manages the add-game form, `addGame` / `deleteGame` / `updateGame` / `saveBio`. Deletes and bio saves check the Supabase error **before** mutating local state so a failed write doesn't show phantom success ([useChartingState.ts:90-104](components/scouting/shared/hooks/useChartingState.ts#L90), [:118-135](components/scouting/shared/hooks/useChartingState.ts#L118)).
- [shared/chartingConstants.ts](components/scouting/shared/chartingConstants.ts) — `GAME_TYPES`, `CHARTING_DECISIONS`, `ROUTE_TYPES`, and the `deriveChartingDecision` auto-promote logic (below).
- [shared/chartingTypes.ts](components/scouting/shared/chartingTypes.ts) — `pct` / `fmtPct` helpers and the `BoardTab` type.

**Position-specific** (what each board owns):

| Position | Board file | DB table | Accent | NFL roles | Play logger captures |
|---|---|---|---|---|---|
| WR | [PlayerChartingBoard.tsx](components/scouting/wr/PlayerChartingBoard.tsx) | `route_plays` | blue | X / Y / Slot / X-or-Y / "Sacrificial X" / "Target Hog Y or Slot" / … | route type, alignment (L/R/Slot/Backfield), on-line, coverage, was-open, targeted, outcome (caught/drop/incomplete), contested, yards. Adds a 4th **"Charts"** tab ([PlayerCharts.tsx](components/scouting/wr/PlayerCharts.tsx)) plus Bulk/Summary game import. |
| RB | [RBChartingBoard.tsx](components/scouting/rb/RBChartingBoard.tsx) | `rb_plays` | **green** | (RB-specific) | formation (gun/pistol/UC), run type (outside/inside zone, man-gap), loaded box, success, plus receiving/decoy logging. |
| QB | [QBChartingBoard.tsx](components/scouting/qb/QBChartingBoard.tsx) | `qb_plays` | blue | Franchise QB / Starter / Bridge / Backup | the richest logger — see below. |
| TE | [TEChartingBoard.tsx](components/scouting/te/TEChartingBoard.tsx) | `te_plays` | **green** | (TE-specific) | dual-purpose: route-running (positioning, coverage, was-open) **and** blocking (run/pass block, movement/inline, block success). |

> **Naming note:** there is **no `wr_plays` table** — WR receiving data lives in `route_plays` (migrations [007d](supabase/migrations/007d_route_plays_v2.sql)/[007e](supabase/migrations/007e_route_plays_was_open.sql)/[007h](supabase/migrations/007h_route_plays_no_route_run.sql)). The `league_route_baselines` and `prospect_route_stats` views are both built from `route_plays`.

**"Fully Charted" auto-promotion** ([deriveChartingDecision](components/scouting/shared/chartingConstants.ts#L21)) promotes a prospect's stored `charting_decision` up the `charting → partial_chart → fully_charted` chain based on per-position thresholds — **WR ≥ 150 routes, TE ≥ 120 routes, QB ≥ 150 throws, RB ≥ 6 games** — but never demotes, and leaves manual `pending`/`not_charting` alone. The counts come from the stat-stub views (`total_throws`, `total_routes`) plumbed through `buildProspectsWithStats`.

### The qb_plays expansion (migrations 028–034)

`qb_plays` started minimal in [009_qb_tables.sql](supabase/migrations/009_qb_tables.sql) (snap position, play type, timing, accuracy, depth zone, route type, man/zone coverage). It was expanded over six migrations into the most detailed charting schema in the app. Every new column is **nullable** so old rows stay valid and simply don't contribute to the new metrics:

- **[012](supabase/migrations/012_qb_timing_sack_throwaway.sql)** — added `scramble` / `sack` / `throw_away` to the `timing` check (no accuracy recorded on these).
- **[028](supabase/migrations/028_qb_throws_te_routes.sql)** — added `total_throws` to the `prospect_qb_stats` view (a "throw" = `play_type IN ('rpo','pass')` with `timing IN ('first_option','second_option','checkdown')`), driving the 150-throw fully-charted gate.
- **[031](supabase/migrations/031_qb_accuracy_tipped_ball.sql)** — added `tipped_ball` to the accuracy check. Tipped balls are logged (so the snap is recorded) but **excluded from accuracy metrics** because the intended trajectory is unknowable after a deflection.
- **[032](supabase/migrations/032_qb_platform_pressure.sql)** — added `platform` (on/off-platform, on-the-run), `platform_side` (strong-side / cross-body, only valid when `platform = on_the_run`), `pressure` (clean / mid / backside / front-side), and `pressure_handling` (step-up / bail-front-side / bail-backside, only valid when pressured and not clean). The check constraints enforce these conditional relationships in the DB.
- **[034](supabase/migrations/034_qb_touch.sql)** — added `touch` (correct / incorrect) — whether the velocity/feel fit the situation. The UI defaults it to `"correct"` so the charter only flips it when something's off ([QBChartingBoard.tsx:92-93](components/scouting/qb/QBChartingBoard.tsx#L92)).

Display constants for all of these (3×3 depth grid, platform/pressure/handling buckets, the 4-bucket "platform breakdown" that splits on-the-run by side) live in [qb/qbConstants.ts](components/scouting/qb/qbConstants.ts), shared by the board and the QB Overview panel.

### Aggregate views for charting-hub performance (migrations 020–022)

Originally `ScoutingHub` reduced every raw snap in JavaScript to build per-prospect stats — slow at scale. [020_scouting_aggregate_views.sql](supabase/migrations/020_scouting_aggregate_views.sql) moved that to **server-side plain views** (`security_invoker = on`):

- **`league_route_baselines`** — long-format league-wide open-rate per route type and per coverage, the baseline for the WR SAE calc.
- **`prospect_route_stats`** — one row per prospect projecting ~50 fields (snaps, routes, targets, catches, alignment splits, open% splits, jsonb `route_stats_raw` / `coverage_stats_raw`), with a summary-vs-charted fallback that mirrors the old JS branch on `summary_targets`.
- **`prospect_rb_stats` / `prospect_qb_stats` / `prospect_te_stats`** — stubs (snaps + games), later extended with `total_throws` / `total_routes` in [028](supabase/migrations/028_qb_throws_te_routes.sql).

The client merge ([aggregateMerge.ts](lib/scouting/aggregateMerge.ts)) does the final assembly and recomputes `adj_success_above_exp` (WR SAE) from the view's route/coverage counts + baselines, deliberately keeping the view a pure projection so the open-data gating (`open=0` / `catches=-1` when un-charted) stays in JS. **`press` folds into the `man` bucket** for the SAE expected-rate math ([aggregateMerge.ts:91-138](lib/scouting/aggregateMerge.ts#L91)). Per-game views (`prospect_game_route_stats`, `prospect_game_snap_stats`) were added in [021](supabase/migrations/021_scouting_game_route_stats.sql)/[022](supabase/migrations/022_scouting_game_snap_stats.sql) for the Games Log.

### QB Accuracy Above Expected (AAE) model v2

The headline analytics model is the **QB AAE**, implemented in [lib/scouting/aboveExpected.ts](lib/scouting/aboveExpected.ts) alongside sibling metrics (RB SRAE, TE route-running TE-SAER, TE blocking TE-SAEB). All follow the same shape — *actual rate − situation-weighted expected rate from league baselines* — but the QB version is materially more sophisticated. It is the math previously inlined in `QBStatsTable`, extracted so the Analysis table, the Big Board column, and the prospect Overview panel all show identical numbers.

AAE compares a QB's actual mean **throw value** against an expected mean built from league baselines across **seven situational dimensions**: depth zone, coverage (man/zone), timing, pressure, platform (including on-the-run side), pressure handling, and route type ([aboveExpected.ts:180-212](lib/scouting/aboveExpected.ts#L180)). Four design choices define "v2":

1. **Graded throw value, not a binary on-target flag** ([throwValue](lib/scouting/aboveExpected.ts#L96)). `on_target = 1.0`; any miss caught = `MISS_BASE + CATCH_BONUS` (0.30); any miss not caught = `MISS_BASE` (0.20). All off-target grades (high/low/in-front/behind) score the same — the metric is on-target-vs-not, not a ranking of miss severity. The small catch bonus lets a functional caught miss edge an identical dropped one without letting catchable inaccuracy out-score a pinpoint passer. Tipped balls and null-accuracy plays (sack/scramble/throw-away) are filtered out entirely by `isQBGradedThrow`; RPO throws are included.
2. **Empirical-Bayes shrinkage** ([resolveDim](lib/scouting/aboveExpected.ts#L275), `SHRINK_K = 10`). Each league bucket's rate is pulled toward the global mean throw value by 10 pseudo-throws, so thin buckets (a depth zone seen a handful of times) collapse toward league average instead of swinging the metric on noise.
3. **Dimension weighting by discrimination** — each dimension's weight is the sample-weighted standard deviation of its shrunk bucket rates. A flat dimension (all buckets near the same rate) carries little information and is down-weighted toward 0; high-spread dimensions (e.g. depth zone) dominate.
4. **Per-play expected, not a mean of per-dimension AAEs** ([expectedForPlay](lib/scouting/aboveExpected.ts#L329)). The overall AAE total compares actual throw value to the mean of per-play discrimination-weighted expecteds, so correlated dimensions (the pressure cluster) aren't double-counted — a broken-pocket throw gets one blended expected, not four separate penalties. There is intentionally **no standalone "platform_side" or "pressure handling" AAE row**; handling still feeds the overall total via `R.handling`.

Sample-size gates: RB/TE use a 15-known-play minimum; **QB uses 25** (`QB_MIN_SAMPLE`) because seven dimensions make each per-dimension estimate noisier. The "platform side" refinement buckets on-the-run throws as strong-side vs. cross-body (cross-body being meaningfully harder), with `on_the_run` (no side charted) as a fallback for older plays ([platformKey](lib/scouting/aboveExpected.ts#L56)).

There is **no change to the charting form** for v2 — it reuses the platform/pressure/touch columns from migration 032/034. Per the user's memory ([project_qb_aae_model_v2.md]), a #5 **logistic-regression** expected-value model was **deferred** (to be reached later with a smooth auto-blend), and a leave-one-out adjustment was rejected by the user. Exported entry points: `computeQBAboveExpected` (Map of totals), `computeQBAAEBreakdown` (single prospect, per-dimension rows for the Overview panel), and `computeQBAAEBreakdownMap` (bulk, for the Analysis table).

The Big Board surfaces a unified "Above Expected" sortable column that dispatches to the right metric per position (`computeRBAboveExpected` / `computeQBAboveExpected` / `computeTERouteAboveExpected`), triggering the lazy play fetch on mount ([BigBoard.tsx:1-52](components/scouting/BigBoard.tsx#L1)).

### The two ranking columns + the Prospect Data reorder

Prospects carry two independent integer ranks, and **both are scoped per (position, draft class)** — the model is documented at [ScoutingHub.tsx:209](components/ScoutingHub.tsx#L209):

- **`personal_rank`** — "POS" rank: #1 QB-2027, #1 WR-2027, etc. Edited by `handleUpdateRank` ([ScoutingHub.tsx:210-232](components/ScoutingHub.tsx#L210)), which re-sequences the prospects sharing the mover's `position` **and** `draft_class_year` into a contiguous 1..N.
- **`overall_rank`** — "OVR" rank: #1 across all positions within a draft class. Edited by `handleUpdateOverallRank` (same shape, scoped to `draft_class_year` only).

There are **two surfaces that write these ranks**, and they were deliberately reconciled to the same per-(position, class) model so they can't corrupt each other:

1. **The Big Board** ([BigBoard.tsx](components/scouting/BigBoard.tsx)) — drag-to-reorder or click-to-edit. The **All** tab edits `overall_rank`; each **position** tab edits `personal_rank` (`rankUpdater`/`rankField` are `boardTab`-aware).
2. **The Prospect Data sheet** ([ProspectRosterSheet.tsx](components/scouting/ProspectRosterSheet.tsx), rendered by each position hub's "Prospect Data" sub-tab) — type a new rank into the Rank column. Committing a rank calls `reorderRanksWithinClass` ([lib/scouting/rankReorder.ts](lib/scouting/rankReorder.ts)), the pure helper that scopes the move to the mover's draft class and renumbers that class to a contiguous 1..N (it also collapses any pre-existing duplicate/gap ranks on the next edit). Rank state is lifted to the sheet as an optimistic override (siblings update live; the per-row local state never re-syncs from props), persisted as a minimal diff. Covered by [__tests__/lib/scouting/rankReorder.test.ts](__tests__/lib/scouting/rankReorder.test.ts).

### Big Board layout — one table for every tab

All five tabs (All + QB/RB/WR/TE) render through a **single** `renderStandardTable()` ([BigBoard.tsx](components/scouting/BigBoard.tsx)). The position tabs are the All layout, position-filtered, with the **Above-Exp (AE)** column shown on every tab. The only per-tab differences: the All tab uses `overall_rank` as the primary (editable) rank with `personal_rank` ("PosRk") plus a colored **Pos** column as readouts; each position tab uses `personal_rank` as primary with `overall_rank` ("OVR") as the readout and no Pos column. (The detailed WR route/coverage stats are **not** on the Big Board — they live in the **Analysis** tab; see [AnalysisHub](components/scouting/stats/AnalysisHub.tsx).)

The **NFL Draft** column is a per-prospect **projected round** (1st–7th) dropdown, stored in `localStorage["nflDraftRound"]` as `Record<prospectId, number>`. On first load it migrates any rounds out of the legacy `{team,round,pick}` `localStorage["nflDraftInfo"]` map (read-only — that legacy key is still owned independently by the Rookie Big Board's draft tracker, so the migration never mutates it).

## 12. Recruits & CFD Matching

The Scouting Hub cross-references your hand-built prospects against the **247Sports Composite** high-school recruiting rankings, sourced from the CollegeFootballData (CFD) API.

- **Ingestion:** [lib/recruiting/cfd.ts](lib/recruiting/cfd.ts) fetches one year's full HighSchool class (~3k records, ~1MB, no pagination) and normalizes CFD's camelCase into the snake_case `recruits` row shape. The CFD key never leaves the server.
- **API route:** [app/api/recruiting/[year]/route.ts](app/api/recruiting/[year]/route.ts) — `GET` returns cached `recruits` + `recruits_meta` for a year (no CFD call); `POST` refreshes from CFD, deletes that year's rows and re-inserts in 500-row batches, then upserts meta. The POST limit is tight (10/min) to protect CFD's ~1000-calls/month free tier. Hooked up via [hooks/useRecruits.ts](hooks/useRecruits.ts) (stale-while-revalidate, keyed by year) feeding the **Recruits** and **Recruit Statistics** tabs.
- **Matching:** [hooks/useRecruitIndex.ts](hooks/useRecruitIndex.ts) loads a minimal recruit projection once per mount (paginated 1000-row chunks) and builds an in-memory name index, exposing `matchProspect()`. The matcher ([lib/recruiting/match.ts](lib/recruiting/match.ts)) uses three signals in priority order: (1) **normalized name** via `normalizeRookieName` (suffix-stripped, alphanumeric, so "Carnell Tate Jr." matches "Carnell Tate" both ways); (2) **position window** (exact, or recruit position = `ATH`, CFD's catch-all for multi-position freshmen); (3) **year window** — recruit HS class 3–7 years before the prospect's `draft_class_year`, tie-broken toward the typical 4-year path then by stars. The match drives the star badge shown next to each prospect ([QBHub.tsx:267](components/scouting/qb/QBHub.tsx#L267) via [RecruitStarBadge](components/scouting/RecruitStarBadge.tsx)).

A `recruits_position_stars_view` ([019](supabase/migrations/019_recruits_position_stars_view.sql)) supports the Recruit Statistics tab.

## 13. Network Consensus Draft Board

> **Location correction:** the Network Consensus board is **not** in the Scouting Hub — it lives in **DraftHub** as the "Consensus" tab of Draft History ([components/draftHub/DraftHistory/ConsensusTab.tsx](components/draftHub/DraftHistory/ConsensusTab.tsx), driven by [useDraftHistory.ts](components/draftHub/DraftHistory/hooks/useDraftHistory.ts)). It is documented here because the prompt grouped it with the draft-board work.

The goal: compute a crowd-sourced rookie ADP by mining the rookie drafts of **every Sleeper user connected to you through any shared dynasty league**, across many years.

**Server route** [app/api/compile-consensus/route.ts](app/api/compile-consensus/route.ts) (`maxDuration = 300`s, Vercel Pro; rate-limited to 5 compiles / 10 min / IP). It POSTs a streaming **NDJSON** response (`application/x-ndjson`, nginx buffering disabled) so the client sees live progress. The expansion algorithm:

1. **Seed** — fetch your own dynasty leagues for each requested year, filtered to **Superflex, non-IDP dynasty** leagues only (`isDynastyLeague` = taxi slots > 0 or > 20 roster positions and not best-ball; `isSuperflex`; `!hasIDP`). Collect every other owner's Sleeper user-id from those leagues' rosters.
2. **Expand** — build `(connectedUserId, year)` pairs and, with bounded concurrency (`COMPILE_CONCURRENCY = 15`), fetch each connected user's leagues for each year, accumulating a deduped set of all reachable dynasty league-ids.
3. **Find rookie drafts** — for each league, fetch its drafts and keep only rookie drafts (≤ `ROOKIE_DRAFT_MAX_ROUNDS` = 6 rounds). Past years require `status = complete`; the **current year also accepts in-progress** (`drafting`/`paused`) drafts for a rough live-ADP read.
4. **Compile picks** — load the full Sleeper player map once as a fallback (`COMPILE_PICKS_CONCURRENCY = 8`), then for each draft aggregate picks per player. **Veterans are filtered out** via the pick's `years_exp > 0`. Output rows are average pick number + draft count, sorted by avg pick.
5. **Write** — upsert fresh rows into `consensus_draft_cache` in 200-row batches (old rows stay readable), then prune only now-stale rows (`computed_at < runAt`), and only if the run produced rows — so a failed/empty run can't wipe a good cache. Per-year metadata lands in `consensus_draft_meta`.

**Tables:** `consensus_draft_cache` and `consensus_draft_meta` were created back in [006_consolidate_schema.sql](supabase/migrations/006_consolidate_schema.sql) (RLS `auth.uid() = user_id`); `computed_at` was added in [004](supabase/migrations/004_indexes_and_ttl.sql) for the weekly 90-day eviction cron. **Migration 037** ([037_consensus_index_and_migration_ledger.sql](supabase/migrations/037_consensus_index_and_migration_ledger.sql)) added an index on `consensus_draft_cache(computed_at)` so that eviction cron is a range scan, plus an `applied_migrations` ledger (manually maintained, seeded with 001–037). User hit/neutral/bust grades persist in `consensus_player_grades`.

**Client** ([useDraftHistory.ts](components/draftHub/DraftHistory/hooks/useDraftHistory.ts)): `runCompile` reads the NDJSON stream line-by-line, updating a progress bar and, on each `year_done` event, refreshing meta and invalidating that year's cache. The Draft History view has four sub-tabs — LEAGUE, CONSENSUS, MY_PICKS, GRADES — and lazily loads cached consensus rows per year. (Note: `league_draft_snapshots` — [025](supabase/migrations/025_league_draft_snapshots.sql) — is a *separate* feature: named saves of the **Live Draft Board** grid, not the consensus pipeline.)

## 14. Rookie Big Board

A distinct, simpler feature from the Scouting Hub's college Big Board: a draggable, FantasyCalc-sorted ranking of the upcoming rookie class, in [hooks/useRookieBoardState.ts](hooks/useRookieBoardState.ts).

**Sources merged** ([useRookieBoardState.ts:169-282](hooks/useRookieBoardState.ts#L169)): (1) a crowdsourced Google Sheet of rookie names+positions, proxied with a 6-hour cache through [app/api/rookie-board-sheet/route.ts](app/api/rookie-board-sheet/route.ts); (2) Sleeper rookie ADP, used **only** for player_id/position/team metadata, never for sort order; (3) **FantasyCalc Superflex dynasty values** (`isDynasty=true&numQbs=2`).

**Default sort is FantasyCalc Superflex value, descending**, falling back to Sleeper ADP then name ([useRookieBoardState.ts:277-282](hooks/useRookieBoardState.ts#L277)).

**Why name-based matching is critical:** the upstream sheet, Sleeper, and FantasyCalc are three independent sources with no shared key, so FC values are joined to sheet players by `normalizeRookieName` first, with a Sleeper-ID fallback only when a name match fails. A normalization miss leaves a player at value 0 and sinks them to the bottom — hence the built-in `ROOKIE_NAME_CORRECTIONS` map for known sheet typos (e.g. "max kalre" → "Max Klare"), which a **user override always supersedes**.

**Overrides** persist to both localStorage and the `rookie_board_overrides` table ([017](supabase/migrations/017_rookie_board_overrides.sql)): user-added rookies (`added`) and per-name edits (`name_edits`). User reordering persists to the `rookie_board` table as an ordered name array; load priority is Supabase → localStorage → FC default. Everything is keyed by `ROOKIE_BOARD_VERSION` (currently `${BASE_YEAR}_sf_v5`) so bumping the version resets the board for a new class. Note `ROOKIE_YEAR` tracks the **calendar** year (rolls Jan 1), not the NFL season year.

Named snapshots of the **college prospect** Big Board (overall/personal rank + NFL draft info) go to `big_board_snapshots` ([015](supabase/migrations/015_big_board_snapshots.sql)) — overwrite-by-name, RLS-scoped per user — distinct from the `rookie_board` tables above.

---

## 15. Supabase (database)

Supabase is the only persistence layer in DynastyZeus. It holds **everything user-generated** (notes, tags, trade logs, scouting charts, simulator results, draft boards) plus a handful of **shared caches** that smooth over expensive Sleeper/FantasyCalc API calls. There is no other database — the Next.js app talks to Postgres exclusively through the Supabase JS client. Auth is Supabase Auth (the `auth.users` table), and almost every app table foreign-keys back to `auth.users(id)`.

### Schema source of truth: snapshot file vs. the migration chain

There are **two** descriptions of the schema and you need to understand how they relate:

- **[supabase/schema.sql](supabase/schema.sql)** is a *from-scratch snapshot* — the file you would paste into the Supabase SQL editor to stand up the **user-data** tables on a brand-new project. It defines 30-ish tables from `notes` through `gm_briefings`, each with `CREATE TABLE IF NOT EXISTS` + `ENABLE ROW LEVEL SECURITY` + a self-access policy. **Important: it is not complete.** It deliberately omits the API-cache tables (`fc_values_cache`, `sleeper_stats_cache`, `cross_league_rosters_cache`) and the entire scouting/reference stack (`prospects`, `route_plays`, `rb_plays`, `qb_plays`, `te_plays`, `recruits`, etc.). Those only ever existed in the numbered migrations. So `schema.sql` alone does **not** reproduce the live database.
- **[supabase/migrations/](supabase/migrations/)** is the *real* chain, numbered `001_…` through `040_…` (with letter-suffixed in-fills like `007b`–`007h` and `008b`). **Apply them strictly in order.** This is the authoritative history; the snapshot file is a convenience.

How they overlap: the user-data tables were originally created by hand in the SQL editor (that became `schema.sql`), then folded into the chain by **[006_consolidate_schema](supabase/migrations/006_consolidate_schema.sql)**, which re-creates all 19 user-data tables with `CREATE TABLE IF NOT EXISTS` so it is a safe no-op where they already exist. A fully reproducible fresh install runs the migrations 001→040 in order; `schema.sql` is best treated as documentation of the user-data subset.

> The legacy `db_setup.sql` (a pre-migration manual bootstrap) is fully superseded by `006_consolidate_schema` and is no longer used. It still sits in the repo root, but ignore it — the numbered migration chain is the source of truth.

### The `applied_migrations` ledger (maintained BY HAND)

This project does **not** use a migration runner. Migrations are pasted into the Supabase SQL editor and run manually. To keep an in-DB record of what has actually been applied, **[037_consensus_index_and_migration_ledger](supabase/migrations/037_consensus_index_and_migration_ledger.sql)** added a `public.applied_migrations` ledger:

```sql
CREATE TABLE IF NOT EXISTS public.applied_migrations (
  migration  TEXT PRIMARY KEY,   -- filename stem, e.g. '037_consensus_index_and_migration_ledger'
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  note       TEXT
);
```

037 seeds the ledger with the full `001…036` history (`applied_at` left NULL, meaning "applied before the ledger existed; exact time unknown") and then records itself with a real timestamp. **The convention going forward is manual:** after you run a new migration, `INSERT` its filename stem. Migrations [038](supabase/migrations/038_league_player_tags_uuid_fk.sql) and [039](supabase/migrations/039_gm_briefings_fk.sql) demonstrate the pattern — each ends with a guarded `INSERT … ON CONFLICT DO NOTHING` that self-records into the ledger (and no-ops if 037 hasn't been applied yet). If you add a migration and forget this step, the ledger silently drifts from reality, so don't.

### Table categories (with examples)

**User content** — one row(s) per Supabase user, never shared:
[notes](supabase/schema.sql#L7), [league_notes](supabase/schema.sql#L21), [league_management](supabase/schema.sql#L36) and [commissioner_payments](supabase/schema.sql#L58) (per-year `paid_YYYY` boolean columns — pre-provisioned out to `paid_2037`), [player_notes](supabase/schema.sql#L174), [player_dispositions](supabase/schema.sql#L189) (legacy buy/sell tags — **orphaned as of Phase 3**: the UI and all reads/writes were removed, the table is intentionally left in place, no `DROP`), [trade_attempts](supabase/schema.sql#L218) (the Trade Hub CRM log), [watchlists](supabase/schema.sql#L92), [alerts](supabase/schema.sql#L110), [league_player_tags](supabase/schema.sql#L358) (Trade Finder `CORE` / `WANT_TO_TRADE` tags — see migration note below), [gm_briefings](supabase/schema.sql#L381) (AI per-team briefings), [big_board_snapshots](supabase/migrations/015_big_board_snapshots.sql), [rookie_board](supabase/schema.sql#L77) + [rookie_board_tiers](supabase/schema.sql#L344) + [rookie_board_overrides](supabase/migrations/017_rookie_board_overrides.sql), [player_value_snapshots](supabase/schema.sql#L206) (the dynasty-value baseline the alerts engine diffs against), [personal_rankings](supabase/migrations/040_personal_rankings.sql) (**migration 040** — one jsonb row per user holding the user's own ordered player board; the gap between this and the consensus board **is** the Trade Finder buy/sell signal, having fully replaced `player_dispositions` in Phases 2–3), [leaguemate_profiles](supabase/schema.sql#L244), and the consensus-draft tables ([consensus_draft_cache](supabase/schema.sql#L134), [consensus_draft_meta](supabase/schema.sql#L152), [consensus_player_grades](supabase/schema.sql#L331)).

**Bookkeeping:** [applied_migrations](supabase/migrations/037_consensus_index_and_migration_ledger.sql) (the manual ledger above).

**Caching** — shared by all users so one upstream fetch serves everyone (defined in **[001_cache_tables](supabase/migrations/001_cache_tables.sql)**, **not** in `schema.sql`): [fc_values_cache](supabase/migrations/001_cache_tables.sql#L10) (FantasyCalc dynasty values keyed by `num_qbs`, 24h TTL), [sleeper_stats_cache](supabase/migrations/001_cache_tables.sql#L20) (weekly player stats, effectively permanent), [cross_league_rosters_cache](supabase/migrations/001_cache_tables.sql#L32) (6h TTL). These three have **RLS *disabled*** (`ALTER TABLE … DISABLE ROW LEVEL SECURITY`) because they are non-PII shared caches — a deliberate exception to the RLS-everywhere rule. The scouting **aggregate views** (`league_route_baselines`, `prospect_route_stats`, `prospect_rb_stats`, etc.) in **[020_scouting_aggregate_views](supabase/migrations/020_scouting_aggregate_views.sql)** push per-snap rollups server-side; they are plain (non-materialized) views created `WITH (security_invoker = on)`.

**Scouting:** [prospects](supabase/migrations/007_scouting_tables.sql#L8), [scouting_games](supabase/migrations/007_scouting_tables.sql#L40), and the per-position play tables. **Heads-up on a naming trap:** there is **no `wr_plays` table** — WR charting plays live in **`route_plays`** (the original table from [007_scouting_tables](supabase/migrations/007_scouting_tables.sql#L60)). The other three are [rb_plays](supabase/migrations/008_rb_tables.sql), [qb_plays](supabase/migrations/009_qb_tables.sql), and [te_plays](supabase/migrations/010_te_tables.sql). `qb_plays` was repeatedly extended (migrations 012, 028, 031–034) for timing/sack/throwaway, tipped-ball accuracy, platform/pressure handling, and touch logging.

**Reference (NFL / recruiting):** [player_nfl_draft_info](supabase/migrations/016_player_nfl_draft_info.sql) (per-user log of where rookies actually landed in the NFL draft) and [recruits](supabase/migrations/018_recruits.sql) + `recruits_meta` (a shared CollegeFootballData cache, plus the `recruits_position_stars_view`).

**Simulator:** [league_simulations](supabase/schema.sql#L259) (per-roster playoff/title odds) and [league_draft_snapshots](supabase/migrations/025_league_draft_snapshots.sql) (named point-in-time saves of a completed Live Draft Board).

**Cron support:** [user_sleeper_links](supabase/migrations/023_user_sleeper_links.sql) (maps a Supabase user → their Sleeper `user_id`; the client upserts it on login so server jobs know which Sleeper account to scan) and [league_transactions_cache](supabase/migrations/024_league_transactions_cache.sql) (per-user transaction feed the cron pre-computes so the dashboard does one `SELECT` instead of fanning out to ~240 Sleeper calls).

### Row Level Security (RLS) — and why the anon key is safe in the browser

The dominant pattern: every user-facing table has RLS **enabled** with a single self-access policy:

```sql
USING      (auth.uid()::text = user_id::text)
WITH CHECK (auth.uid()::text = user_id::text)
```

A user can therefore only ever read or write their own rows. Newer tables whose `user_id` is already a `uuid` use the cleaner cast-free form `auth.uid() = user_id` (see [gm_briefings](supabase/schema.sql#L394), [big_board_snapshots](supabase/migrations/015_big_board_snapshots.sql#L23), [league_draft_snapshots](supabase/migrations/025_league_draft_snapshots.sql#L37)) — functionally identical, just no `::text` coercion.

A couple of tables intentionally break the per-user rule because they hold **shared, non-PII aggregate data**:
- [owner_tendencies](supabase/migrations/006_consolidate_schema.sql#L329): open read **and** write for any authenticated user (`auth.role() = 'authenticated'`), but `DELETE` is hard-blocked by a `USING (false)` policy to prevent vandalism.
- [recruits](supabase/migrations/018_recruits.sql#L34) / `recruits_meta`: open read/write/update (and recruits allows delete) for the refresh-truncate-insert flow.

Because RLS does the access control at the row level, the Supabase **anon key** is safe to ship to the browser. It is read straight from `NEXT_PUBLIC_SUPABASE_ANON_KEY` in [lib/supabaseclient.ts](lib/supabaseclient.ts) — the single client instance the whole frontend shares. The **service-role key** is the opposite: it **bypasses RLS entirely** and is used **only server-side**. The lone consumer today is the cron route, which builds its own client from `SUPABASE_SERVICE_ROLE_KEY` ([app/api/cron/league-transactions/route.ts:264](app/api/cron/league-transactions/route.ts#L264)). It must never reach the browser.

### Two hard conventions for migrations

These are project rules enforced by user preference — violating either is a stop-and-ask situation:

1. **No destructive SQL in migrations.** No `DROP`, `DELETE`, `ALTER … DROP`, or `TRUNCATE` — not even a "safe" `DROP VIEW` — without explicit approval first. This is why the FK-adding migrations [038](supabase/migrations/038_league_player_tags_uuid_fk.sql) and [039](supabase/migrations/039_gm_briefings_fk.sql) are written as *additive, self-checking, all-or-nothing transactions*: 038 validates every `user_id` is a real uuid before converting the column type and rolls back with zero changes if any row fails or an orphan exists; 039 only *adds* the `gm_briefings → auth.users` FK and rolls back (deleting nothing) if orphan rows exist. Both files literally tell you to take a backup first.
2. **Every new `public` table must ship explicit `GRANT`s.** Each new table needs `GRANT … TO authenticated` (typically `SELECT`, or the specific verbs RLS will then narrow) **and** `GRANT ALL TO service_role`, plus an RLS policy. The reason: **Supabase removes implicit default grants on new objects as of Oct 30, 2026**, so anything relying on the old implicit grants would silently lose access. Migration [037](supabase/migrations/037_consensus_index_and_migration_ledger.sql#L44) is the model — it spells out `GRANT SELECT … TO authenticated` and `GRANT ALL … TO service_role` on `applied_migrations`. (Note: most tables created *before* this convention was adopted do not carry explicit grants in their migration files; the rule binds new tables going forward.)

### Backups (manual weekly `pg_dump`)

There is **no automated backup** — intentionally, given the ~5-user scale. Backups are run by hand:

- **[scripts/backup-supabase.bat](scripts/backup-supabase.bat)** — double-click this. It just calls the PowerShell script with `-ExecutionPolicy Bypass` so there's no one-time setup prompt.
- **[scripts/backup-supabase.ps1](scripts/backup-supabase.ps1)** — parses `SUPABASE_DB_URL` out of `.env.local`, then runs `pg_dump --schema=public --no-owner --no-privileges` into a timestamped file.

Requirements: `pg_dump` at `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` (edit `$pgDump` in the script if installed elsewhere) and `SUPABASE_DB_URL` set in `.env.local`. Dumps land in `C:\Users\bstefely.NPCSEALANTS\Documents\DynastyZeus Backups\` as `dz-YYYY-MM-DD-HHmm.sql`.

To restore:

```
psql "<SUPABASE_DB_URL>" -f dz-YYYY-MM-DD-HHmm.sql
```

Note the dump uses `--no-owner --no-privileges`, so a restore re-creates the table data/structure but **not** the GRANTs or ownership — you would re-establish those by re-running the relevant migrations' grant statements if restoring into a clean project.

---

## 16. Server-side, Cron, Deployment, Security & Observability

This section covers everything that runs *outside the browser*: the single Vercel cron, how the app deploys, the full HTTP security model, how to see what production is doing, and the calendar-vs-season-year handling that bites at the Jan/Feb boundary. It ends with the canonical environment-variable table.

> Scale context: this is a ~5-user, single-owner app. Almost every "why is it this simple?" answer is "because 5 users." That justifies manual backups, eyeball-the-logs observability, and one cron.

### Cron jobs (Vercel)

There is exactly **one** cron, declared in [vercel.json](vercel.json):

```json
{ "path": "/api/cron/league-transactions", "schedule": "0 */2 * * *" }
```

So it fires **every 2 hours, on the hour**. Cron schedules in `vercel.json` are picked up automatically on deploy, but **only on the Vercel Pro plan** — on Hobby they are silently ignored.

**What it does** — [app/api/cron/league-transactions/route.ts](app/api/cron/league-transactions/route.ts):

1. **Auth gate.** It reads `CRON_SECRET` from the environment. If the var is missing it logs an error and returns **500** ("CRON_SECRET not configured") — it refuses to run open. Otherwise it compares the incoming `Authorization` header against the literal string `Bearer ${CRON_SECRET}` using Node's [`timingSafeEqual`](app/api/cron/league-transactions/route.ts#L259) (constant-time, length-guarded first so it can't throw) — a mismatch is **401**. Vercel injects this header automatically when it invokes the cron; to trigger it by hand you must send `Authorization: Bearer <CRON_SECRET>` yourself.
2. **Service-role Supabase client.** It builds a `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })`. The service-role key **bypasses RLS** — required because the cron writes rows *on behalf of every user*. Missing either var → **500** ("Server misconfiguration").
3. **Reads `user_sleeper_links`** (`user_id`, `sleeper_user_id`) — the Supabase-account → Sleeper-user mapping. For each link it [`processUser`](app/api/cron/league-transactions/route.ts#L104)s: fetch that Sleeper user's dynasty leagues for `CURRENT_YEAR`, fan out (concurrency capped at **5**) to pull the last **4 weeks** of transactions plus users/rosters/drafts per league, annotate each completed transaction (leagueName, leagueId, `rosterOwnerMap`, draft-pick slot strings), keep the freshest **200** per user, and **upsert** into `league_transactions_cache` with `onConflict: "user_id,transaction_id"` so re-runs replace evolving rows.
4. **`maxDuration = 300`** ([line 43](app/api/cron/league-transactions/route.ts#L43)) — up to 5 minutes per invocation, again a Pro-tier allowance.

This replaced a client-side effect that fanned out ~240 Sleeper calls per cold session for a 34-league user. The frontend now reads the pre-built feed from one Supabase query.

#### The RETIRED leaguemate-alerts cron

An earlier `/api/cron/leaguemate-alerts` cron wrote one row per leaguemate trade into the `alerts` table (id prefixed `trade-`), which the Alerts feed rendered as "X made a trade." It was retired because the same trades already show under the Trades tab (now backed by the cache above), so it was pure noise. The retirement is **complete on three fronts**:

- The **route file is gone** — `app/api/cron/` contains only `league-transactions/`.
- The **schedule is gone** from [vercel.json](vercel.json) (only the one cron remains).
- A **client-side guard remains** in [hooks/useAlerts.ts](hooks/useAlerts.ts#L122): the alerts query appends `.not("alert_id", "like", "trade-%")`, so any leftover `trade-*` rows still physically present in the `alerts` table are filtered out of the feed. (No migration deletes them — per the project's no-destructive-SQL rule — they're just never read.)

> Note: the live cron's source comment still references "leaguemate-alerts" as the pattern it mirrors (auth + idempotency). That's a historical comment, not a live route.

### Deployment (Vercel)

- **`main` auto-deploys to production on push.** There is no separate release step — merging/pushing to `main` *is* the deploy. (Per project convention, feature-branch pushes are **not** live; you must land on `main`.)
- **Any other branch / PR gets a preview deployment** with its own URL.
- **CI runs before merge** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) on every push and PR to `main`: `npm run lint` → `npm run build` → `npx tsc --noEmit` → `npm run test`. The build step injects **placeholder** Supabase env values (`https://placeholder.supabase.co` / `placeholder-anon-key`) purely to satisfy Next at build time; real values are injected by Vercel at runtime.
- **Order matters for type-check:** `tsc` runs *after* `build` because the build regenerates `.next/types/` route types. Running `tsc` first will fail with missing route types.
- **Smoke-test locally before pushing** with `npm run build` (production build must succeed) — this is the same gate CI enforces.
- **Vercel env vars** are set in **Project Settings → Environment Variables** (Production + Preview scopes); they mirror `.env.local`.

### Security model (HTTP headers)

All defined in [next.config.ts](next.config.ts), applied to **every** route (`source: "/(.*)"`):

- **`Content-Security-Policy`** (the important one):
  - `default-src 'self'` — block everything by default.
  - `script-src 'self' 'unsafe-inline'` — **`'unsafe-eval'` is appended DEV-ONLY** (`isDev` is `process.env.NODE_ENV === "development"`). React's dev build uses `eval()` for stack traces; production drops it, so prod never ships `unsafe-eval`. (`'unsafe-inline'` for scripts/styles is required by Tailwind v4's inlined critical styles.)
  - `style-src 'self' 'unsafe-inline'`, `font-src 'self'`.
  - **`img-src`** allowlist: `'self' data:` + `sleepercdn.com`, `a.espncdn.com`, `static.www.nfl.com`, `images.unsplash.com`, `images.pexels.com`.
  - **`connect-src`** allowlist: `'self'` + `api.sleeper.app`, `www.fantasycalc.com`, `api.fantasycalc.com`, `*.supabase.co`.
  - **`frame-ancestors 'none'`** — the app cannot be iframed.
- **`X-Frame-Options: DENY`** — same intent, older header.
- **`X-Content-Type-Options: nosniff`**, **`Referrer-Policy: strict-origin-when-cross-origin`**.
- **`Strict-Transport-Security: max-age=31536000; includeSubDomains`** — force HTTPS for a year (no-op over plain HTTP in local dev).
- **`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`** — denies features the app never uses.

> **CRITICAL RULE — a new image host needs TWO edits.** To load images from a new host you must add it to **BOTH** the CSP `img-src` directive **AND** [`images.remotePatterns`](next.config.ts#L15) in `next.config.ts`. `remotePatterns` lets the Next image optimizer fetch it; CSP lets the browser render it. Add only one and images break (silently or via a CSP console error). The two lists must stay in lock-step.

There is also one **caching** header: `/api/projections/:path*` gets `Cache-Control: s-maxage=300, stale-while-revalidate=60` (5-min edge cache for FantasyPros/numberFire projection data).

Separately, API routes enforce **per-IP rate limiting** via [lib/rateLimit.ts](lib/rateLimit.ts) — Upstash Redis (distributed) in production, falling back to an in-process map when the Upstash vars are absent.

### Observability

Full detail in [OBSERVABILITY.md](OBSERVABILITY.md). The model is deliberately free-tier:

- All server + client logging goes through [lib/logger.ts](lib/logger.ts). `logger("some/context")` returns `{ debug, info, warn, error }`. **In production** each call emits **one JSON line** — `{ ts, level, context, msg, ...extra }` — via the matching `console` method (so `error → console.error`, etc., preserving severity; `debug` maps to `console.log`). **In development** it prints colour-coded `[context] msg`. It **never throws** (the emit is wrapped in try/catch) so logging can't crash a request.
- On Vercel, those lines land in **Project → Logs (Runtime Logs)**, included in the plan. Because every line is tagged with `level` and `context`, you can filter e.g. `"level":"error"` or `"context":"cron/league-transactions"`. The cron logs upsert failures, link-read failures, and per-user throws at `error` level.
- **No external alerting is wired** — by design. The one real gap is short retention + no "email me when errors spike." `OBSERVABILITY.md` documents the optional **paid** upgrade path (a Vercel **Log Drain** to BetterStack/Logflare/Datadog needs zero code change since the lines are already structured JSON; or **Sentry** via `@sentry/nextjs`). Left off until the single-owner scale outgrows eyeballing the logs.

### Season / year handling & the payment-year "time bomb"

Documented in [SEASON_ROLLOVER.md](SEASON_ROLLOVER.md); the single source of truth is [lib/helpers/season.ts](lib/helpers/season.ts). Two distinct "year" concepts that must not be conflated:

- **Calendar year** — `BASE_YEAR = new Date().getFullYear()`, rolls over **Jan 1**. Anchors the rookie-draft *class* year and the class/film dropdowns (`CLASS_YEARS`, `FILM_YEARS`) — forward-looking things where, in Jan/Feb, you want the *upcoming* class.
- **NFL season year** — `CURRENT_YEAR = String(calendarSeasonYear())`. [`calendarSeasonYear`](lib/helpers/season.ts#L23) treats **Jan/Feb (`getMonth() <= 1`) as the PRIOR season** (`y - 1`), so it rolls over in ~March (new league year), **not** Jan 1. Drives league lookups, pick-year windows, and trade-finder pick classification. Where Sleeper's live `/state/nfl` is available, prefer [`getSeasonYear(nflState)`](lib/helpers/season.ts#L35) — it returns `nflState.season` when it's a 4-digit string (authoritative at the exact rollover edge), else falls back to `CURRENT_YEAR`. The cron uses `CURRENT_YEAR` for its league lookups.

So from Jan 1 to ~March, calendar year is already `N+1` while season year is still `N`. Pick the right concept for any new year-sensitive feature.

**The payment-year time bomb.** Dues are tracked with one BOOLEAN column per year (`paid_<year>`) on `league_management` and `commissioner_payments`. [`getPaymentYears()`](lib/constants.ts#L110) generates a `[currentYear - 1 … currentYear + 3]` window (calendar year, by design), so the **highest column the app will ever write is `currentYear + 3`**. If that column doesn't exist in the DB, every save fails with a generic error.

- Migration 002 originally provisioned columns through `paid_2033`.
- [Migration 036](supabase/migrations/036_extend_payment_years_2034_2037.sql) added `paid_2034`–`paid_2037` (purely additive `ADD COLUMN IF NOT EXISTS`, idempotent, no destructive SQL) and [lib/constants.ts](lib/constants.ts#L101) bumped `MAX_PROVISIONED_PAYMENT_YEAR = 2037`. This is safe through **calendar year 2034** (when `currentYear + 3` first hits 2037).
- There's a built-in tripwire: `getPaymentYears()` `console.warn`s once when `currentYear + 3` reaches/exceeds the ceiling, telling you to add the next migration (template: copy 036, bump four years, bump the constant). **Action item ~Jan 1 2035.**

---

## 17. Dev workflow: build, lint, test

All day-to-day work runs through the npm scripts in [package.json](package.json#L8). There is no custom build tooling — it is stock Next.js 16 + Vitest 4.

```bash
npm install        # restore node_modules (Node 20+ required; CI uses Node 22)
npm run dev        # next dev — local server on http://localhost:3000
npm run build      # next build — production bundle; MUST succeed before deploy
npm run start      # next start — serve the production build locally
npm run lint       # eslint (flat config, see below)
npm run test       # vitest run — one-shot, headless
npm run test:watch # vitest — watch mode
```

Note there is **no `typecheck` script**. The project type-checks with a bare `npx tsc --noEmit` (this is exactly what CI does — see below). `tsconfig.json` sets `noEmit: true`, so `tsc` only validates; it never produces output.

### The two environment gotchas that will waste your first hour

**1. Run Vitest through PowerShell, not Git Bash.** On this Windows machine, `npm run test` works fine in PowerShell but fails under Git Bash: Vitest 4 cannot locate its runner (`Vitest failed to find the runner` / "Cannot read properties of undefined (reading 'config')") and **silently collects 0 tests**. A green "0 tests" is the failure mode — you think you passed when you ran nothing. This is an environment quirk, not a test problem. Verified: running `npx vitest run` in PowerShell yields **526 passing tests across 22 files**. (Confirmed in [memory: project_audit_remediation_progress.md](C:/Users/bstefely.NPCSEALANTS/.claude/projects/c--Users-bstefely-NPCSEALANTS-dynastyzeus-app/memory/project_audit_remediation_progress.md): "run vitest via PowerShell (Vitest 4 breaks under Git Bash here).")

**2. Run `tsc` AFTER `next build`, never before.** Next.js generates typed route definitions during the build step at [.next/types/routes.d.ts](.next/types/routes.d.ts), and `tsconfig.json` includes `.next/types/**/*.ts` in its compilation. If you run `npx tsc --noEmit` on a clean checkout (no `.next/`), it fails with missing route types. The fix is always: `npm run build` first, then type-check. CI enforces this ordering by design (see [memory: project_ci_gotchas.md](C:/Users/bstefely.NPCSEALANTS/.claude/projects/c--Users-bstefely-NPCSEALANTS-dynastyzeus-app/memory/project_ci_gotchas.md)).

## 18. CI pipeline (GitHub Actions)

CI lives in [.github/workflows/ci.yml](.github/workflows/ci.yml) and runs on every push and PR to `main`. It is a single job, `Lint, Type-check & Build`, on `ubuntu-latest` / Node 22, and the **step order is load-bearing**:

1. `npm ci`
2. **Lint** — `npm run lint` (with `NODE_OPTIONS=--max-old-space-size=4096`)
3. **Build** — `npm run build` (with placeholder `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`; real values come from Vercel at runtime, not build time)
4. **Type-check** — `npx tsc --noEmit` (runs *after* build so `routes.d.ts` exists — see gotcha #2 above)
5. **Test** — `npm run test`

If you reproduce CI locally, run those five in the same order. Vercel deploys are separate from this workflow: `main` auto-deploys to production on push regardless of CI status (CI is a quality gate on the PR, not a deploy gate).

## 19. ESLint & TypeScript rules that bite

The flat config in [eslint.config.mjs](eslint.config.mjs) is minimal: it just spreads `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. All the strict behavior comes from those presets, not from local overrides. I verified each rule's *actual severity* empirically by running ESLint against a deliberately-violating probe file. Results:

| Rule | Severity | Fails `npm run lint` / CI? | How to fix |
|---|---|---|---|
| `react-hooks/set-state-in-effect` | **error** | yes | Don't call `setState` synchronously in a `useEffect` body |
| `@typescript-eslint/no-explicit-any` | **error** | yes | Type it properly; use a local alias or `unknown` |
| `react/no-unescaped-entities` | **error** | yes | Escape `'` as `&apos;` / `&#39;` in JSX text |
| `prefer-const` | **error** | yes | Use `const` for never-reassigned bindings |
| `react-hooks/exhaustive-deps` | **warning** | **NO** | Add the missing dep, or justify the gap |

> **Heads-up on `react-hooks/exhaustive-deps`:** contrary to a common assumption, with the current `eslint-config-next@16.2.1` it is a **warning**, not an error, and exits 0 — a missing-dependency warning alone will NOT fail `npm run lint` or CI (verified: probe file with only an `exhaustive-deps` warning exited 0). Treat it as a strong code-smell to fix, but know it is not a hard gate. The four rules above *are* hard errors that fail CI.

Beyond ESLint, TypeScript is strict at the `tsc` step. `tsconfig.json` enables `strict`, plus `noUnusedLocals` and `noUnusedParameters` — so an unused import, variable, or function parameter is a **build/type-check failure**, not a warning. This is the single most common reason a local edit that "looks fine" red-X's in CI.

## 20. Test suite scope (526 tests, 22 files)

Run via PowerShell. The suite is [Vitest](vitest.config.mts) in a `jsdom` environment, globbing `**/__tests__/**/*.{ts,tsx}` and `**/*.{test,spec}.{ts,tsx}`. It deliberately covers **pure logic and server routes, not UI rendering** — there are no component-render or e2e tests.

The four "hard cores" — the high-value, previously-untested paths that were given coverage during the June remediation — are:

- **Finder pipeline** — [__tests__/components/tradeHub/finderPipeline.test.ts](__tests__/components/tradeHub/finderPipeline.test.ts) (plus [FinderScoring.test.ts](__tests__/components/tradeHub/FinderScoring.test.ts) and the direction sub-tests in [__tests__/lib/helpers/direction/](__tests__/lib/helpers/direction/)).
- **QB AAE model** (above-average-expected) — [__tests__/lib/scouting/aboveExpected.test.ts](__tests__/lib/scouting/aboveExpected.test.ts).
- **Consensus compiler** — [__tests__/app/api/compileConsensus.test.ts](__tests__/app/api/compileConsensus.test.ts).
- **League-transactions cron** — [__tests__/app/api/cron/league-transactions.test.ts](__tests__/app/api/cron/league-transactions.test.ts) (covers the `CRON_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` auth-and-env guards and the per-user upsert pipeline).

The remaining files cover helpers (math, scoring, lineup, picks, season, formatting), the trade calculator, the scouting rank-reorder helper ([rankReorder.test.ts](__tests__/lib/scouting/rankReorder.test.ts)), `withRetry`, the env guard, and the `useLocalStorage` hook. When the suite runs you'll see expected `stderr` lines (e.g. "CRON_SECRET env var is not set", "quota exceeded — write skipped") — those are tests deliberately exercising error branches, not failures.

## 21. Common failure modes & where to look

| Symptom | First place to check |
|---|---|
| App white-screens entirely | Browser console + [components/ErrorBoundary.tsx](components/ErrorBoundary.tsx) — a child threw; the boundary should catch and show a fallback. |
| Images won't load | [next.config.ts](next.config.ts#L49): the CSP `img-src` allowlist (`sleepercdn.com`, `a.espncdn.com`, `static.www.nfl.com`, `images.unsplash.com`, `images.pexels.com`) **and** `images.remotePatterns` ([line 15](next.config.ts#L15)) must *both* include the host. |
| Sleeper calls return 429 / fail | The proxy routes under [app/api/sleeper/](app/api/sleeper/) (`draft`, `league`, `user`, `user-leagues`) and the limiter in [lib/rateLimit.ts](lib/rateLimit.ts) (Upstash Redis). Sleeper data is also localStorage-TTL-cached client-side. |
| Supabase reads come back empty | RLS / `auth.uid()` mismatch — the row's `user_id` must equal the authenticated user. Re-check the Supabase session. |
| Cron didn't run | Vercel dashboard → Project → **Cron** tab (requires Vercel Pro). The route at [app/api/cron/league-transactions/route.ts](app/api/cron/league-transactions/route.ts#L247) refuses to run unless `CRON_SECRET` is set and the `Authorization: Bearer` header matches; it also needs `SUPABASE_SERVICE_ROLE_KEY`. |
| `tsc` fails with missing route types | You ran it before `next build`. Run `npm run build` first (regenerates `.next/types/routes.d.ts`). |
| Stale FantasyCalc values | [app/api/fc-values/route.ts](app/api/fc-values/route.ts) — check the upstream + the edge cache. |
| Build/type-check fails on `noUnusedLocals` / `noUnusedParameters` | Remove the unused import, variable, or parameter. TS strictness is intentional. |
| Vitest reports "0 tests" or runner error | You're in Git Bash. Re-run in **PowerShell**. |
| Lint passes locally but CI red-X's | You likely have only `exhaustive-deps` warnings locally (those don't fail), but a real error (`no-explicit-any`, `no-unescaped-entities`, `set-state-in-effect`, `prefer-const`) or a `tsc` `noUnusedLocals` violation surfaced in CI. |

## 22. Things intentionally NOT done (and why)

- **No automated DB backup pipeline.** With ~5 users, a manual weekly `pg_dump` suffices ([scripts/backup-supabase.bat](scripts/backup-supabase.bat); see [memory: project_supabase_backup.md](C:/Users/bstefely.NPCSEALANTS/.claude/projects/c--Users-bstefely-NPCSEALANTS-dynastyzeus-app/memory/project_supabase_backup.md)).
- **No e2e tests (Playwright/Cypress) and no component-render tests.** Vitest covers pure logic and server routes; UI is hand-tested.
- **No internationalization.** English only.
- **No full router rebuild for hub/tab nav.** Phase B added deep-linkable `?hub=&tab=` URL sync with real back/forward via the raw History API ([app/hooks/useHubRouting.ts](app/hooks/useHubRouting.ts)) rather than migrating to per-hub file routes — deliberately the "lightweight scope" option from the audit, not a rewrite of the single-route SPA model.
- **AI integration removed.** An earlier build used Anthropic's API to auto-summarize scouting notes; that path was removed (and dropped from `.env.example`) and replaced with a plain play-notes list. There is no LLM call anywhere in the app today.
- **No leaguemate-trade alerts feed.** A prior cron wrote one `alerts` row per league-wide trade; it was pure noise (the same trades already appear under the Trades tab) and was removed. See [memory: project_leaguemate_alerts_server_side_april28.md](C:/Users/bstefely.NPCSEALANTS/.claude/projects/c--Users-bstefely-NPCSEALANTS-dynastyzeus-app/memory/project_leaguemate_alerts_server_side_april28.md) for the history.

## 23. Known open items & time bombs for the next owner

The June 2 2026 audit produced 85 findings ([memory: project_full_audit_june2.md](C:/Users/bstefely.NPCSEALANTS/.claude/projects/c--Users-bstefely-NPCSEALANTS-dynastyzeus-app/memory/project_full_audit_june2.md)). **Most were closed in the June 3 remediation** — I verified the following against current code, so the new owner should NOT treat them as open:

- *Loader error states* — **done.** Imperative loaders now expose an error flag (e.g. [hooks/useUserExposure.ts:19](hooks/useUserExposure.ts#L19) documents the non-null-on-failure flag so the UI can show error+retry instead of a blank panel; [hooks/useCalcValues.ts](hooks/useCalcValues.ts), [hooks/useUserTrades.ts](hooks/useUserTrades.ts), [hooks/useLeagueOverview.ts](hooks/useLeagueOverview.ts) follow the same pattern).
- *Confirm-before-delete on destructive UI* — **done.** `window.confirm` now guards charting-game delete ([components/scouting/shared/ChartingBoard.tsx:325](components/scouting/shared/ChartingBoard.tsx#L325)) and trade-attempt delete ([components/tradeHub/TradeAttempts.tsx:420](components/tradeHub/TradeAttempts.tsx#L420)), among others.
- *Live Draft Board polling* — **done.** [app/hooks/useAppState.ts:617](app/hooks/useAppState.ts#L617) now polls via `setInterval(() => refreshDraftBoard(), POLL_MS)` while a draft is active.
- *Payment-year time bomb* — **mitigated.** Columns are provisioned through `paid_2037` via [supabase/migrations/036_extend_payment_years_2034_2037.sql](supabase/migrations/036_extend_payment_years_2034_2037.sql), and [lib/constants.ts:101](lib/constants.ts#L101) defines `MAX_PROVISIONED_PAYMENT_YEAR = 2037` with a one-time console warning ([line 117](lib/constants.ts#L117)) when the league approaches/exceeds the ceiling. It will need a new additive migration + a bump of that constant before Jan 1 2038.

**Genuinely still open — both deferred by explicit user decision (per [memory: project_audit_remediation_progress.md](C:/Users/bstefely.NPCSEALANTS/.claude/projects/c--Users-bstefely-NPCSEALANTS-dynastyzeus-app/memory/project_audit_remediation_progress.md)), revisit only if asked):**

1. **`useAppState` is a 3,631-line god-hook.** [app/hooks/useAppState.ts](app/hooks/useAppState.ts) still holds the trade/draft/sim engines inline. Extracting those engines into separate modules was an audit "Modify" item; it works fine as-is, so it was left alone.
2. **`paid_YYYY` is a wide-column design, not normalized.** Payments live as one boolean column per year on the league/roster table rather than a child `payments` table. Normalizing it was an audit "Modify" item; deferred. The mitigation above keeps it from breaking, but every future season still requires schema growth.

Other lower-priority items the audit flagged that I did not re-verify line-by-line (treat as "probably still open, confirm before acting"): deriving `numQbs`/team-count from `selectedLeague` instead of hardcoded superflex assumptions; memoizing context-provider values; and consolidating duplicated tuning constants. None are correctness time bombs.

## 24. First-day checklist for a new developer

1. Install **Node 20+** (CI uses Node 22) and clone the repo.
2. Get `.env.local` from the project owner (`cp .env.example .env.local`, then fill in the values — Supabase URL/anon key, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, Upstash, `SUPABASE_DB_URL`).
3. `npm install`.
4. `npm run dev` → confirm the app loads at `http://localhost:3000`.
5. `npm run build` → confirm a production build succeeds (also generates `.next/types/` so the next step works).
6. `npx tsc --noEmit` → confirm type-check passes (run it *after* the build).
7. **In PowerShell** (not Git Bash): `npm run test` → confirm **526 tests pass** across 22 files. If you see "0 tests," you're in the wrong shell.
8. `npm run lint` → confirm clean (remember `exhaustive-deps` warnings won't fail it; the four error rules will).
9. Read [AGENTS.md](AGENTS.md) — it warns this Next.js version diverges from public docs; consult `node_modules/next/dist/docs/` before writing framework code.
10. Walk the entry path: [app/page.tsx](app/page.tsx) → [app/hooks/useAppState.ts](app/hooks/useAppState.ts) → [app/components/HubRouter.tsx](app/components/HubRouter.tsx).
11. Skim [supabase/migrations/](supabase/migrations/) (currently through `039`) to understand the data model's evolution.

---

## Maintaining this document

This file drifts the moment the architecture moves. When you change any of the following, update both the code **and** the relevant section here:

- **CSP / image allowlist** — a new image host needs edits in *two* places in [next.config.ts](next.config.ts) (the CSP `img-src` directive **and** `images.remotePatterns`).
- **Environment variables** — keep the env table and [.env.example](.env.example) in sync.
- **Cron schedule** — [vercel.json](vercel.json) is the source of truth; note that an in-code comment in `useAppState.ts` still says "every 30 min" while the schedule is every 2h.
- **Database migrations** — every new migration is additive, ships explicit GRANTs + an RLS policy, and gets a row in the `applied_migrations` ledger.
- **The Trade Finder scoring model** — magic constants in [finderPipeline.ts](components/tradeHub/finderPipeline.ts) and the direction engine are deliberately tuned; document any change to a weight or gate.

*Generated for handoff purposes — treat it as a living document, not a frozen snapshot.*
