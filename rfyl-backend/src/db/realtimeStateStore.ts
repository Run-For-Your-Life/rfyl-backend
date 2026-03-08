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

export type PersistedMapTerritory = {
    ownerUid: string;
    territoryGeoJson: string | null;
    areaM2: number;
};

export type PersistedMapTerritories = {
    mapId: string;
    updatedAt: Date;
    territories: PersistedMapTerritory[];
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

export async function syncMapTerritories(snapshots: PersistedMapTerritories[]): Promise<void> {
    if (snapshots.length === 0) {
        return;
    }

    const latestByMap = new Map<string, PersistedMapTerritories>();
    for (const snapshot of snapshots) {
        const mapId = snapshot.mapId.trim();
        if (!mapId) {
            continue;
        }
        const territoriesByOwner = new Map<string, PersistedMapTerritory>();
        for (const territory of snapshot.territories) {
            const ownerUid = territory.ownerUid.trim();
            if (!ownerUid) {
                continue;
            }
            territoriesByOwner.set(ownerUid, {
                ownerUid,
                territoryGeoJson: territory.territoryGeoJson,
                areaM2: Number.isFinite(territory.areaM2) && territory.areaM2 >= 0 ? territory.areaM2 : 0,
            });
        }
        latestByMap.set(mapId, {
            mapId,
            updatedAt: snapshot.updatedAt,
            territories: Array.from(territoriesByOwner.values()),
        });
    }

    const normalized = Array.from(latestByMap.values());
    if (normalized.length === 0) {
        return;
    }

    const mapPlaceholders = normalized.map(() => '(?)').join(', ');
    await pool.query(
        `INSERT IGNORE INTO map_sessions (id) VALUES ${mapPlaceholders}`,
        normalized.map((snapshot) => snapshot.mapId)
    );

    const ownerUids = Array.from(
        new Set(
            normalized.flatMap((snapshot) =>
                snapshot.territories
                    .filter((territory) => territory.territoryGeoJson !== null)
                    .map((territory) => territory.ownerUid)
            )
        )
    );
    if (ownerUids.length > 0) {
        const userPlaceholders = ownerUids.map(() => '(?)').join(', ');
        await pool.query(
            `INSERT IGNORE INTO users (firebase_uid) VALUES ${userPlaceholders}`,
            ownerUids
        );
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const snapshot of normalized) {
            const ownerList = snapshot.territories.map((territory) => territory.ownerUid);
            if (ownerList.length === 0) {
                await connection.execute('DELETE FROM territories WHERE map_id = ?', [snapshot.mapId]);
            } else {
                const ownerPlaceholders = ownerList.map(() => '?').join(', ');
                await connection.execute(
                    `DELETE FROM territories WHERE map_id = ? AND owner_uid NOT IN (${ownerPlaceholders})`,
                    [snapshot.mapId, ...ownerList]
                );
            }

            for (const territory of snapshot.territories) {
                await connection.execute(
                    'DELETE FROM territories WHERE map_id = ? AND owner_uid = ?',
                    [snapshot.mapId, territory.ownerUid]
                );

                if (!territory.territoryGeoJson) {
                    continue;
                }

                await connection.execute(
                    `INSERT INTO territories (owner_uid, map_id, polygon, area_m2, claimed_at, updated_at)
                    VALUES (?, ?, ST_GeomFromGeoJSON(?), ?, ?, ?)`,
                    [
                        territory.ownerUid,
                        snapshot.mapId,
                        territory.territoryGeoJson,
                        territory.areaM2,
                        snapshot.updatedAt,
                        snapshot.updatedAt,
                    ]
                );
            }
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}
