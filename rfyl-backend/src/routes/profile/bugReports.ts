import { Router, Request, Response, NextFunction } from 'express';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { firebaseAuth } from '../../config/firebaseAdmin.js';
import pool from '../../db/dbclient.js';
import { HttpError, parseBearerToken, toHttpError } from '../auth/shared.js';

type BugReportBody = {
  title?: unknown;
  description?: unknown;
  steps?: unknown;
  expected?: unknown;
  actual?: unknown;
  device?: unknown;
  logs?: unknown;
  occurredAt?: unknown;
};

type BugReportRow = RowDataPacket & {
  id: number;
  firebase_uid: string;
  issue: string;
  occurred_at: Date | null;
  created_at: Date | null;
};

const toTrimmedString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const toOptionalTrimmedString = (value: unknown): string | null => {
  const trimmed = toTrimmedString(value);
  return trimmed.length > 0 ? trimmed : null;
};

const toMySqlDateTime = (raw: string): string | null => {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

export const createBugReportsRouter = () => {
  const router = Router();

  router.post('/bug-reports', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idToken = parseBearerToken(req);
      if (!idToken) {
        const authError = new Error('Authentication token is required') as HttpError;
        authError.status = 401;
        throw authError;
      }

      const decoded = await firebaseAuth.verifyIdToken(idToken);
      const firebaseUid = toTrimmedString(decoded.uid);
      if (!firebaseUid) {
        const authError = new Error('Invalid authentication token') as HttpError;
        authError.status = 401;
        throw authError;
      }

      const body = (req.body ?? {}) as BugReportBody;
      const title = toTrimmedString(body.title);
      const description = toTrimmedString(body.description);
      const steps = toTrimmedString(body.steps);
      const expected = toTrimmedString(body.expected);
      const actual = toTrimmedString(body.actual);
      const device = toOptionalTrimmedString(body.device);
      const logs = toOptionalTrimmedString(body.logs);
      const occurredAtInput = toOptionalTrimmedString(body.occurredAt);

      if (!title || !description || !steps || !expected || !actual) {
        const validationError = new Error('title, description, steps, expected, and actual are required') as HttpError;
        validationError.status = 400;
        throw validationError;
      }

      const issueParts = [
        `Title: ${title}`,
        `Description: ${description}`,
        `Steps: ${steps}`,
        `Expected: ${expected}`,
        `Actual: ${actual}`,
      ];
      if (device) issueParts.push(`Device: ${device}`);
      if (logs) issueParts.push(`Logs: ${logs}`);
      const issue = issueParts.join('\n');

      if (issue.length > 1024) {
        const lengthError = new Error('Bug report is too long for storage. Please shorten logs/details.') as HttpError;
        lengthError.status = 400;
        throw lengthError;
      }

      let occurredAt: string | null = null;
      if (occurredAtInput) {
        occurredAt = toMySqlDateTime(occurredAtInput);
        if (!occurredAt) {
          const dateError = new Error('occurredAt must be a valid ISO date string') as HttpError;
          dateError.status = 400;
          throw dateError;
        }
      }

      const [result] = await pool.execute<ResultSetHeader>(
        'INSERT INTO bug_report (firebase_uid, issue, occurred_at) VALUES (?, ?, ?)',
        [firebaseUid, issue, occurredAt]
      );

      const [rows] = await pool.query<BugReportRow[]>(
        'SELECT id, firebase_uid, issue, occurred_at, created_at FROM bug_report WHERE id = ? LIMIT 1',
        [result.insertId]
      );
      const saved = rows[0];

      res.status(201).json({
        ok: true,
        report: {
          id: saved?.id ?? result.insertId,
          firebaseUid: saved?.firebase_uid ?? firebaseUid,
          issue: saved?.issue ?? issue,
          title,
          description,
          steps,
          expected,
          actual,
          device,
          logs,
          occurredAt: saved?.occurred_at ?? occurredAt,
          createdAt: saved?.created_at ?? null,
        },
      });
    } catch (err: unknown) {
      const error = toHttpError(err, 'Failed to submit bug report');
      error.status = error.status ?? 500;
      next(error);
    }
  });

  return router;
};

const router = createBugReportsRouter();
export default router;
