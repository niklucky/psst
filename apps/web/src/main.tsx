import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KeyVaultProvider, useKeyVault } from './context/KeyVaultContext';
import { ToastProvider } from './context/ToastContext';
import { router } from './router';
import { trpc, makeTrpcClientConfig } from './trpc';
import './styles.css';

function App() {
  const { session, clearSession } = useKeyVault();
  const navigate = useNavigate();

  // Keep a ref so the tRPC headers function always reads the *latest* token
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Don't retry on UNAUTHORIZED
            retry: (failureCount, error: unknown) => {
              const code = (error as { data?: { code?: string } })?.data?.code;
              if (code === 'UNAUTHORIZED') return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  const [trpcClientInstance] = useState(() =>
    trpc.createClient(makeTrpcClientConfig(() => sessionRef.current?.sessionToken ?? null)),
  );

  // 401 handling: subscribe to query cache errors and log out on UNAUTHORIZED
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.state.status === 'error') {
        const error = event.query.state.error as { data?: { code?: string } } | null;
        if (error?.data?.code === 'UNAUTHORIZED') {
          clearSession();
          void navigate({ to: '/login', replace: true });
        }
      }
    });
    return unsubscribe;
  }, [queryClient, clearSession, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush stale cached data when the user logs out so the next login starts clean.
  useEffect(() => {
    if (!session) {
      queryClient.clear();
    }
  }, [session, queryClient]);

  return (
    <trpc.Provider client={trpcClientInstance} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <KeyVaultProvider>
    <App />
  </KeyVaultProvider>,
);
