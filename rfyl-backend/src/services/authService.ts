import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import pool from '../db/dbclient.js';

export type SyncedUser = {
  firebaseUid: string;
  username: string;
  createdAt: Date | null;
  created: boolean;
};

export const USERNAME_REQUIRED_FOR_NEW_USER = 'username_required_for_new_user';

type UserRow = RowDataPacket & {
  firebase_uid: string;
  username?: string | null;
  created_at?: Date | null;
};

const MAX_USERNAME_LENGTH = 128;

const normalizeUsername = (preferredUsername?: string): string => {
  const trimmed = typeof preferredUsername === 'string' ? preferredUsername.trim() : '';
  return trimmed.slice(0, MAX_USERNAME_LENGTH);
};

export const findUserByFirebaseUid = async (firebaseUid: string): Promise<SyncedUser | null> => {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT firebase_uid, username, created_at FROM users WHERE firebase_uid = ? LIMIT 1',
    [firebaseUid]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const rowUsername = typeof row.username === 'string' ? row.username.trim().slice(0, MAX_USERNAME_LENGTH) : '';
  return {
    firebaseUid: row.firebase_uid,
    username: rowUsername,
    createdAt: row.created_at ?? null,
    created: false,
  };
};

export const ensureUserByFirebaseUid = async (
  firebaseUid: string,
  preferredUsername?: string,
  updateExistingUsername = false
): Promise<SyncedUser> => {
  const normalizedUsername = normalizeUsername(preferredUsername);
  const existing = await findUserByFirebaseUid(firebaseUid);
  if (existing) {
    if (updateExistingUsername && normalizedUsername.length > 0 && existing.username !== normalizedUsername) {
      await pool.execute<ResultSetHeader>(
        'UPDATE users SET username = ? WHERE firebase_uid = ?',
        [normalizedUsername, firebaseUid]
      );
      return {
        ...existing,
        username: normalizedUsername,
      };
    }
    return existing;
  }

  if (normalizedUsername.length === 0) {
    const error = new Error('username is required for new user sync') as Error & { code?: string };
    error.code = USERNAME_REQUIRED_FOR_NEW_USER;
    throw error;
  }

  let inserted = false;
  try {
    await pool.execute<ResultSetHeader>(
      'INSERT INTO users (firebase_uid, username) VALUES (?, ?)',
      [firebaseUid, normalizedUsername]
    );
    inserted = true;
  } catch (error) {
    const sqlError = error as { code?: string };
    if (sqlError.code !== 'ER_DUP_ENTRY') {
      throw error;
    }
  }

  const created = await findUserByFirebaseUid(firebaseUid);
  if (created) {
    if (updateExistingUsername && created.username !== normalizedUsername) {
      await pool.execute<ResultSetHeader>(
        'UPDATE users SET username = ? WHERE firebase_uid = ?',
        [normalizedUsername, firebaseUid]
      );
      return {
        ...created,
        username: normalizedUsername,
        created: inserted,
      };
    }
    return { ...created, created: inserted };
  }

  return {
    firebaseUid,
    username: normalizedUsername,
    createdAt: null,
    created: inserted,
  };
};
