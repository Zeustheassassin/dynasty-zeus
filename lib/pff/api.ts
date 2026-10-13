// Request/response shapes of the /api/pff/* routes, shared by the routes and
// the Scouting → PFF Links panel. Types and constants only: safe to import
// from client code (the rest of lib/pff is server-only).

/** Prospects per POST /api/pff/match; the panel loops over batches. */
export const PFF_MATCH_BATCH = 5;

export interface PffMatchResult {
  prospectId: string;
  playerStatus?: string | null;
  playerNote?: string | null;
  /** Game statuses written this run, counted. */
  games?: Record<string, number>;
  error?: string;
}

export interface PffMatchResponse {
  results: PffMatchResult[];
  /** Set when PFF's read budget ran out mid-batch: wait this long, then resend the unreached ids. */
  retryAfterMs: number | null;
}

/** Prospects per POST /api/pff/import; about 5 PFF reads per prospect-season. */
export const PFF_IMPORT_BATCH = 4;

export interface PffImportResult {
  prospectId: string;
  /** Charted games whose PFF stats were saved this run. */
  imported?: number;
  /** Seasons whose aggregate (grades, splits) was saved. */
  seasons?: number;
  /** Linked games PFF had nothing for, with why. */
  missing?: { gameId: string; reason: string }[];
  /** Why nothing was imported (not linked, no linked games, …). */
  note?: string;
  error?: string;
}

export interface PffImportResponse {
  results: PffImportResult[];
  /** Set when PFF's read budget ran out mid-batch: wait this long, then resend the unreached ids. */
  retryAfterMs: number | null;
}

/** Prospects per POST /api/pff/bio; one PFF read per linked prospect. */
export const PFF_BIO_BATCH = 20;

/** Height, weight, birthday and eligible-thru year as the prospect has them now. */
export interface BioOnFile {
  /** As typed ("6'2\""); "" when blank. */
  height: string;
  weight: number | null;
  /** YYYY-MM-DD. */
  birthday: string | null;
  /** Last draft he can enter (migration 071); null when blank. */
  eligibleThru: number | null;
}

/** PFF's directory numbers for him, each null when PFF leaves it blank. */
export interface PffBio {
  heightIn: number | null;
  weight: number | null;
  /** YYYY-MM-DD. */
  dob: string | null;
  /** PFF's current_eligible_year: the year his college eligibility runs out. */
  eligibleThru: number | null;
}

export interface PffBioResult {
  prospectId: string;
  name: string;
  current: BioOnFile;
  /** Null when PFF wasn't read for him (see note / error). */
  pff: PffBio | null;
  /** Why PFF wasn't read: not linked, link waiting on the user, … */
  note?: string;
  error?: string;
}

export interface PffBioResponse {
  results: PffBioResult[];
  /** Set when PFF's read budget ran out mid-batch: wait this long, then resend the unreached ids. */
  retryAfterMs: number | null;
}

/** GET /api/pff/players: one directory hit. */
export interface PffCandidate {
  id: number;
  name: string;
  position: string;
  team: string | null;
  dob: string | null;
  /** e.g. 6'2" */
  height: string | null;
  weight: number | null;
  currentClass: string | null;
}

/** GET /api/pff/games: one game of his PFF log for a season. */
export interface PffGameOption {
  pffGameId: number;
  week: number;
  start: string;
  opponent: string;
}
