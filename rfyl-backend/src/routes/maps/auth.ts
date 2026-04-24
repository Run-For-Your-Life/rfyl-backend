import { timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { getEnv } from '../../config/env';
import { getUsernameByFirebaseUid } from '../../services/authIdentityCache.js';

export type VerifiedIdentityToken = {
  uid: string;
  name?: string;
  email?: string;
};

export type VerifyIdTokenFn = (idToken: string) => Promise<VerifiedIdentityToken>;
export type ResolveUsernameFn = (decoded: VerifiedIdentityToken) => Promise<string | null>;

export type AuthIdentity = {
  userUid: string;
  username: string;
};

export type AuthenticatedRequest = Request & {
  auth: AuthIdentity;
};

export type AuthenticatedRouteOptions = {
  verifyIdToken?: VerifyIdTokenFn;
  resolveUsername?: ResolveUsernameFn;
};

export const defaultVerifyIdToken: VerifyIdTokenFn = async (idToken) => {
  const { firebaseAuth } = await import('../../config/firebaseAdmin.js');
  const decoded = await firebaseAuth.verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    ...(typeof decoded.name === 'string' ? { name: decoded.name } : {}),
    ...(typeof decoded.email === 'string' ? { email: decoded.email } : {}),
  };
};

export function createAuthenticatedRequestMiddleware(options: AuthenticatedRouteOptions = {}): RequestHandler {
  const verifyIdToken = options.verifyIdToken ?? defaultVerifyIdToken;
  const resolveUsername = options.resolveUsername ?? (async (decoded: VerifiedIdentityToken) =>
    getUsernameByFirebaseUid(decoded.uid)
  );

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idToken = extractIdToken(req);
      if (!idToken) {
        res.status(401).json({ error: 'missing_auth_token' });
        return;
      }
      const decoded = await verifyIdToken(idToken);
      const username = await resolveUsername(decoded);
      if (!username) {
        res.status(403).json({ error: 'user_not_registered' });
        return;
      }
      (req as AuthenticatedRequest).auth = {
        userUid: decoded.uid,
        username,
      };
      next();
    } catch {
      res.status(401).json({ error: 'invalid_auth_token' });
    }
  };
}

export function matchesPassword(providedPassword: string, expectedPassword: string): boolean {
  const provided = Buffer.from(providedPassword);
  const expected = Buffer.from(expectedPassword);
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

export function extractIdToken(req: Request): string | undefined {
  const bearer = parseBearerToken(req);
  if (bearer) {
    return bearer;
  }

  const cookieName = getEnv('SESSION_COOKIE_NAME', 'rfyl_session');
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }
  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const [rawName, ...rest] = cookie.split('=');
    if (rawName?.trim() !== cookieName) {
      continue;
    }
    const value = rest.join('=').trim();
    if (!value) {
      return undefined;
    }
    return decodeURIComponent(value);
  }
  return undefined;
}

export function getRequestedMapId(req: Request): string | undefined {
  return req.params.mapId;
}

export function getResolvedMapId(req: Request): string | undefined {
  return getRequestedMapId(req);
}

export function toTrimmedOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) {
    return undefined;
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }
  return token;
}
