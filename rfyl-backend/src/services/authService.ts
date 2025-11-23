import bcrypt from 'bcrypt';
import { findUserByEmail, findUserByUsername, insertUser, UserRecord } from '../db/queries.js';

export type PublicUser = {
    id: number;
    username: string;
    email: string;
    createdAt: Date;
};

const toPublicUser = (user: UserRecord): PublicUser => ({
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
});

const SALT_ROUNDS = 10;

export const registerUser = async (username: string, email: string, password: string): Promise<PublicUser> => {
    const [existingEmail, existingUsername] = await Promise.all([
        findUserByEmail(email),
        findUserByUsername(username),
    ]);

    if (existingEmail) {
        const error = new Error('Email already in use');
        (error as Error & { status?: number }).status = 409;
        throw error;
    }

    if (existingUsername) {
        const error = new Error('Username already in use');
        (error as Error & { status?: number }).status = 409;
        throw error;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = await insertUser(username, email, passwordHash);
    return toPublicUser(newUser);
};

export const authenticateUser = async (username: string, password: string): Promise<PublicUser> => {
    const user = await findUserByUsername(username);
    if (!user) {
        const error = new Error('Invalid username or password');
        (error as Error & { status?: number }).status = 401;
        throw error;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        const error = new Error('Invalid username or password');
        (error as Error & { status?: number }).status = 401;
        throw error;
    }

    return toPublicUser(user);
};
