import pool from './dbclient.js';

export type PersistedRealtimeEvent = {
    eventId: string;
    mapId: string;
    userId: string;
    eventType: string;
    payloadJson: string;
    occurredAt: Date;
};

export type PersistedMapSnapshot = {
    mapId: string;
    snapshotJson: string;
    updatedAt: Date;
    lastEventId: string;
};

export async function insertRealtimeEvents(events: PersistedRealtimeEvent[]): Promise<void> {
    if (events.length === 0) {
        return;
    }

    const placeholders = events.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const values: Array<string | Date> = [];
    for (const event of events) {
        values.push(
            event.eventId,
            event.mapId,
            event.userId,
            event.eventType,
            event.payloadJson,
            event.occurredAt
        );
    }

    await pool.query(
        `INSERT IGNORE INTO realtime_events
        (event_id, map_id, user_id, event_type, payload_json, occurred_at)
        VALUES ${placeholders}`,
        values
    );
}

export async function upsertMapSnapshots(snapshots: PersistedMapSnapshot[]): Promise<void> {
    if (snapshots.length === 0) {
        return;
    }

    for (const snapshot of snapshots) {
        await pool.execute(
            `INSERT INTO realtime_map_snapshots (map_id, snapshot_json, updated_at, last_event_id)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              snapshot_json = VALUES(snapshot_json),
              updated_at = VALUES(updated_at),
              last_event_id = VALUES(last_event_id)`,
            [snapshot.mapId, snapshot.snapshotJson, snapshot.updatedAt, snapshot.lastEventId]
        );
    }
}
