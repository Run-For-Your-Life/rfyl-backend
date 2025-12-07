import { Router } from 'express';

import listRoute from './list.js';

const router = Router();

router.use(listRoute);

export default router;
