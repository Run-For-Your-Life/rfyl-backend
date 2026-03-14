import { RowDataPacket } from 'mysql2/promise';

import type { RunDistanceSample } from '../routes/maps/handlers/locations.js';

import pool from './dbclient.js';

const DISTANCE_SOURCE = 'realtime_locations';

export async function persistRunDistanceSample(sample: RunDistanceSample): Promise<void> {
  const userUid = sample.userUid.trim();
  const mapId = sample.mapId.trim();
  const distanceMeters = Number(sample.distanceMeters);
  if (!userUid || !mapId || !Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return;
  }

  const startedAt = toSafeDate(sample.startedAtMs);
  const endedAt = toSafeDate(sample.endedAtMs);
  const normalizedEndedAt = endedAt >= startedAt ? endedAt : startedAt;
  const routeGeoJson = JSON.stringify({
    type: 'LineString',
    coordinates: normalizeCoordinates(sample.pathCoordinates),
  });

  const connection = await pool.getConnection();
  try {
    //Validate existing user and map row, then save this run in one transaction.
    await connection.beginTransaction();

    const [user_rows] = await connection.query<(RowDataPacket & { firebase_uid: string })[]>(
      'SELECT firebase_uid FROM users WHERE firebase_uid = ? LIMIT 1',
      [userUid]
    );
    if (user_rows.length === 0) {
      throw new Error(`unknown user for run distance sample: ${userUid}`);
    }
    await connection.execute('INSERT IGNORE INTO map_sessions (id) VALUES (?)', [mapId]);

    await connection.execute(
      `INSERT INTO runs
       (user_uid, map_id, started_at, ended_at, distance_m, route_geojson, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userUid, mapId, startedAt, normalizedEndedAt, distanceMeters, routeGeoJson, DISTANCE_SOURCE]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function toSafeDate(value: number): Date {
  const ms = Number(value);
  if (!Number.isFinite(ms)) {
    return new Date();
  }
  const parsed = new Date(ms);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeCoordinates(value: number[][]): number[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  const output: number[][] = [];
  for (const coordinate of value) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      continue;
    }
    const lng = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      continue;
    }
    output.push([lng, lat]);
  }
  return output;
}
