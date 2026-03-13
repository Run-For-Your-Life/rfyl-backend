import { Router } from 'express';

import { createBugReportsRouter } from './bugReports.js';
import { createProfileStatsRouter } from './stats.js';

export const createProfileRouter = () => {
  const router = Router();

  router.use(createBugReportsRouter());
  router.use(createProfileStatsRouter());

  return router;
};

const router = createProfileRouter();
export default router;
