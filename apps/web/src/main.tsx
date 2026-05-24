import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KeyVaultProvider, useKeyVault } from './context/KeyVaultContext';
import { router } from './router';
import { trpc, makeTrpcClientConfig } from './trpc';
import './styles.css';

function App() {
  const { session } = useKeyVault();

  // Keep a ref so the tRPC headers function always reads the *latest* token
  // even though the trpcClientInstance is only created once (useState initialiser).
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [queryClient] = useState(() => new QueryClient());
  const [trpcClientInstance] = useState(() =>
    trpc.createClient(makeTrpcClientConfig(() => sessionRef.current?.sessionToken ?? null)),
  );

  // Flush stale cached data when the user logs out so the next login starts clean.
  useEffect(() => {
    if (!session) {
      queryClient.clear();
    }
  }, [session, queryClient]);

  return (
    <trpc.Provider client={trpcClientInstance} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
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
