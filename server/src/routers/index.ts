import { router } from '../trpc';
import { authRouter } from './auth';

/**
 * Root tRPC router — sub-routers added as Phase 3 progresses.
 */
export const appRouter = router({
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
