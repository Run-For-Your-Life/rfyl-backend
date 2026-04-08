//Library imports here
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';

//Config here
// import './config/env.js';
import { getEnv } from './config/env.js';
import { swaggerUi, specs } from './config/swaggerConfig';
//Middleware here
import { requestLogger, errorLogger } from './middleware/index';
//Routes here
import authRoutes from './routes/auth/index.js';
import leaderboardRoutes from './routes/leaderboard/index.js';
import mapsRoutes from './routes/maps/index.js';
import profileRoutes from './routes/profile/index.js';
//Services here
import { startRealtimeWalFlusher, stopRealtimeWalFlusher } from './services/realtimePersistence.js';
import {
  startWeeklyTerritoryResetScheduler,
  stopWeeklyTerritoryResetScheduler,
} from './services/weeklyTerritoryReset.js';

const app = express();
app.use(express.json());

const allowedOrigins = getEnv('ALLOWED_ORIGINS', '').split(',').map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) {
            return callback(null, true);
        }
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));

app.use(requestLogger);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/maps', mapsRoutes);

app.use(errorLogger);
//Final error handler middleware
type HttpError = {
  status?: number;
  message?: string;
};

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const { status, message } = isHttpError(err) ? err : {};
  res.status(status ?? 500).json({ error: message ?? 'Internal Server Error' });
});

function isHttpError(value: unknown): value is HttpError {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('status' in value || 'message' in value)
  );
}

const PORT = process.env.PORT || 1000;
const server = app.listen(PORT, () => {
  console.warn(`Server is running on port ${PORT}`);
  startRealtimeWalFlusher();
  startWeeklyTerritoryResetScheduler();
});

const shutdown = async () => {
  stopWeeklyTerritoryResetScheduler();
  await stopRealtimeWalFlusher();
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});
