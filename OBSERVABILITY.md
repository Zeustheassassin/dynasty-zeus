# Observability / logging

How to see what the app is doing in production — and what it would cost to add
alerting. **No paid service is wired up** (deliberately, to avoid recurring cost).

## What exists today (free)

All server + client logging goes through the structured logger in
[`lib/logger.ts`](lib/logger.ts):

```ts
import { logger } from "@/lib/logger";
const log = logger("api/cron/league-transactions");
log.error("upstream fetch failed", { status: res.status });
```

- **In production** it emits one **JSON line per event** (`{ ts, level, context, msg, …extra }`)
  via the matching `console` method — `error → console.error`, `warn → console.warn`,
  etc. — so each record carries its severity.
- **In development** it prints colour-coded `[context] msg` lines.
- It **never throws** — logging can't crash a request.

### Where the logs land (no setup, no cost)

On Vercel, anything an API route / serverless function writes to stdout/stderr is
captured in **Vercel → your project → Logs (Runtime Logs)**, included in the plan
you already pay for. So production errors are **not invisible** — they're queryable
there. Because the logger tags each line with `level` and `context`, you can filter
e.g. `level":"error"` or `context":"api/cron`.

Practical tips:
- Cron failures: filter the Logs view to the cron route paths
  (`/api/cron/league-transactions`, `/api/cron/leaguemate-alerts`).
- Every server route already logs failures at `error` level (e.g. the crons,
  `compile-consensus`), so an `error`-level filter surfaces real problems.

### The one real limitation

Vercel's built-in runtime logs have **short retention** and **no alerting** — you
have to go look. There is no aggregation/search-over-time or "email me when errors
spike" without an external sink. That is the gap the June-2 audit flagged.

## Optional upgrade (costs money — not enabled)

If/when you want retention + alerting, the lowest-friction options:

| Option | Cost | Effort |
|---|---|---|
| **Vercel Log Drain** → a sink (BetterStack/Logflare/Datadog) | sink has a free tier; grows with volume | Configure a drain in Vercel project settings; no code change (JSON lines already structured). |
| **Sentry** (`@sentry/nextjs`) | free tier (5k errors/mo), then paid | Add the SDK + DSN; capture in the logger's `error` path. |

Because the logger already emits structured JSON keyed by `level`/`context`, adding
any of these is a configuration/integration step, not a refactor. **Left off by
design** — revisit only if the single-owner scale outgrows eyeballing Vercel logs.
