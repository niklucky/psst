import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KeyVaultProvider, useKeyVault } from './context/KeyVaultContext';
import { router } from './router';
import { trpc, makeTrpcClientConfig } from './trpc';
import './styles.css';

function App() {
  const { session } = useKeyVault();
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClientInstance] = useState(() =>
    trpc.createClient(makeTrpcClientConfig(() => session?.sessionToken ?? null)),
  );

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
