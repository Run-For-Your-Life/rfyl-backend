import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import pool from '../db/dbclient.js';

export type SyncedUser = {
  firebaseUid: string;
  createdAt: Date | null;
  created: boolean;
};

type UserRow = RowDataPacket & {
  firebase_uid: string;
  created_at?: Date | null;
};

const findByFirebaseUid = async (firebaseUid: string): Promise<SyncedUser | null> => {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT firebase_uid, created_at FROM users WHERE firebase_uid = ? LIMIT 1',
    [firebaseUid]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    firebaseUid: row.firebase_uid,
    createdAt: row.created_at ?? null,
    created: false,
  };
};

export const ensureUserByFirebaseUid = async (firebaseUid: string): Promise<SyncedUser> => {
  const existing = await findByFirebaseUid(firebaseUid);
  if (existing) {
    return existing;
  }

  try {
    await pool.execute<ResultSetHeader>(
      'INSERT INTO users (firebase_uid) VALUES (?)',
      [firebaseUid]
    );
  } catch (error) {
    const sqlError = error as { code?: string };
    if (sqlError.code !== 'ER_DUP_ENTRY') {
      throw error;
    }
  }

  const created = await findByFirebaseUid(firebaseUid);
  if (created) {
    return { ...created, created: true };
  }

  return {
    firebaseUid,
    createdAt: null,
    created: true,
  };
};
