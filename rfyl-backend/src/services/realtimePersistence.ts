import fs from 'node:fs';
import path from 'node:path';

import { getEnv, getNumberEnv } from '../config/env.js';
import {
    insertRealtimeEvents,
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
} = {
    insertRealtimeEvents,
    upsertMapSnapshots,
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
        const latestSnapshots = new Map<string, PersistedMapSnapshot>();

        for (const record of records) {
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
                    occurredAt: new Date(record.createdAt),
                });
            }

            const lastEventId = `${record.batchId}:${Math.max(0, record.events.length - 1)}`;
            latestSnapshots.set(record.mapId, {
                mapId: record.mapId,
                snapshotJson: JSON.stringify(record.snapshot),
                updatedAt: new Date(record.createdAt),
                lastEventId,
            });
        }

        await writers.insertRealtimeEvents(events);
        await writers.upsertMapSnapshots(Array.from(latestSnapshots.values()));

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
          }
        | null
): void {
    if (!testWriters) {
        writers = {
            insertRealtimeEvents,
            upsertMapSnapshots,
        };
        return;
    }
    writers = testWriters;
}
