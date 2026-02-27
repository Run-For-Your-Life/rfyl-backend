import type { Request } from 'express';

export interface HttpError extends Error {
  status?: number;
}

export const toHttpError = (error: unknown, fallbackMessage: string): HttpError => {
  if (error instanceof Error) {
    return error as HttpError;
  }
  return new Error(fallbackMessage);
};

export const parseBearerToken = (req: Request): string | undefined => {
  const header = req.headers.authorization;
  if (!header) {
    return undefined;
  }

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }

  return token;
};
