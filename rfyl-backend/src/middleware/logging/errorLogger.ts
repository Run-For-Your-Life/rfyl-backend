import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';

const errorFilePath = path.join(process.cwd(), 'error.log');

export function errorLogger(error: any, req: Request, res: Response, next: NextFunction): void {
  const timestamp = new Date().toISOString();
  const errorEntry = `[${timestamp}] ${req.method} ${req.url}\n${error.stack || error.message || "Unknown Error Occured"}\n\n`;

  fs.appendFile(errorFilePath, errorEntry, err => {
    if (err) console.error('Failed to write to error log:', err);
  });

  next(error);
}