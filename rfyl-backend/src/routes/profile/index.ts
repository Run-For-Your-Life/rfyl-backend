import { Router } from 'express';

import { createProfileStatsRouter } from './stats.js';

export const createProfileRouter = () => {
  const router = Router();

  router.use(createProfileStatsRouter());

  return router;
};

const router = createProfileRouter();
export default router;
