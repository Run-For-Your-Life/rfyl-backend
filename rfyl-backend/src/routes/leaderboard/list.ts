// src/routes/leaderboard/list.ts
import { Router, Request, Response, NextFunction } from 'express';

import { getLeaderboard } from '../../db/leaderboard.js';

const router = Router();

interface HttpError extends Error {
  status?: number;
}

/**
 * Parse a numeric query parameter or throw an HttpError if invalid.
 *
 * @param name - the query parameter name (e.g. "week_id")
 * @param value - the raw query value from req.query
 * @param required - whether the parameter is required
 * @returns the parsed number, or undefined if not required and missing
 */
function parseQueryNumber(
  name: string,
  value: unknown,
  required: boolean
): number | undefined {
  // Missing value
  if (value === undefined || value === null || value === '') {
    if (required) {
      const err: HttpError = new Error(`${name} query parameter is required`);
      err.status = 400;
      throw err;
    }
    return undefined;
  }

  // Normalize the value to a single string (in case of array)
  const asString = Array.isArray(value) ? String(value[0]) : String(value);
  const asNumber = Number(asString);

  if (Number.isNaN(asNumber)) {
    const err: HttpError = new Error(`${name} must be a number`);
    err.status = 400;
    throw err;
  }

  return asNumber;
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
      const weekId = parseQueryNumber('week_id', req.query.week_id, true)!;
      const matchId = parseQueryNumber('match_id', req.query.match_id, false);

      const leaderboard = await getLeaderboard(weekId, matchId ?? null);

      res.json({
        week_id: weekId,
        match_id: matchId ?? null,
        leaderboard,
      });
    } catch (error: unknown) {
      const err = error as HttpError;
      err.status = err.status ?? 500;
      next(err);
    }
  }
);

export default router;
