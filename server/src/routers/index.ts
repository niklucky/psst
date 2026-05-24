import { router } from '../trpc';
import { authRouter } from './auth';
import { vaultsRouter } from './vaults';

/**
 * Root tRPC router — sub-routers added as Phase 3 progresses.
 */
export const appRouter = router({
  auth: authRouter,
  vault: vaultsRouter,
});

export type AppRouter = typeof appRouter;
