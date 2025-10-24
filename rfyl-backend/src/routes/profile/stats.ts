import { Router } from 'express';

const router = Router();

const stats = {
    milesRun: 120,
    territoryCovered: 45,
    playersDefeated: 30,
    rank: 2
}

router.get('/stats', (req, res) => {
  res.json(stats);
});

export default router;