import { getNumberEnv } from '../config/env.js';
import { findUserByFirebaseUid } from './authService.js';

type CachedUsernameEntry = {
  username: string;
  expiresAtMs: number;
};

const DEFAULT_USERNAME_CACHE_TTL_MS = 5000;
const MAX_USERNAME_CACHE_SIZE = 5000;
const username_cache = new Map<string, CachedUsernameEntry>();
const username_cache_ttl_ms = getNumberEnv('MAP_AUTH_USERNAME_CACHE_TTL_MS', DEFAULT_USERNAME_CACHE_TTL_MS);

function getCachedUsername(userId: string, nowMs: number): string | null {
  const cached_entry = username_cache.get(userId);
  if (!cached_entry) {
    return null;
  }
  if (cached_entry.expiresAtMs <= nowMs) {
    username_cache.delete(userId);
    return null;
  }
  return cached_entry.username;
}

function setCachedUsername(userId: string, username: string, nowMs: number): void {
  if (username_cache.size >= MAX_USERNAME_CACHE_SIZE) {
    const oldest_key = username_cache.keys().next().value as string | undefined;
    if (oldest_key) {
      username_cache.delete(oldest_key);
    }
  }
  username_cache.set(userId, {
    username,
    expiresAtMs: nowMs + username_cache_ttl_ms,
  });
}

export function clearAuthIdentityCache(): void {
  username_cache.clear();
}

export async function getUsernameByFirebaseUid(firebaseUid: string): Promise<string | null> {
  const now_ms = Date.now();
  const cached = getCachedUsername(firebaseUid, now_ms);
  if (cached) {
    return cached;
  }

  const synced = await findUserByFirebaseUid(firebaseUid);
  if (!synced) {
    username_cache.delete(firebaseUid);
    return null;
  }

  setCachedUsername(firebaseUid, synced.username, now_ms);
  return synced.username;
}
