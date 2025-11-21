// src/routes/leaderboard/index.ts
import { Router } from 'express';
import listRoute from './list.js';

const router = Router();

router.use(listRoute);

export default router;
