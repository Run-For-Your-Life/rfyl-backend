import { RowDataPacket } from 'mysql2/promise';

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
    clearOnSync: boolean;
};

export type PersistedMapTerritories = {
    mapId: string;
    updatedAt: Date;
    replaceAll: boolean;
    territories: PersistedMapTerritory[];
};

export type PersistedKnockout = {
    sourceEventId: string;
    mapId: string;
    victimUid: string;
    attackerUid: string;
    reason: string;
    occurredAt: Date;
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
                clearOnSync: territory.clearOnSync,
            });
        }
        latestByMap.set(mapId, {
            mapId,
            updatedAt: snapshot.updatedAt,
            replaceAll: snapshot.replaceAll,
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
        const uidPlaceholders = ownerUids.map(() => '?').join(', ');
        const [rows] = await pool.query<(RowDataPacket & { firebase_uid: string })[]>(
            `SELECT firebase_uid FROM users WHERE firebase_uid IN (${uidPlaceholders})`,
            ownerUids
        );
        const existing = new Set(rows.map((row) => row.firebase_uid));
        const missing = ownerUids.filter((uid) => !existing.has(uid));
        if (missing.length > 0) {
            //Don't fail the whole flush for test/mock identities; skip unknown owners.
            console.warn(`Realtime territory sync skipping unknown users: ${missing.join(', ')}`);
            for (const snapshot of normalized) {
                snapshot.territories = snapshot.territories.filter((territory) =>
                    existing.has(territory.ownerUid)
                );
            }
        }
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        for (const snapshot of normalized) {
            if (snapshot.replaceAll) {
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
            }

            for (const territory of snapshot.territories) {
                if (!territory.territoryGeoJson && !territory.clearOnSync) {
                    continue;
                }

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

export async function syncKnockouts(knockouts: PersistedKnockout[]): Promise<void> {
    if (knockouts.length === 0) {
        return;
    }

    const latestBySourceEventId = new Map<string, PersistedKnockout>();
    for (const knockout of knockouts) {
        const sourceEventId = knockout.sourceEventId.trim();
        const mapId = knockout.mapId.trim();
        const victimUid = knockout.victimUid.trim();
        const attackerUid = knockout.attackerUid.trim();
        const reason = knockout.reason.trim();
        if (!sourceEventId || !mapId || !victimUid || !attackerUid || !reason) {
            continue;
        }
        latestBySourceEventId.set(sourceEventId, {
            sourceEventId,
            mapId,
            victimUid,
            attackerUid,
            reason,
            occurredAt: knockout.occurredAt,
        });
    }

    const normalized = Array.from(latestBySourceEventId.values());
    if (normalized.length === 0) {
        return;
    }

    const mapIds = Array.from(new Set(normalized.map((knockout) => knockout.mapId)));
    const mapPlaceholders = mapIds.map(() => '(?)').join(', ');
    await pool.query(
        `INSERT IGNORE INTO map_sessions (id) VALUES ${mapPlaceholders}`,
        mapIds
    );

    const placeholders = normalized.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const values: Array<string | Date> = [];
    for (const knockout of normalized) {
        values.push(
            knockout.sourceEventId,
            knockout.mapId,
            knockout.victimUid,
            knockout.attackerUid,
            knockout.reason,
            knockout.occurredAt
        );
    }

    await pool.query(
        `INSERT IGNORE INTO knockouts
        (source_event_id, map_id, victim_uid, attacker_uid, reason, occurred_at)
        VALUES ${placeholders}`,
        values
    );
}
