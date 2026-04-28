import type { SleeperUser } from "./types";
import { sleeperApi } from "./sleeperApi";

// Module-level Sleeper user cache — persists for the lifetime of the browser session.
// Keyed by owner_id (Sleeper user_id). Eliminates redundant fetches when multiple
// leagues share owners or when a league is re-selected within the same session.
const _sleeperUserCache = new Map<string, SleeperUser>();

export async function fetchSleeperUser(ownerId: string): Promise<SleeperUser | null> {
  if (_sleeperUserCache.has(ownerId)) return _sleeperUserCache.get(ownerId) ?? null;
  const data = await sleeperApi.getUserById(ownerId);
  if (data?.user_id) _sleeperUserCache.set(ownerId, data);
  return data;
}
