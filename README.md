# DynastyZeus

A single-owner Sleeper fantasy-football command center: dynasty/redraft value
rankings, a trade calculator and trade finder, a season simulator, scouting
charts (QB/RB/WR/TE), a rookie draft board with network consensus, league
management, and leaguemate intel — all driven from your connected Sleeper
account.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:3000
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev`   | Start the dev server (Turbopack) |
| `npm run build` | Production build (also runs the TypeScript check) |
| `npm run test`  | Run the Vitest suite |
| `npm run lint`  | Run ESLint |

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript 5 · Tailwind CSS v4 ·
Supabase (Postgres + Auth + RLS) · Upstash Redis (rate limiting) · Vercel
(hosting + cron).

## Environment

Copy `.env.example` → `.env.local` and fill it in. Only the Supabase
credentials are required for core functionality; Upstash and `CRON_SECRET` are
for production rate-limiting and scheduled jobs. All external data sources
(Sleeper, FantasyCalc, FantasyPros, ESPN, Google Sheets) are public APIs that
need no keys.

## Database

Apply the migrations in [`supabase/migrations/`](supabase/migrations/) in
numeric order via the Supabase SQL editor (or `supabase db push`).
[`supabase/schema.sql`](supabase/schema.sql) is a full snapshot for reference /
disaster recovery — the migration chain is the source of truth.

## More docs

- [`HANDOFF.md`](HANDOFF.md) — architecture overview, tech stack, and file layout.
- [`AGENTS.md`](AGENTS.md) — contributor notes, including the Next.js 16 API
  differences to be aware of before writing code.
