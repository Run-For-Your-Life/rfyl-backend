import fs from 'node:fs';
import path from 'node:path';

import { getEnv, getNumberEnv } from '../config/env.js';
import {
    insertRealtimeEvents,
    syncKnockouts,
    syncMapTerritories,
    type PersistedKnockout,
    type PersistedMapTerritories,
    type PersistedMapSnapshot,
    type PersistedRealtimeEvent,
    upsertMapSnapshots,
} from '../db/realtimeStateStore.js';

import type { MapSnapshot, RealtimeEvent } from './realtimeEngine.js';

type WalBatchRecord = {
    batchId: string;
    mapId: string;
    createdAt: number;
    events: RealtimeEvent[];
    snapshot: MapSnapshot;
};

const WAL_PATH = path.resolve(process.cwd(), getEnv('REALTIME_WAL_PATH', './var/realtime-events.jsonl'));
const WAL_CURSOR_PATH = path.resolve(process.cwd(), getEnv('REALTIME_WAL_CURSOR_PATH', './var/realtime-events.cursor'));
const FLUSH_INTERVAL_MS = getNumberEnv('REALTIME_WAL_FLUSH_MS', 5000) ?? 5000;
const MAX_BATCHES_PER_FLUSH = getNumberEnv('REALTIME_WAL_MAX_BATCHES', 200) ?? 200;
const WAL_APPEND_RETRY_DELAY_MS = 25;

let flushTimer: NodeJS.Timeout | null = null;
let flushInProgress = false;
let sequence = 0;
let walAppendQueue: Promise<void> = Promise.resolve();
let writers: {
    insertRealtimeEvents: (events: PersistedRealtimeEvent[]) => Promise<void>;
    upsertMapSnapshots: (snapshots: PersistedMapSnapshot[]) => Promise<void>;
    syncMapTerritories: (snapshots: PersistedMapTerritories[]) => Promise<void>;
    syncKnockouts: (knockouts: PersistedKnockout[]) => Promise<void>;
} = {
    insertRealtimeEvents,
    upsertMapSnapshots,
    syncMapTerritories,
    syncKnockouts,
};

export function appendRealtimeWal(mapId: string, events: RealtimeEvent[], snapshot: MapSnapshot): void {
    if (events.length === 0) {
        return;
    }

    ensureWalDir();

    const record: WalBatchRecord = {
        batchId: nextBatchId(),
        mapId,
        createdAt: Date.now(),
        events,
        snapshot,
    };

    const line = `${JSON.stringify(record)}\n`;
    walAppendQueue = walAppendQueue
        .then(() => appendWalLineWithRetry(line))
        .catch((error) => {
            console.warn('Realtime WAL append failed', error);
        });
}

export function startRealtimeWalFlusher(): void {
    if (flushTimer) {
        return;
    }

    ensureWalDir();
    flushTimer = setInterval(() => {
        void flushRealtimeWal();
    }, FLUSH_INTERVAL_MS);
}

export async function flushRealtimeWalNow(): Promise<void> {
    await flushRealtimeWal();
}

export async function stopRealtimeWalFlusher(): Promise<void> {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
    await waitForPendingWalAppends();
    await flushRealtimeWal();
}

async function flushRealtimeWal(): Promise<void> {
    if (flushInProgress) {
        return;
    }

    flushInProgress = true;

    try {
        await waitForPendingWalAppends();

        if (!fs.existsSync(WAL_PATH)) {
            return;
        }

        const cursor = readCursor();
        const lines = fs
            .readFileSync(WAL_PATH, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        if (cursor >= lines.length) {
            return;
        }

        const end = Math.min(lines.length, cursor + MAX_BATCHES_PER_FLUSH);
        const pendingLines = lines.slice(cursor, end);
        const records = parseRecords(pendingLines);

        if (records.length === 0) {
            writeCursor(end);
            return;
        }

        const events: PersistedRealtimeEvent[] = [];
        const knockouts: PersistedKnockout[] = [];
        const latestSnapshots = new Map<string, PersistedMapSnapshot>();
        const latestTerritorySnapshots = new Map<string, { snapshot: MapSnapshot; updatedAt: Date }>();

        for (const record of records) {
            const updatedAt = new Date(record.createdAt);
            for (let i = 0; i < record.events.length; i += 1) {
                const event = record.events[i];
                if (!event) {
                    continue;
                }
                events.push({
                    eventId: `${record.batchId}:${i}`,
                    mapId: record.mapId,
                    userId: event.userId,
                    eventType: event.type,
                    payloadJson: JSON.stringify(event),
                    occurredAt: updatedAt,
                });
                if (isKnockoutEvent(event)) {
                    knockouts.push({
                        sourceEventId: `${record.batchId}:${i}`,
                        mapId: record.mapId,
                        victimUid: event.userId,
                        attackerUid: event.byUserId,
                        reason: event.reason,
                        occurredAt: updatedAt,
                    });
                }
            }

            const lastEventId = `${record.batchId}:${Math.max(0, record.events.length - 1)}`;
            latestSnapshots.set(record.mapId, {
                mapId: record.mapId,
                snapshotJson: JSON.stringify(record.snapshot),
                updatedAt,
                lastEventId,
            });
            latestTerritorySnapshots.set(record.mapId, { snapshot: record.snapshot, updatedAt });
        }

        await writers.insertRealtimeEvents(events);
        await writers.upsertMapSnapshots(Array.from(latestSnapshots.values()));
        await writers.syncMapTerritories(buildMapTerritories(latestTerritorySnapshots));
        await writers.syncKnockouts(knockouts);

        writeCursor(end);
    } catch (error) {
        console.warn('Realtime WAL flush failed', error);
    } finally {
        flushInProgress = false;
    }
}

function parseRecords(lines: string[]): WalBatchRecord[] {
    const records: WalBatchRecord[] = [];
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line) as Partial<WalBatchRecord>;
            if (
                typeof parsed.batchId !== 'string' ||
                typeof parsed.mapId !== 'string' ||
                typeof parsed.createdAt !== 'number' ||
                !Array.isArray(parsed.events) ||
                !parsed.snapshot
            ) {
                continue;
            }
            records.push(parsed as WalBatchRecord);
        } catch {
            continue;
        }
    }
    return records;
}

type SnapshotPlayer = {
    userId?: unknown;
    territory?: unknown;
    territoryAreaSqMeters?: unknown;
};

type SnapshotTerritory = {
    geometry?: unknown;
};

type SnapshotGeometry = {
    type?: unknown;
    coordinates?: unknown;
};

type KnockoutEvent = Extract<RealtimeEvent, { type: 'knockout' }>;

function buildMapTerritories(
    snapshots: Map<string, { snapshot: MapSnapshot; updatedAt: Date }>
): PersistedMapTerritories[] {
    const output: PersistedMapTerritories[] = [];
    for (const [mapId, snapshotRecord] of snapshots.entries()) {
        const territoriesByOwner = new Map<string, PersistedMapTerritories['territories'][number]>();
        const players = Array.isArray(snapshotRecord.snapshot.players) ? snapshotRecord.snapshot.players : [];
        for (const rawPlayer of players as unknown[]) {
            if (!rawPlayer || typeof rawPlayer !== 'object') {
                continue;
            }
            const ownerUid = normalizeOwnerUid((rawPlayer as SnapshotPlayer).userId);
            if (!ownerUid) {
                continue;
            }
            territoriesByOwner.set(ownerUid, {
                ownerUid,
                territoryGeoJson: toTerritoryGeometryJson((rawPlayer as SnapshotPlayer).territory),
                areaM2: toNonNegativeNumber((rawPlayer as SnapshotPlayer).territoryAreaSqMeters),
            });
        }
        output.push({
            mapId,
            updatedAt: snapshotRecord.updatedAt,
            territories: Array.from(territoriesByOwner.values()),
        });
    }
    return output;
}

function isKnockoutEvent(event: RealtimeEvent): event is KnockoutEvent {
    return event.type === 'knockout';
}

function normalizeOwnerUid(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function toTerritoryGeometryJson(territory: unknown): string | null {
    if (!territory || typeof territory !== 'object') {
        return null;
    }
    const geometry = (territory as SnapshotTerritory).geometry;
    if (!isSupportedGeometry(geometry)) {
        return null;
    }
    try {
        return JSON.stringify(geometry);
    } catch {
        return null;
    }
}

function isSupportedGeometry(geometry: unknown): boolean {
    if (!geometry || typeof geometry !== 'object') {
        return false;
    }
    const typed = geometry as SnapshotGeometry;
    if (typed.type !== 'Polygon' && typed.type !== 'MultiPolygon') {
        return false;
    }
    return Array.isArray(typed.coordinates);
}

function toNonNegativeNumber(value: unknown): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return 0;
    }
    return numeric;
}

function nextBatchId(): string {
    sequence += 1;
    return `${Date.now()}-${process.pid}-${sequence}`;
}

function ensureWalDir(): void {
    const walDir = path.dirname(WAL_PATH);
    fs.mkdirSync(walDir, { recursive: true });
}

function readCursor(): number {
    if (!fs.existsSync(WAL_CURSOR_PATH)) {
        return 0;
    }
    const raw = fs.readFileSync(WAL_CURSOR_PATH, 'utf8').trim();
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }
    return Math.floor(value);
}

function writeCursor(cursor: number): void {
    fs.writeFileSync(WAL_CURSOR_PATH, String(cursor), 'utf8');
}

async function appendWalLineWithRetry(line: string): Promise<void> {
    try {
        await fs.promises.appendFile(WAL_PATH, line, 'utf8');
    } catch (error) {
        await delay(WAL_APPEND_RETRY_DELAY_MS);
        await fs.promises.appendFile(WAL_PATH, line, 'utf8');
        if (error) {
            console.warn('Realtime WAL append transient failure recovered', error);
        }
    }
}

async function waitForPendingWalAppends(): Promise<void> {
    await walAppendQueue;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function __setRealtimePersistenceWritersForTest(
    testWriters:
        | {
              insertRealtimeEvents: (events: PersistedRealtimeEvent[]) => Promise<void>;
              upsertMapSnapshots: (snapshots: PersistedMapSnapshot[]) => Promise<void>;
              syncMapTerritories: (snapshots: PersistedMapTerritories[]) => Promise<void>;
              syncKnockouts: (knockouts: PersistedKnockout[]) => Promise<void>;
          }
        | null
): void {
    if (!testWriters) {
        writers = {
            insertRealtimeEvents,
            upsertMapSnapshots,
            syncMapTerritories,
            syncKnockouts,
        };
        return;
    }
    writers = testWriters;
}
