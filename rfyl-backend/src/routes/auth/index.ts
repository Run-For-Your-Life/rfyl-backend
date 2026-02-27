import { Router } from 'express';

import { createLoginRouter } from './login.js';
import { createRegisterRouter } from './register.js';
import { createSessionRouter } from './session.js';

export const createAuthRouter = () => {
  const router = Router();
  router.use(createLoginRouter());
  router.use(createRegisterRouter());
  router.use(createSessionRouter());
  return router;
};

const router = createAuthRouter();
export default router;
