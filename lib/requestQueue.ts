// Pure, dependency-free request queue — safe to import from client code.
//
// One instance fronts every browser Sleeper call (lib/sleeperApi.ts's `sleeperRequestQueue`). It
// bounds three things the per-caller `withConcurrency` caps can't, because those only see their
// own fan-out:
//   - in flight: at most `maxInFlight` requests open at once, across every hook and tab panel;
//   - rate: a token bucket — `burst` requests can go back to back, then `refillPerSec` a second;
//   - back-off: `pauseFor(ms)` holds everything still waiting (a 429's Retry-After), since the
//     server answers every Sleeper route from one per-IP bucket — a 429 on one is a 429 on all.
//
// Strictly FIFO: a request that arrives while others are waiting goes behind them, so one big
// fan-out can delay everything queued after it. That is why the bulk loaders (Leaguemates,
// Draft History, Refresh Rosters) still cap themselves with withConcurrency — the queue
// rations the rate; the caps keep any one caller from filling the line.

export interface RequestQueueOptions {
  /** Most requests open at once. */
  maxInFlight: number;
  /** Bucket size — how many requests may start back to back from idle. */
  burst: number;
  /** Sustained rate once the bucket is empty, in requests per second. */
  refillPerSec: number;
}

export interface RequestQueueStats {
  inFlight: number;
  waiting: number;
  /** Whole tokens left in the bucket right now. */
  tokens: number;
  /** Epoch ms the current pause ends; 0 or a past time when not paused. */
  pausedUntil: number;
}

export interface RequestQueue {
  /** Runs `task` once a slot and a token are free, in arrival order. The slot is held until
   *  `task` settles, so it should cover reading the body too, not just the response headers. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Holds every waiting and future request for `ms` (extends, never shortens, a pause already
   *  running). Requests already in flight are not affected. */
  pauseFor(ms: number): void;
  stats(): RequestQueueStats;
}

export function createRequestQueue(opts: RequestQueueOptions): RequestQueue {
  const maxInFlight = Math.max(1, Math.floor(opts.maxInFlight) || 1);
  const burst = Math.max(1, opts.burst);
  const refillPerSec = Math.max(0.001, opts.refillPerSec);

  const waiting: Array<() => void> = [];
  let inFlight = 0;
  let tokens = burst;
  let refilledAt = Date.now();
  let pausedUntil = 0;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;

  const refill = (now: number) => {
    tokens = Math.min(burst, tokens + ((now - refilledAt) / 1000) * refillPerSec);
    refilledAt = now;
  };

  // One pending wake-up at a time. If it fires early (a pause was extended after it was set),
  // pump() just re-arms it for the new time.
  const wakeIn = (ms: number) => {
    if (wakeTimer !== null) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      pump();
    }, Math.max(0, Math.ceil(ms)));
  };

  function pump(): void {
    while (waiting.length > 0 && inFlight < maxInFlight) {
      const now = Date.now();
      if (now < pausedUntil) {
        wakeIn(pausedUntil - now);
        return;
      }
      refill(now);
      if (tokens < 1) {
        wakeIn(((1 - tokens) / refillPerSec) * 1000);
        return;
      }
      tokens -= 1;
      inFlight++;
      waiting.shift()!();
    }
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        pump();
      });
      try {
        return await task();
      } finally {
        inFlight--;
        pump();
      }
    },

    pauseFor(ms: number): void {
      pausedUntil = Math.max(pausedUntil, Date.now() + Math.max(0, ms));
    },

    stats(): RequestQueueStats {
      refill(Date.now());
      return { inFlight, waiting: waiting.length, tokens: Math.floor(tokens), pausedUntil };
    },
  };
}
