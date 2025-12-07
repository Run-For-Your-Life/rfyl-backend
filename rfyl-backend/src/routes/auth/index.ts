import { Router } from 'express';

import loginRoute from './login.js';
import registerRoute from './register.js';

const router = Router();

// Mount the subroutes
router.use(loginRoute);
router.use(registerRoute);

export default router;
