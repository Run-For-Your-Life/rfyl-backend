//How to get proccesss.env variables
import dotenv from 'dotenv';
dotenv.config();

//Dependencies here
import express from 'express';
import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { swaggerUi, specs } from './config/swaggerConfig.js';

//Routes here

//Middleware here
import { requestLogger, errorLogger } from './middleware/index.js';

const app = express();
app.use(express.json());

app.use(cors({
    origin: '*', //for testing
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(requestLogger);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use(errorLogger);
//Final error handler middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Server is runningo n port ${PORT}`);
})