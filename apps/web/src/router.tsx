import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';

// ---- Root layout ----
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// ---- Unauthenticated routes ----
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: () => (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500">Login — implemented in Session 4.2</p>
    </div>
  ),
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: () => (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500">Register — implemented in Session 4.2</p>
    </div>
  ),
});

// ---- Authenticated root ----
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 bg-white border-r border-gray-200 p-4">
        <p className="font-semibold text-gray-900">Psst</p>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: () => (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Welcome to Psst</h1>
      <p className="mt-2 text-gray-500">Vault list — implemented in Session 4.3</p>
    </div>
  ),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  appRoute.addChildren([indexRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
