import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './routes/login';
import { RegisterPage } from './routes/register';
import { VaultsPage } from './routes/vaults/index';
import { VaultDetailPage } from './routes/vaults/$vaultId';

// ---- Root layout ----
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// ---- Unauthenticated routes ----
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
});

// ---- Authenticated app layout ----
// Auth guard lives inside AppLayout (redirects to /login when session is absent).
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AppLayout,
});

// / → redirect to /vaults
const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/vaults' });
  },
});

// /vaults — vault list page
const vaultsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vaults',
  component: VaultsPage,
});

// /vaults/$vaultId — vault detail (placeholder for Session 4.4)
const vaultDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vaults/$vaultId',
  component: VaultDetailPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  appRoute.addChildren([indexRoute, vaultsRoute, vaultDetailRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
