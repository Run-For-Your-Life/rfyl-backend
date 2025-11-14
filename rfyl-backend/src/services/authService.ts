import crypto from 'node:crypto';
import { findUserByEmail, insertUser, UserRecord } from '../db/queries.js';

export type PublicUser = {
    id: number;
    email: string;
    createdAt: Date;
};

const ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const SALT_BYTES = 16;

const toPublicUser = (user: UserRecord): PublicUser => ({
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
});

const hashPassword = (password: string, salt?: string): { salt: string; hash: string } => {
    const resolvedSalt = salt ?? crypto.randomBytes(SALT_BYTES).toString('hex');
    const derived = crypto
        .pbkdf2Sync(password, resolvedSalt, ITERATIONS, KEY_LENGTH, DIGEST)
        .toString('hex');

    return { salt: resolvedSalt, hash: derived };
};

const serializeHash = ({ salt, hash }: { salt: string; hash: string }): string =>
    `${salt}:${hash}`;

const verifyPassword = (password: string, stored: string): boolean => {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) {
        return false;
    }

    const verification = hashPassword(password, salt);

    return crypto.timingSafeEqual(
        Buffer.from(verification.hash, 'hex'),
        Buffer.from(hash, 'hex')
    );
};

export const registerUser = async (email: string, password: string): Promise<PublicUser> => {
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
        const error = new Error('Email already in use');
        (error as Error & { status?: number }).status = 409;
        throw error;
    }

    const passwordHash = serializeHash(hashPassword(password));
    const newUser = await insertUser(email, passwordHash);
    return toPublicUser(newUser);
};

export const authenticateUser = async (email: string, password: string): Promise<PublicUser> => {
    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
        const error = new Error('Invalid email or password');
        (error as Error & { status?: number }).status = 401;
        throw error;
    }

    return toPublicUser(user);
};
