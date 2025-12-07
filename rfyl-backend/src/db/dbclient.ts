import mysql, { PoolOptions } from 'mysql2/promise';

import { getEnv, getNumberEnv, requireEnv } from '../config/env.js';

const connectionLimit = getNumberEnv('DB_CONNECTION_LIMIT', 5) ?? 5;
const socketPath = getEnv('DB_SOCKET_PATH');

const poolConfig: PoolOptions = {
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
    waitForConnections: true,
    connectionLimit,
};

if (socketPath) {
    poolConfig.socketPath = socketPath;
} else {
    poolConfig.host = getEnv('DB_HOST', '127.0.0.1');
    poolConfig.port = getNumberEnv('DB_PORT', 3306);
}

const pool = mysql.createPool(poolConfig);

export default pool;
