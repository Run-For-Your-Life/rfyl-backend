import { Router } from 'express';

import { createLeaderboardListRouter } from './list.js';

export const createLeaderboardRouter = () => {
  const router = Router();

  router.use(createLeaderboardListRouter());

  return router;
};

const router = createLeaderboardRouter();
export default router;
