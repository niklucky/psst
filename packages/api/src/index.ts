/**
 * @silo/api — re-exports the AppRouter type so web/mobile/CLI clients
 * can import it without depending on the full server package directly.
 */
export type { AppRouter } from '@silo/server/router';
