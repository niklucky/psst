/**
 * CLI tRPC client.
 *
 * Creates a vanilla (non-React) tRPC client that reads the session token
 * from the credentials file (or CI env var SILO_SESSION_TOKEN).
 */

import type { AppRouter } from '@silo/api';
import { createTRPCClient, httpBatchLink, type TRPCClient } from '@trpc/client';
import { readCredentials, getServerUrl } from './config';

function getSessionToken(): string | null {
  // CI/CD: env var takes precedence
  if (process.env['SILO_SESSION_TOKEN']) {
    return process.env['SILO_SESSION_TOKEN'];
  }
  return readCredentials()?.sessionToken ?? null;
}

export function createApiClient(): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${getServerUrl()}/trpc`,
        headers: () => {
          const token = getSessionToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}

/** Shared singleton for commands — created lazily */
let _client: TRPCClient<AppRouter> | null = null;

export function getApiClient(): TRPCClient<AppRouter> {
  if (!_client) _client = createApiClient();
  return _client;
}

/** Reset client (e.g. after login, so new token is picked up) */
export function resetApiClient(): void {
  _client = null;
}
