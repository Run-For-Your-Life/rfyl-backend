import fs from 'fs';
import path from 'path';

import { Request, Response, NextFunction } from 'express';

const logFilePath = path.join(process.cwd(), 'request.log');

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${req.method} ${req.url} ${JSON.stringify(req.body)}\n`;

  fs.appendFile(logFilePath, logEntry, err => {
    if (err) console.error('Failed to write to req log:', err);
  });

  next();
}