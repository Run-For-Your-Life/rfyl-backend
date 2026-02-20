import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

const projectRoot = path.resolve(__dirname, '..', '..');

const profile = process.env.ENV_PROFILE?.trim();
const profileCandidates = profile
    ? [
          `.env.${profile}.local`,
          `../.env.${profile}.local`,
          `.env.${profile}`,
          `../.env.${profile}`,
      ]
    : [];

const candidateEnvFiles = [
    process.env.ENV_FILE,
    ...profileCandidates,
    '.env.local',
    '../.env.local',
    '.env',
    '../.env',
].filter(Boolean) as string[];

let loaded = false;

for (const candidate of candidateEnvFiles) {
    const resolvedCandidates = resolveCandidatePaths(candidate);
    for (const resolvedPath of resolvedCandidates) {
        if (!fs.existsSync(resolvedPath)) {
            continue;
        }

        const result = dotenv.config({ path: resolvedPath });
        if (!result.error) {
            loaded = true;
            break;
        }
    }
    if (loaded) {
        break;
    }
}

if (!loaded) {
    dotenv.config();
}

export function getEnv(key: string): string | undefined;
export function getEnv(key: string, fallback: string): string;
export function getEnv(key: string, fallback?: string): string | undefined {
    const value = process.env[key];
    if (value === undefined || value === '') {
        return fallback;
    }
    return value;
}

export const requireEnv = (key: string): string => {
    const value = getEnv(key);
    if (value === undefined) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};

export function getNumberEnv(key: string): number | undefined;
export function getNumberEnv(key: string, fallback: number): number;
export function getNumberEnv(key: string, fallback?: number): number | undefined {
    const rawValue = getEnv(key);
    if (rawValue === undefined) {
        return fallback;
    }

    const parsed = Number(rawValue);
    if (Number.isNaN(parsed)) {
        if (fallback !== undefined) {
            return fallback;
        }
        throw new Error(`Environment variable ${key} must be a number`);
    }

    return parsed;
}

function resolveCandidatePaths(candidate: string): string[] {
    if (path.isAbsolute(candidate)) {
        return [candidate];
    }

    const fromProjectRoot = path.resolve(projectRoot, candidate);
    const fromCwd = path.resolve(process.cwd(), candidate);

    if (fromProjectRoot === fromCwd) {
        return [fromProjectRoot];
    }
    return [fromProjectRoot, fromCwd];
}
