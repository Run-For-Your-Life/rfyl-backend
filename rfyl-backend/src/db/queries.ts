import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import pool from './dbclient.js';

export type UserRecord = {
    id: number;
    username: string;
    email: string;
    passwordHash: string;
    createdAt: Date;
};

type UserRow = RowDataPacket & {
    id: number;
    username: string;
    email: string;
    password_hash: string;
    created_at: Date;
};

const mapUserRow = (row: UserRow): UserRecord => ({
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
});

export const findUserByEmail = async (email: string): Promise<UserRecord | null> => {
    const [rows] = await pool.query<UserRow[]>(
        'SELECT id, username, email, password_hash, created_at FROM users WHERE email = ? LIMIT 1',
        [email]
    );

    return rows[0] ? mapUserRow(rows[0]) : null;
};

export const findUserByUsername = async (username: string): Promise<UserRecord | null> => {
    const [rows] = await pool.query<UserRow[]>(
        'SELECT id, username, email, password_hash, created_at FROM users WHERE username = ? LIMIT 1',
        [username]
    );

    return rows[0] ? mapUserRow(rows[0]) : null;
};

export const insertUser = async (username: string, email: string, passwordHash: string): Promise<UserRecord> => {
    const [result] = await pool.execute<ResultSetHeader>(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        [username, email, passwordHash]
    );

    const [rows] = await pool.query<UserRow[]>(
        'SELECT id, username, email, password_hash, created_at FROM users WHERE id = ? LIMIT 1',
        [result.insertId]
    );

    if (!rows[0]) {
        return {
            id: result.insertId,
            username,
            email,
            passwordHash,
            createdAt: new Date(),
        };
    }

    return mapUserRow(rows[0]);
};
