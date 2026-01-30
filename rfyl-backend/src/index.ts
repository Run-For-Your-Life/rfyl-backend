//Library imports here
import cors from 'cors';
import express, { Request, Response, NextFunction } from 'express';

//Config here
import './config/env.js';
import { swaggerUi, specs } from './config/swaggerConfig';
//Middleware here
import { requestLogger, errorLogger, requireAuth } from './middleware/index';
//Routes here
import authRoutes from './routes/auth/index.js';
import leaderboardRoutes from './routes/leaderboard/index.js';
import profileRoutes from './routes/profile/index.js';
import mapsRoutes from './routes/maps/index.js';

const app = express();
app.use(express.json());

app.use(cors({
    origin: '*', //for testing
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(requestLogger);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
app.use('/api/auth', authRoutes);
app.use('/api/profile', requireAuth, profileRoutes);
app.use('/api/leaderboard', requireAuth, leaderboardRoutes);

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
app.listen(PORT, () => {
  console.warn(`Server is running on port ${PORT}`);
})
