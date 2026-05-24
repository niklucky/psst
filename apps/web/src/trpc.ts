import type { AppRouter } from '@psst/api';
import { createTRPCClient, httpBatchLink, type TRPCClient } from '@trpc/client';
import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';

const SERVER_URL = import.meta.env['VITE_SERVER_URL'] ?? 'http://localhost:3001';

function makeLinks(getToken: () => string | null) {
  return [
    httpBatchLink({
      url: `${SERVER_URL}/trpc`,
      headers: () => {
        const token = getToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ];
}

/**
 * tRPC React hooks — use this in components.
 */
export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();

/**
 * Factory used in App to create a client with the current session token.
 */
export function makeTrpcClientConfig(getToken: () => string | null) {
  return { links: makeLinks(getToken) };
}

/**
 * Raw tRPC vanilla client — for one-off calls outside React (e.g. during login).
 */
let _sessionToken: string | null = null;

export function setSessionToken(token: string | null) {
  _sessionToken = token;
}

export const trpcClient: TRPCClient<AppRouter> = createTRPCClient<AppRouter>({
  links: makeLinks(() => _sessionToken),
});
