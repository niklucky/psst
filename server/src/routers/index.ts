import { router } from '../trpc';
import { authRouter } from './auth';
import { foldersRouter } from './folders';
import { secretsRouter } from './secrets';
import { tagsRouter } from './tags';
import { vaultsRouter } from './vaults';

/**
 * Root tRPC router.
 */
export const appRouter = router({
  auth: authRouter,
  vault: vaultsRouter,
  secret: secretsRouter,
  folder: foldersRouter,
  tag: tagsRouter,
});

export type AppRouter = typeof appRouter;
