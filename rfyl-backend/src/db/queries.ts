import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from './dbclient.js';

export type UserRecord = {
    id: number;
    username: string;
    email: string;
    createdAt: Date;
    totalDistanceM: number;
    weeklyFlair: boolean;
};

type UserRow = RowDataPacket & {
    id: number;
    username: string;
    email: string;
    created_at: Date;
    total_distance_m: number;
    weekly_flair: number;
};

const mapUserRow = (row: UserRow): UserRecord => ({
    id: row.id,
    username: row.username,
    email: row.email,
    createdAt: row.created_at,
    totalDistanceM: row.total_distance_m,
    weeklyFlair: Boolean(row.weekly_flair),
});

export const findUserByEmail = async (email: string): Promise<UserRecord | null> => {
    const [rows] = await pool.query<UserRow[]>(
        'SELECT id, username, email, created_at, total_distance_m, weekly_flair FROM users WHERE email = ? LIMIT 1',
        [email]
    );

    return rows[0] ? mapUserRow(rows[0]) : null;
};

export const insertUser = async (username: string, email: string): Promise<UserRecord> => {
    const [result] = await pool.execute<ResultSetHeader>(
        'INSERT INTO users (username, email) VALUES (?, ?)',
        [username, email]
    );

    const [rows] = await pool.query<UserRow[]>(
        'SELECT id, username, email, created_at, total_distance_m, weekly_flair FROM users WHERE id = ? LIMIT 1',
        [result.insertId]
    );

    if (!rows[0]) {
        return {
            id: result.insertId,
            username,
            email,
            createdAt: new Date(),
            totalDistanceM: 0,
            weeklyFlair: false,
        };
    }

    return mapUserRow(rows[0]);
};
