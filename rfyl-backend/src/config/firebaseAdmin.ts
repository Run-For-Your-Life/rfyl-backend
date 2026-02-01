import fs from 'node:fs';

import admin from 'firebase-admin';

import { getEnv, requireEnv } from './env.js';

const loadServiceAccount = (): admin.ServiceAccount => {
  const credentials = getEnv('FIREBASE_CREDENTIALS');
  if (credentials) {
    try {
      return JSON.parse(credentials) as admin.ServiceAccount;
    } catch {
      const raw = fs.readFileSync(credentials, 'utf-8');
      return JSON.parse(raw) as admin.ServiceAccount;
    }
  }

  const projectId = requireEnv('FIREBASE_PROJECT_ID');
  const clientEmail = requireEnv('FIREBASE_CLIENT_EMAIL');
  const privateKey = requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  return { projectId, clientEmail, privateKey };
};

const ensureInitialized = () => {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const serviceAccount = loadServiceAccount();
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
};

export const firebaseAdmin = ensureInitialized();
export const firebaseAuth = firebaseAdmin.auth();
