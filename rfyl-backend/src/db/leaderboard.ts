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
      SUM(t.area_m2) AS total_area_m2
    FROM territories t
    JOIN users u ON u.id = t.owner_id
    WHERE t.week_id = ?
      AND (t.match_id = ? OR ? IS NULL)
    GROUP BY u.id, u.username
    ORDER BY total_area_m2 DESC, user_id ASC
  `;

  const params = [weekId, matchId ?? null, matchId ?? null];

  const [rows] = await pool.execute<LeaderboardRow[]>(sql, params);

  // Sort + assign rank in application code so we don't depend on SQL window functions
  const sorted = rows.sort((a, b) => {
    if (b.total_area_m2 !== a.total_area_m2) {
      return b.total_area_m2 - a.total_area_m2;
    }
    return a.user_id - b.user_id;
  });

  return sorted.map((row, index) => ({
    userId: row.user_id,
    username: row.username,
    totalAreaM2: row.total_area_m2,
    rank: index + 1,
  }));
}
