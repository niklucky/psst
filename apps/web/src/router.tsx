import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod/v4';
import { AppLayout } from './components/layout/AppLayout';
import { SettingsLayout } from './components/layout/SettingsLayout';
import { LoginPage } from './routes/login';
import { RegisterPage } from './routes/register';
import { UnlockPage } from './routes/unlock';
import { VaultsPage } from './routes/vaults/index';
import { VaultDetailPage } from './routes/vaults/$vaultId';
import { VaultMembersPage } from './routes/vaults/$vaultId/members';
import { ProfileSettingsPage } from './routes/settings/profile';
import { OrgSettingsPage } from './routes/settings/organisation';

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

const unlockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/unlock',
  component: UnlockPage,
});

// ---- Authenticated app layout (pathless — wraps auth routes without owning a path) ----
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
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

// /vaults — vault list
const vaultsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vaults',
  component: VaultsPage,
});

// /vaults/$vaultId — vault detail
// Optional `?secret=<id>` lets the command palette pre-select a secret
const vaultDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vaults/$vaultId',
  component: VaultDetailPage,
  validateSearch: z.object({ secret: z.string().optional() }),
});

// /vaults/$vaultId/members
const vaultMembersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/vaults/$vaultId/members',
  component: VaultMembersPage,
});

// ---- Settings layout ----
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsLayout,
});

// /settings → redirect to /settings/profile
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile' });
  },
});

// /settings/profile
const profileSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/profile',
  component: ProfileSettingsPage,
});

// /settings/organisation
const orgSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/organisation',
  component: OrgSettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  unlockRoute,
  appRoute.addChildren([
    indexRoute,
    vaultsRoute,
    vaultDetailRoute,
    vaultMembersRoute,
    settingsRoute.addChildren([settingsIndexRoute, profileSettingsRoute, orgSettingsRoute]),
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
