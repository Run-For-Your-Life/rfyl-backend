// src/db/leaderboard.ts
import { RowDataPacket } from 'mysql2/promise';

import pool from './dbclient.js';

export type LeaderboardRecord = {
  userId: number;
  username: string;
  totalAreaM2: number;
  rank: number;
};

type LeaderboardRow = RowDataPacket & {
  user_id: number;
  firebase_uid: string;
  total_area_m2: number;
  rank_position: number;
};

const mapLeaderboardRow = (row: LeaderboardRow): LeaderboardRecord => ({
  userId: row.user_id,
  // Keep API shape stable while using Firebase UID as the canonical identity.
  username: row.firebase_uid,
  totalAreaM2: row.total_area_m2,
  rank: row.rank_position,
});

async function queryLeaderboard(
  whereSql: string,
  whereParams: Array<number | string | null>,
  limit: number
): Promise<LeaderboardRecord[]> {
  const sql = `
    SELECT 
      u.id AS user_id,
      u.firebase_uid,
      SUM(t.area_m2) AS total_area_m2,
      RANK() OVER (
        ORDER BY SUM(t.area_m2) DESC, u.id ASC
      ) AS rank_position
    FROM territories t
    JOIN users u ON u.firebase_uid = t.owner_uid
    WHERE ${whereSql}
    GROUP BY u.id, u.firebase_uid
    ORDER BY total_area_m2 DESC, user_id ASC
    LIMIT ?
  `;

  const [rows] = await pool.query<LeaderboardRow[]>(sql, [...whereParams, limit]);
  return rows.map(mapLeaderboardRow);
}

async function queryUserRank(
  whereSql: string,
  whereParams: Array<number | string | null>,
  userId: number
): Promise<LeaderboardRecord | null> {
  const sql = `
    WITH ranked AS (
      SELECT
        u.id AS user_id,
        u.firebase_uid,
        SUM(t.area_m2) AS total_area_m2,
        RANK() OVER (
          ORDER BY SUM(t.area_m2) DESC, u.id ASC
        ) AS rank_position
      FROM territories t
      JOIN users u ON u.firebase_uid = t.owner_uid
      WHERE ${whereSql}
      GROUP BY u.id, u.firebase_uid
    )
    SELECT user_id, firebase_uid, total_area_m2, rank_position
    FROM ranked
    WHERE user_id = ?
    LIMIT 1
  `;

  const [rows] = await pool.query<LeaderboardRow[]>(sql, [...whereParams, userId]);
  return rows[0] ? mapLeaderboardRow(rows[0]) : null;
}

/**
 * Fetch leaderboard for a given week and optional match.
 * If matchId is null/undefined, we aggregate across all matches for that week.
 */
export async function getLeaderboard(
  weekId: number,
  matchId?: number | null
): Promise<LeaderboardRecord[]> {
  return queryLeaderboard('t.week_id = ? AND (t.match_id = ? OR ? IS NULL)', [weekId, matchId ?? null, matchId ?? null], 100);
}

export async function getMapLeaderboard(mapId: string, limit = 100): Promise<LeaderboardRecord[]> {
  return queryLeaderboard('t.map_id = ?', [mapId], limit);
}

export async function getGlobalLeaderboard(limit = 100): Promise<LeaderboardRecord[]> {
  return queryLeaderboard('1 = 1', [], limit);
}

export async function getMapLeaderboardForUser(mapId: string, userId: number): Promise<LeaderboardRecord | null> {
  return queryUserRank('t.map_id = ?', [mapId], userId);
}

export async function getGlobalLeaderboardForUser(userId: number): Promise<LeaderboardRecord | null> {
  return queryUserRank('1 = 1', [], userId);
}
