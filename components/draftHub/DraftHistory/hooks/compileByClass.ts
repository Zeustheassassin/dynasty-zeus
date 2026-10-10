// ============================================================
// Consensus compile — one draft class per request
// ============================================================
// Every Sleeper call a compile makes is paced at COMPILE_TARGET_RPM (450/min,
// lib/constants.ts), and a recent class alone is ~4,000 calls — ~9 minutes of
// the route's 800s limit. Several classes in one request would run out of time
// and come back partial (the route keeps a class's previous compile when its
// picks fetch is cut off), so the panel sends them one at a time, in order.
// ============================================================

/** One NDJSON line from /api/compile-consensus. */
export interface CompileEvent {
  type: "status" | "done" | "error" | "year_done" | string;
  message?: string;
  progress?: number;
  year?: number;
  draftCount?: number;
  leagueCount?: number;
  playerCount?: number;
  connectedUserCount?: number;
}

export interface CompileByClassOptions {
  years: number[];
  sleeperUserId: string;
  /** Read per class — a run of several classes can outlive one access token. */
  getAccessToken: () => Promise<string | null>;
  onLog: (message: string) => void;
  /** Overall progress across every class, 0-100. */
  onProgress: (progress: number) => void;
  /** Each class's `year_done`, as the route sends it. */
  onYearDone: (event: CompileEvent) => void;
  fetchImpl?: typeof fetch;
}

/** Compiles each class in its own request, oldest first. Stops (with a message
 *  naming the classes not yet compiled) on a rate limit or a failed request. */
export async function compileByClass(opts: CompileByClassOptions): Promise<void> {
  const { sleeperUserId, getAccessToken, onLog, onProgress, onYearDone } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const years = [...opts.years].sort((a, b) => a - b);
  const multi = years.length > 1;

  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const remaining = years.slice(i).join(", ");
    const prefix = multi ? `${year} (${i + 1}/${years.length}): ` : "";
    const overall = (p: number) => Math.round(((i + Math.min(100, Math.max(0, p)) / 100) / years.length) * 100);

    const accessToken = await getAccessToken();
    if (!accessToken) {
      onLog(`Your session expired — log in again, then compile ${remaining}.`);
      return;
    }

    let res: Response;
    try {
      res = await doFetch("/api/compile-consensus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleeperUserId, accessToken, years: [year] }),
      });
    } catch (err) {
      onLog(`Error: ${(err as Error)?.message ?? "Unknown error"}`);
      return;
    }

    if (res.status === 429) {
      onLog(`Compile limit reached (5 per 10 minutes). Wait a few minutes, then compile ${remaining}.`);
      return;
    }
    if (!res.ok || !res.body) {
      onLog(i === 0
        ? "Failed to start compilation — check that you are logged in."
        : `Couldn't start ${year} — compile ${remaining} again.`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: CompileEvent;
          try {
            event = JSON.parse(line) as CompileEvent;
          } catch {
            continue; // malformed line — skip
          }
          if (event.type === "status" || event.type === "error") {
            if (event.message) onLog(prefix + event.message);
            if (event.progress !== undefined) onProgress(overall(event.progress));
          } else if (event.type === "done") {
            // The route's own "Compilation complete!" reads wrong mid-run.
            onLog(i === years.length - 1 ? (event.message ?? "Compilation complete!") : `${prefix}done.`);
            onProgress(overall(100));
          } else if (event.type === "year_done") {
            onYearDone(event);
          }
        }
      }
    } catch (err) {
      onLog(`Error: ${(err as Error)?.message ?? "Unknown error"}`);
      return;
    }
  }
}
