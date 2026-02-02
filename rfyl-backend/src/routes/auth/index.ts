import { Router } from 'express';

import loginRoute from './login.js';
import registerRoute from './register.js';
import sessionRoute from './session.js';

const router = Router();

// Mount the subroutes
router.use(loginRoute);
router.use(registerRoute);
router.use(sessionRoute);

export default router;
