import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import pool from '../db/dbclient.js';

export type SyncedUser = {
  firebaseUid: string;
  username: string;
  createdAt: Date | null;
  created: boolean;
};

type UserRow = RowDataPacket & {
  firebase_uid: string;
  username?: string | null;
  created_at?: Date | null;
};

const MAX_USERNAME_LENGTH = 128;

const normalizeUsername = (firebaseUid: string, preferredUsername?: string): string => {
  const trimmed = typeof preferredUsername === 'string' ? preferredUsername.trim() : '';
  const selected = trimmed || firebaseUid;
  return selected.slice(0, MAX_USERNAME_LENGTH);
};

const findByFirebaseUid = async (firebaseUid: string): Promise<SyncedUser | null> => {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT firebase_uid, username, created_at FROM users WHERE firebase_uid = ? LIMIT 1',
    [firebaseUid]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const rowUsername =
    typeof row.username === 'string' && row.username.trim().length > 0
      ? row.username
      : normalizeUsername(row.firebase_uid);
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
  const normalizedUsername = normalizeUsername(firebaseUid, preferredUsername);
  const existing = await findByFirebaseUid(firebaseUid);
  if (existing) {
    if (updateExistingUsername && existing.username !== normalizedUsername) {
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

  const created = await findByFirebaseUid(firebaseUid);
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
