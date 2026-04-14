// ============================================================
// Pure math utilities — no external dependencies.
// All functions are deterministic and side-effect free.
// ============================================================

export const ordinal = (rank: number) => {
  if (!rank) return "-";
  if (rank % 100 >= 11 && rank % 100 <= 13) return `${rank}th`;
  if (rank % 10 === 1) return `${rank}st`;
  if (rank % 10 === 2) return `${rank}nd`;
  if (rank % 10 === 3) return `${rank}rd`;
  return `${rank}th`;
};

export const average = (values: number[]) =>
  values.length
    ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10
    : 0;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

/** Logistic win probability between two fantasy scores.
 *  Returns a probability in [0.05, 0.95] to avoid certainty at extremes. */
export const logisticWinProb = (myScore: number, oppScore: number, scale = 180) =>
  clamp(1 / (1 + Math.exp((oppScore - myScore) / scale)), 0.05, 0.95);

/** Creates a deterministic pseudo-random number generator seeded by `seed`.
 *  Useful for repeatable simulation runs without external libraries. */
export const createSeededRandom = (seed: number) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

/** Box-Muller transform — generates a standard-normal random variate
 *  from a uniform RNG returned by createSeededRandom(). */
export const randomNormal = (rng: () => number) => {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

/** Builds a balanced round-robin schedule for `rosterIds` across `totalWeeks`.
 *  Returns an array of week matchup pairs — wraps when all rounds are exhausted. */
export const buildRoundRobinSchedule = (rosterIds: number[], totalWeeks: number) => {
  const rotation = [...rosterIds];
  if (rotation.length % 2 === 1) rotation.push(-1); // bye slot
  if (rotation.length < 2) return Array.from({ length: totalWeeks }, () => [] as Array<[number, number]>);

  const rounds: Array<Array<[number, number]>> = [];
  let current = [...rotation];
  for (let round = 0; round < current.length - 1; round++) {
    const pairs: Array<[number, number]> = [];
    for (let idx = 0; idx < current.length / 2; idx++) {
      const left  = current[idx];
      const right = current[current.length - 1 - idx];
      if (left !== -1 && right !== -1) pairs.push([left, right]);
    }
    rounds.push(pairs);
    current = [current[0], current[current.length - 1], ...current.slice(1, -1)];
  }
  return Array.from({ length: totalWeeks }, (_, weekIdx) => rounds[weekIdx % rounds.length] || []);
};

/** Returns the index of the given percentile within a counts histogram. */
export const percentileFromCounts = (counts: number[], percentile: number) => {
  const total = sum(counts);
  if (!total) return 0;
  const threshold = total * percentile;
  let running = 0;
  for (let idx = 0; idx < counts.length; idx++) {
    running += counts[idx];
    if (running >= threshold) return idx;
  }
  return counts.length - 1;
};

/** Returns the rank (1 = best) of `value` within the sorted `totals` array. */
export const rankAgainstLeague = (totals: number[], value: number) => {
  const sorted = [...totals].sort((a, b) => b - a);
  let rank = 1;
  for (const total of sorted) {
    if (value >= total) break;
    rank++;
  }
  return Math.min(rank, sorted.length || 1);
};
