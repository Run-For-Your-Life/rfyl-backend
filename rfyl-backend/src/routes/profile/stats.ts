import { Router, Request, Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2/promise';

import pool from '../../db/dbclient.js';

const METERS_PER_MILE = 1609.344;

type StatRow = RowDataPacket & {
  total?: number | null;
};

type RankRow = RowDataPacket & {
  rank_position?: number | null;
};

type UserUidRow = RowDataPacket & {
  firebase_uid?: string | null;
};

export const createProfileStatsRouter = () => {
  const router = Router();

  router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userIdParam = String(req.query.userId ?? '').trim();
      const userUidParam = String(req.query.userUid ?? '').trim();
      if (!userIdParam && !userUidParam) {
        res.status(400).json({ error: 'userId or userUid is required' });
        return;
      }

      let userUid = userUidParam;
      if (!userUid) {
        const userId = Number(userIdParam);
        if (!Number.isFinite(userId)) {
          res.status(400).json({ error: 'userId must be a number' });
          return;
        }
        const [[uidRow]] = await pool.query<UserUidRow[]>(
          'SELECT firebase_uid FROM users WHERE id = ?',
          [userId]
        );
        userUid = uidRow?.firebase_uid ?? '';
        if (!userUid) {
          res.status(404).json({ error: 'user not found' });
          return;
        }
      }

      const [[runsRow]] = await pool.query<StatRow[]>(
        'SELECT SUM(distance_m) AS total FROM runs WHERE user_uid = ?',
        [userUid]
      );
      const [[territoryRow]] = await pool.query<StatRow[]>(
        'SELECT SUM(area_m2) AS total FROM territories WHERE owner_uid = ?',
        [userUid]
      );
      const [[knockoutsRow]] = await pool.query<StatRow[]>(
        'SELECT COUNT(*) AS total FROM knockouts WHERE attacker_uid = ?',
        [userUid]
      );

      const [[rankRow]] = await pool.query<RankRow[]>(
        `
        WITH ranked AS (
          SELECT
            user_uid,
            SUM(distance_m) AS total_distance,
            RANK() OVER (ORDER BY SUM(distance_m) DESC, user_uid ASC) AS rank_position
          FROM runs
          GROUP BY user_uid
        )
        SELECT rank_position
        FROM ranked
        WHERE user_uid = ?
        LIMIT 1
        `,
        [userUid]
      );

      const milesRun = (runsRow?.total ?? 0) / METERS_PER_MILE;

      res.json({
        milesRun,
        territoryCovered: territoryRow?.total ?? 0,
        playersDefeated: knockoutsRow?.total ?? 0,
        rank: rankRow?.rank_position ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

const router = createProfileStatsRouter();
export default router;
