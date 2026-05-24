import { router } from '../trpc';
import { authRouter } from './auth';
import { secretsRouter } from './secrets';
import { vaultsRouter } from './vaults';

/**
 * Root tRPC router — sub-routers added as Phase 3 progresses.
 */
export const appRouter = router({
  auth: authRouter,
  vault: vaultsRouter,
  secret: secretsRouter,
});

export type AppRouter = typeof appRouter;
