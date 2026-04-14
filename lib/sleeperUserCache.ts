// Module-level Sleeper user cache — persists for the lifetime of the browser session.
// Keyed by owner_id (Sleeper user_id). Eliminates redundant fetches when multiple
// leagues share owners or when a league is re-selected within the same session.
const _sleeperUserCache = new Map<string, any>();

export async function fetchSleeperUser(ownerId: string): Promise<any> {
  if (_sleeperUserCache.has(ownerId)) return _sleeperUserCache.get(ownerId);
  const data = await fetch(`https://api.sleeper.app/v1/user/${ownerId}`).then((r) => r.json());
  if (data?.user_id) _sleeperUserCache.set(ownerId, data);
  return data;
}
