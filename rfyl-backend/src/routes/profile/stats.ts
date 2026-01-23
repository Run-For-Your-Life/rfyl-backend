import { Router } from 'express';
import { requireAuth, AuthedRequest } from '../../middleware/requireAuth.js';

const router = Router();

const stats = {
  milesRun: 120,
  territoryCovered: 45,
  playersDefeated: 30,
  rank: 2,
};

router.get('/stats', requireAuth, (req: AuthedRequest, res) => {
  res.json(stats);
});

export default router;
