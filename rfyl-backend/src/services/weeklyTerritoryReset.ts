import pool from '../db/dbclient.js';
import { rolloverWeeklyMatchmaking } from './mapMatchmaking.js';
import { getActiveMapIds } from './realtimeEngine.js';
import { resetMap } from './mapResetService.js';

const WEEKLY_RESET_ENABLED = true;
const WEEKLY_RESET_WEEKDAY = 'monday';
const WEEKLY_RESET_HOUR = 0;
const WEEKLY_RESET_MINUTE = 0;
const WEEKLY_RESET_TIMEZONE = 'America/Los_Angeles';
const DEFAULT_WEEKDAY_INDEX = 1;
const MINUTE_MS = 60_000;
const MAX_SEARCH_MINUTES = 8 * 24 * 60;
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

type ZonedDateParts = {
  weekday: number;
  hour: number;
  minute: number;
  dateKey: string;
};

let resetTimer: ReturnType<typeof setTimeout> | null = null;
let resetInFlight = false;
let lastResetDateKey: string | null = null;

export function startWeeklyTerritoryResetScheduler(): void {
  if (!isWeeklyResetEnabled()) {
    return;
  }
  if (resetTimer) {
    return;
  }

  const now = new Date();
  const currentParts = getZonedDateParts(now);
  if (matchesSchedule(currentParts) && lastResetDateKey !== currentParts.dateKey) {
    void runWeeklyTerritoryReset(currentParts.dateKey);
    return;
  }

  scheduleNextWeeklyReset(now);
}

export function stopWeeklyTerritoryResetScheduler(): void {
  if (!resetTimer) {
    return;
  }
  clearTimeout(resetTimer);
  resetTimer = null;
}

async function runWeeklyTerritoryReset(dateKey: string): Promise<void> {
  if (resetInFlight) {
    return;
  }

  resetInFlight = true;
  resetTimer = null;

  try {
    const [result] = await pool.execute('DELETE FROM territories');
    const activeMapIds = getActiveMapIds();
    for (const mapId of activeMapIds) {
      resetMap(mapId, 'scheduled');
    }
    rolloverWeeklyMatchmaking(dateKey);
    lastResetDateKey = dateKey;

    const affectedRows =
      typeof result === 'object' && result !== null && 'affectedRows' in result
        ? Number((result as { affectedRows?: number }).affectedRows ?? 0)
        : 0;
    console.warn(
      `Weekly territory reset completed for ${dateKey}. Cleared ${affectedRows} territory rows across ${activeMapIds.length} active maps and rebuilt weekly matchmaking.`
    );
  } catch (error) {
    console.warn('Weekly territory reset failed', error);
  } finally {
    resetInFlight = false;
    scheduleNextWeeklyReset(new Date());
  }
}

function scheduleNextWeeklyReset(from: Date): void {
  const nextRun = findNextScheduledRun(from);
  const delayMs = Math.max(nextRun.getTime() - Date.now(), 1_000);
  resetTimer = setTimeout(() => {
    const parts = getZonedDateParts(new Date());
    void runWeeklyTerritoryReset(parts.dateKey);
  }, delayMs);
}

function findNextScheduledRun(from: Date): Date {
  let candidate = new Date(Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
  for (let i = 0; i < MAX_SEARCH_MINUTES; i += 1) {
    if (matchesSchedule(getZonedDateParts(candidate))) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + MINUTE_MS);
  }
  throw new Error('Unable to find next weekly territory reset time within search window');
}

function matchesSchedule(parts: ZonedDateParts): boolean {
  return (
    parts.weekday === getScheduledWeekday() &&
    parts.hour === getScheduledHour() &&
    parts.minute === getScheduledMinute()
  );
}

function getZonedDateParts(date: Date): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: getScheduledTimezone(),
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const weekdayLabel = values.get('weekday')?.toLowerCase() ?? WEEKLY_RESET_WEEKDAY;
  const weekday = WEEKDAY_INDEX[weekdayLabel] ?? DEFAULT_WEEKDAY_INDEX;
  const year = values.get('year') ?? '0000';
  const month = values.get('month') ?? '01';
  const day = values.get('day') ?? '01';
  const hour = Number(values.get('hour') ?? WEEKLY_RESET_HOUR);
  const minute = Number(values.get('minute') ?? WEEKLY_RESET_MINUTE);

  return {
    weekday,
    hour,
    minute,
    dateKey: `${year}-${month}-${day}`,
  };
}

function isWeeklyResetEnabled(): boolean {
  return WEEKLY_RESET_ENABLED;
}

function getScheduledWeekday(): number {
  const rawDay = WEEKLY_RESET_WEEKDAY.trim().toLowerCase();
  return WEEKDAY_INDEX[rawDay] ?? DEFAULT_WEEKDAY_INDEX;
}

function getScheduledHour(): number {
  return clampNumber(WEEKLY_RESET_HOUR, 0, 23, 0);
}

function getScheduledMinute(): number {
  return clampNumber(WEEKLY_RESET_MINUTE, 0, 59, 0);
}

function getScheduledTimezone(): string {
  const timezone = WEEKLY_RESET_TIMEZONE.trim();
  if (!timezone) {
    return 'UTC';
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    console.warn(`Invalid hard-coded weekly reset timezone "${timezone}", falling back to UTC`);
    return 'UTC';
  }
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}
