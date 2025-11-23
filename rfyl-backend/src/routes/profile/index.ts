import { Router } from 'express';

import statsRoute from './stats.js';

const router = Router();

router.use(statsRoute);

export default router;