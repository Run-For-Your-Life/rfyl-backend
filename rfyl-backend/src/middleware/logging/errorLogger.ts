import fs from 'fs';
import path from 'path';

import type { ErrorRequestHandler } from 'express';

const errorFilePath = path.join(process.cwd(), 'error.log');
const FALLBACK_MESSAGE = 'Unknown error occurred';

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const stack = 'stack' in error && typeof (error as { stack?: unknown }).stack === 'string'
      ? (error as { stack: string }).stack
      : undefined;

    const message = 'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : undefined;

    return stack ?? message ?? FALLBACK_MESSAGE;
  }

  return FALLBACK_MESSAGE;
};

export const errorLogger: ErrorRequestHandler = (err, req, _res, next) => {
  const timestamp = new Date().toISOString();
  const errorEntry = `[${timestamp}] ${req.method} ${req.url}\n${extractErrorMessage(err)}\n\n`;

  fs.appendFile(errorFilePath, errorEntry, appendError => {
    if (appendError) console.error('Failed to write to error log:', appendError);
  });

  next(err);
};
