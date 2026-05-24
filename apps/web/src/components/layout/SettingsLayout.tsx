import { Link, Outlet } from '@tanstack/react-router';

const NAV_ITEMS = [
  { to: '/settings/profile', label: '👤 Profile', exact: true },
  { to: '/settings/organisation', label: '🏢 Organisation', exact: false },
];

export function SettingsLayout() {
  return (
    <div className="flex-1 flex overflow-hidden h-full">
      {/* Settings sidebar */}
      <aside className="w-52 shrink-0 border-r border-gray-200 bg-white flex flex-col py-4 px-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-2 mb-2">
          Settings
        </p>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.exact }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            activeProps={{ className: '!bg-indigo-50 !text-indigo-700 font-medium' }}
          >
            {item.label}
          </Link>
        ))}
      </aside>

      {/* Settings page content */}
      <main className="flex-1 overflow-y-auto p-8 bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}
