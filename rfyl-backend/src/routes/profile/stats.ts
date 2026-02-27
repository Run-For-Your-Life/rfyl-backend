import { Router } from 'express';

const stats = {
    milesRun: 120,
    territoryCovered: 45,
    playersDefeated: 30,
    rank: 2
};

export const createProfileStatsRouter = () => {
  const router = Router();

  router.get('/stats', (_req, res) => {
    res.json(stats);
  });

  return router;
};

const router = createProfileStatsRouter();
export default router;
