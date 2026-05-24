import { router } from '../trpc';

/**
 * Root tRPC router — sub-routers are added in Sessions 3.2–3.6.
 */
export const appRouter = router({});

export type AppRouter = typeof appRouter;
