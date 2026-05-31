import { router } from '../trpc';
import { authRouter } from './auth';
import { filesRouter } from './files';
import { foldersRouter } from './folders';
import { organisationsRouter } from './organisations';
import { secretsRouter } from './secrets';
import { tagsRouter } from './tags';
import { usersRouter } from './users';
import { vaultsRouter } from './vaults';

export const appRouter = router({
  auth: authRouter,
  vault: vaultsRouter,
  secret: secretsRouter,
  folder: foldersRouter,
  tag: tagsRouter,
  org: organisationsRouter,
  user: usersRouter,
  file: filesRouter,
});

export type AppRouter = typeof appRouter;
