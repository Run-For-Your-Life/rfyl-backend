import { findUserByEmail, insertUser, UserRecord } from '../db/queries.js';

export type PublicUser = {
    id: number;
    username: string;
    email: string;
    createdAt: Date;
    totalDistanceM: number;
    weeklyFlair: boolean;
};

const toPublicUser = (user: UserRecord): PublicUser => ({
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
    totalDistanceM: user.totalDistanceM,
    weeklyFlair: user.weeklyFlair,
});

export const registerUser = async (username: string, email: string): Promise<PublicUser> => {
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
        const error = new Error('Email already in use');
        (error as Error & { status?: number }).status = 409;
        throw error;
    }

    const newUser = await insertUser(username, email);
    return toPublicUser(newUser);
};

export const authenticateUser = async (email: string, username?: string): Promise<PublicUser> => {
    const user = await findUserByEmail(email);
    if (!user) {
        const error = new Error('Invalid email or username');
        (error as Error & { status?: number }).status = 401;
        throw error;
    }

    if (username && user.username !== username) {
        const error = new Error('Invalid email or username');
        (error as Error & { status?: number }).status = 401;
        throw error;
    }

    return toPublicUser(user);
};
