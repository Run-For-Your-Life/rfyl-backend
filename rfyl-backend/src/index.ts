//Native imports here
import path from 'path';

//Library imports here
import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response, NextFunction } from 'express';

//Confit here
import { swaggerUi, specs } from './config/swaggerConfig';
//Middleware here
import { requestLogger, errorLogger } from './middleware/index';
//Routes here
import authRoutes from './routes/auth/index.js';
import profileRoutes from './routes/profile/index.js';

const envPath = path.resolve(__dirname, '../../.env');
const envResult = dotenv.config({ path: envPath });

if (envResult.error) {
  dotenv.config();
}

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
app.use('/api/profile', profileRoutes);

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
    console.log(`Server is running on port ${PORT}`);
})
