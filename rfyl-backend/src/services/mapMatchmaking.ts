import { getEnv, getNumberEnv } from '../config/env.js';
import { getMapSnapshot, joinPlayer } from './realtimeEngine.js';
import { appendRealtimeWal } from './realtimePersistence.js';
import { broadcastEvents } from './realtimeStream.js';

const DEFAULT_MATCHMADE_MAP_PREFIX = 'weekly-map';
const PREFERRED_PLAYERS_PER_MAP = 5;
const MAX_PLAYERS_PER_MAP = 10;
const DEFAULT_QUEUE_TIMEOUT_MS = 45_000;
const DEFAULT_STALE_QUEUE_MS = 900_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

type QueueEntry = {
  user_id: string;
  username: string;
  queued_at: number;
  updated_at: number;
};

type MatchmakingState = {
  cycle_key: string;
  next_map_number: number;
  user_to_map: Map<string, string>;
  map_to_users: Map<string, Set<string>>;
  queued_users: Map<string, QueueEntry>;
  weekly_active_users: Set<string>;
  queue_flush_timer: ReturnType<typeof setTimeout> | null;
};

let matchmaking_state: MatchmakingState | null = null;
let cleanup_timer: ReturnType<typeof setInterval> | null = null;

export function isManagedMatchmadeMapId(map_id: string): boolean {
  return map_id.startsWith(`${getMatchmadeMapPrefix()}-`);
}

export function startMatchmakingMaintenance(): void {
  if (cleanup_timer) {
    return;
  }

  cleanup_timer = setInterval(() => {
    sweepMatchmakingState();
  }, getCleanupIntervalMs());
  cleanup_timer.unref?.();
}

export function stopMatchmakingMaintenance(): void {
  if (cleanup_timer) {
    clearInterval(cleanup_timer);
    cleanup_timer = null;
  }

  const state = matchmaking_state;
  if (state?.queue_flush_timer) {
    clearTimeout(state.queue_flush_timer);
    state.queue_flush_timer = null;
  }
}

export function getAssignedMatchmadeMapId(user_id: string): string | undefined {
  return getOrCreateMatchmakingState().user_to_map.get(user_id);
}

export function recordMatchmakingActivity(user_id: string): void {
  getOrCreateMatchmakingState().weekly_active_users.add(user_id);
}

export function queueMatchmadePlayer(user_id: string, username: string, now = Date.now()): string | null {
  const state = getOrCreateMatchmakingState();

  const existing_map_id = state.user_to_map.get(user_id);
  if (existing_map_id) {
    return existing_map_id;
  }

  const existing_queue_entry = state.queued_users.get(user_id);
  if (existing_queue_entry) {
    state.queued_users.set(user_id, {
      ...existing_queue_entry,
      username,
    });
  } else {
    state.queued_users.set(user_id, {
      user_id,
      username,
      queued_at: now,
      updated_at: now,
    });
  }

  if (state.queued_users.size >= PREFERRED_PLAYERS_PER_MAP) {
    flushQueuedPlayers(state, now);
  } else if (!existing_queue_entry) {
    scheduleNextQueueFlush(state, now);
  }

  return state.user_to_map.get(user_id) ?? null;
}

export function rolloverWeeklyMatchmaking(cycle_key?: string): void {
  const previous_state = getOrCreateMatchmakingState();
  const active_users = Array.from(previous_state.weekly_active_users.values()).sort();

  if (previous_state.queue_flush_timer) {
    clearTimeout(previous_state.queue_flush_timer);
    previous_state.queue_flush_timer = null;
  }

  const next_state = createMatchmakingState(cycle_key ?? buildDefaultCycleKey());
  for (const user_id of active_users) {
    assignUserToPreferredWeeklyMap(next_state, user_id);
  }
  matchmaking_state = next_state;
}

export function resetWeeklyMatchmaking(cycle_key?: string): void {
  const previous_state = matchmaking_state;
  if (previous_state?.queue_flush_timer) {
    clearTimeout(previous_state.queue_flush_timer);
  }
  matchmaking_state = createMatchmakingState(cycle_key ?? buildDefaultCycleKey());
}

export function sweepMatchmakingState(now = Date.now()): void {
  const state = getOrCreateMatchmakingState();
  const stale_cutoff = now - getStaleQueueExpirationMs();

  for (const [user_id, entry] of state.queued_users.entries()) {
    if (entry.updated_at < stale_cutoff) {
      state.queued_users.delete(user_id);
    }
  }

  for (const [map_id, users] of state.map_to_users.entries()) {
    if (users.size === 0) {
      state.map_to_users.delete(map_id);
    }
  }

  for (const [user_id, map_id] of state.user_to_map.entries()) {
    const users = state.map_to_users.get(map_id);
    if (!users || !users.has(user_id)) {
      state.user_to_map.delete(user_id);
    }
  }

  scheduleNextQueueFlush(state, now);
}

function getOrCreateMatchmakingState(): MatchmakingState {
  if (!matchmaking_state) {
    matchmaking_state = createMatchmakingState(buildDefaultCycleKey());
  }
  return matchmaking_state;
}

function createMatchmakingState(cycle_key: string): MatchmakingState {
  return {
    cycle_key: sanitizeSegment(cycle_key),
    next_map_number: 1,
    user_to_map: new Map(),
    map_to_users: new Map(),
    queued_users: new Map(),
    weekly_active_users: new Set(),
    queue_flush_timer: null,
  };
}

function flushQueuedPlayers(state: MatchmakingState, now: number): void {
  if (state.queue_flush_timer) {
    clearTimeout(state.queue_flush_timer);
    state.queue_flush_timer = null;
  }

  const queued_players = Array.from(state.queued_users.values())
    .sort((a, b) => a.updated_at - b.updated_at || a.user_id.localeCompare(b.user_id));

  for (const entry of queued_players) {
    const map_id = assignUserToLeastPopulatedMap(state, entry.user_id);
    state.weekly_active_users.add(entry.user_id);
    state.queued_users.delete(entry.user_id);
    joinAssignedPlayer(map_id, entry.user_id, entry.username);
  }

  scheduleNextQueueFlush(state, now);
}

function joinAssignedPlayer(map_id: string, user_id: string, username: string): void {
  const events = joinPlayer(map_id, user_id, username);
  const snapshot = getMapSnapshot(map_id);
  if (snapshot && events.length > 0) {
    appendRealtimeWal(map_id, events, snapshot);
    broadcastEvents(map_id, events);
  }
}

function scheduleNextQueueFlush(state: MatchmakingState, now: number): void {
  if (state.queue_flush_timer) {
    clearTimeout(state.queue_flush_timer);
    state.queue_flush_timer = null;
  }

  let next_flush_at: number | null = null;
  for (const entry of state.queued_users.values()) {
    const candidate = entry.updated_at + getQueueTimeoutMs();
    if (next_flush_at === null || candidate < next_flush_at) {
      next_flush_at = candidate;
    }
  }

  if (next_flush_at === null) {
    return;
  }

  const delay_ms = Math.max(next_flush_at - now, 0);
  state.queue_flush_timer = setTimeout(() => {
    if (matchmaking_state !== state) {
      return;
    }
    state.queue_flush_timer = null;
    flushQueuedPlayers(state, Date.now());
  }, delay_ms);
  state.queue_flush_timer.unref?.();
}

function assignUserToLeastPopulatedMap(state: MatchmakingState, user_id: string): string {
  removeAssignedUser(state, user_id);

  const map_id = selectLeastPopulatedEligibleMapId(state) ?? createNextMapId(state);
  const users = getOrCreateMapUserSet(state, map_id);
  users.add(user_id);
  state.user_to_map.set(user_id, map_id);
  return map_id;
}

function assignUserToPreferredWeeklyMap(state: MatchmakingState, user_id: string): void {
  removeAssignedUser(state, user_id);

  const map_id = selectMostPopulatedMapBelowPreferred(state) ?? createNextMapId(state);
  const users = getOrCreateMapUserSet(state, map_id);
  users.add(user_id);
  state.user_to_map.set(user_id, map_id);
}

function removeAssignedUser(state: MatchmakingState, user_id: string): void {
  const existing_map_id = state.user_to_map.get(user_id);
  if (!existing_map_id) {
    return;
  }

  const users = state.map_to_users.get(existing_map_id);
  if (users) {
    users.delete(user_id);
    if (users.size === 0) {
      state.map_to_users.delete(existing_map_id);
    }
  }
  state.user_to_map.delete(user_id);
}

function selectLeastPopulatedEligibleMapId(state: MatchmakingState): string | null {
  let selected_map_id: string | null = null;
  let selected_size = Number.POSITIVE_INFINITY;

  for (const [map_id, users] of state.map_to_users.entries()) {
    if (users.size >= MAX_PLAYERS_PER_MAP) {
      continue;
    }
    if (users.size < selected_size) {
      selected_map_id = map_id;
      selected_size = users.size;
      continue;
    }
    if (users.size === selected_size && selected_map_id && map_id.localeCompare(selected_map_id) < 0) {
      selected_map_id = map_id;
    }
  }

  return selected_map_id;
}

function selectMostPopulatedMapBelowPreferred(state: MatchmakingState): string | null {
  let selected_map_id: string | null = null;
  let selected_size = -1;

  for (const [map_id, users] of state.map_to_users.entries()) {
    if (users.size >= PREFERRED_PLAYERS_PER_MAP) {
      continue;
    }
    if (users.size > selected_size) {
      selected_map_id = map_id;
      selected_size = users.size;
      continue;
    }
    if (users.size === selected_size && selected_map_id && map_id.localeCompare(selected_map_id) < 0) {
      selected_map_id = map_id;
    }
  }

  return selected_map_id;
}

function getOrCreateMapUserSet(state: MatchmakingState, map_id: string): Set<string> {
  let users = state.map_to_users.get(map_id);
  if (!users) {
    users = new Set();
    state.map_to_users.set(map_id, users);
  }
  return users;
}

function createNextMapId(state: MatchmakingState): string {
  const map_id = `${getMatchmadeMapPrefix()}-${state.cycle_key}-${String(state.next_map_number).padStart(3, '0')}`;
  state.next_map_number += 1;
  state.map_to_users.set(map_id, new Set());
  return map_id;
}

function getMatchmadeMapPrefix(): string {
  const configured_prefix = getEnv('MATCHMADE_MAP_PREFIX', DEFAULT_MATCHMADE_MAP_PREFIX).trim();
  if (!configured_prefix) {
    return DEFAULT_MATCHMADE_MAP_PREFIX;
  }
  return sanitizeSegment(configured_prefix);
}

function buildDefaultCycleKey(): string {
  return sanitizeSegment(new Date().toISOString().slice(0, 10));
}

function sanitizeSegment(value: string): string {
  const sanitized_value = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized_value.length > 0 ? sanitized_value : 'current';
}

function getQueueTimeoutMs(): number {
  return clampNumber(getNumberEnv('MATCHMAKING_QUEUE_TIMEOUT_MS', DEFAULT_QUEUE_TIMEOUT_MS), 10, 86_400_000, DEFAULT_QUEUE_TIMEOUT_MS);
}

function getStaleQueueExpirationMs(): number {
  return clampNumber(getNumberEnv('MATCHMAKING_STALE_QUEUE_MS', DEFAULT_STALE_QUEUE_MS), getQueueTimeoutMs(), 7 * 86_400_000, DEFAULT_STALE_QUEUE_MS);
}

function getCleanupIntervalMs(): number {
  return clampNumber(getNumberEnv('MATCHMAKING_CLEANUP_INTERVAL_MS', DEFAULT_CLEANUP_INTERVAL_MS), 10, 86_400_000, DEFAULT_CLEANUP_INTERVAL_MS);
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}
