import { Router, Request, Response, NextFunction } from 'express';

import { getLeaderboard } from '../../db/leaderboard.js';

const router = Router();

interface HttpError extends Error {
  status?: number;
}

/**
 * GET /api/leaderboard/leaderboard?week_id=1&match_id=1
 *
 * Query params:
 *   - week_id (required, number)
 *   - match_id (optional, number)
 */
router.get(
  '/leaderboard',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const weekIdParam = req.query.week_id;
      const matchIdParam = req.query.match_id;

      if (!weekIdParam) {
        const err: HttpError = new Error('week_id query parameter is required');
        err.status = 400;
        throw err;
      }

      const weekId = Number(weekIdParam);
      const matchId =
        matchIdParam !== undefined ? Number(matchIdParam) : undefined;

      if (Number.isNaN(weekId)) {
        const err: HttpError = new Error('week_id must be a number');
        err.status = 400;
        throw err;
      }

      if (matchIdParam !== undefined && Number.isNaN(matchId)) {
        const err: HttpError = new Error(
          'match_id must be a number if provided'
        );
        err.status = 400;
        throw err;
      }

      const leaderboard = await getLeaderboard(weekId, matchId);

      res.json({
        week_id: weekId,
        match_id: matchId ?? null,
        leaderboard,
      });
    } catch (error) {
      const err = error as HttpError;
      err.status = err.status ?? 500;
      next(err);
    }
  }
);

export default router;
