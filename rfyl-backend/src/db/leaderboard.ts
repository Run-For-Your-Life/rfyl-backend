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
  username: string;
  total_area_m2: number;
  rank: number;
};

/**
 * Fetch leaderboard for a given week and optional match.
 * If matchId is null/undefined, we aggregate across all matches for that week.
 */
export async function getLeaderboard(
  weekId: number,
  matchId?: number | null
): Promise<LeaderboardRecord[]> {
  const sql = `
    SELECT 
      u.id AS user_id,
      u.username,
      SUM(t.area_m2) AS total_area_m2,
      RANK() OVER (ORDER BY SUM(t.area_m2) DESC) AS rank
    FROM territories t
    JOIN users u ON u.id = t.owner_id
    WHERE t.week_id = ?
      AND (t.match_id = ? OR ? IS NULL)
    GROUP BY u.id, u.username
    ORDER BY total_area_m2 DESC
  `;

  const params = [weekId, matchId ?? null, matchId ?? null];

  const [rows] = await pool.execute<LeaderboardRow[]>(sql, params);

  // Map snake_case DB columns... This give a nice API shape
  return rows.map(row => ({
    userId: row.user_id,
    username: row.username,
    totalAreaM2: row.total_area_m2,
    rank: row.rank,
  }));
}
