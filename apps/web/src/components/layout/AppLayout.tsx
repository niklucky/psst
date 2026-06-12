import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { fromBase64, unwrapVaultKey } from '@silo/crypto';
import { trpc } from '../../trpc';
import { useKeyVault } from '../../context/KeyVaultContext';
import { useIdleLock } from '../../hooks/useIdleLock';
import { CreateVaultModal } from '../vaults/CreateVaultModal';
import { PendingInvitesModal } from '../vault/PendingInvitesModal';
import { CommandPalette } from '../CommandPalette';
import { ErrorBoundary } from '../ui/ErrorBoundary';

/** Default idle lock timeout: 15 minutes */
const DEFAULT_IDLE_MS = 15 * 60 * 1000;

/**
 * Authenticated layout — sidebar + main content.
 * Redirects to /login when there is no active session.
 */
export function AppLayout() {
  const { session, lockedToken, lock, clearSession, addVaultKey } = useKeyVault();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInvitesBanner, setShowInvitesBanner] = useState(true);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Auth guard ────────────────────────────────────────────────────────────
  // No master key in memory: send to /unlock if a session token survived a
  // reload (just needs the password again), otherwise to /login.
  useEffect(() => {
    if (session) return;
    void navigate({ to: lockedToken ? '/unlock' : '/login', replace: true });
  }, [session, lockedToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Idle lock ─────────────────────────────────────────────────────────────
  const idleTimeoutMs = (() => {
    try {
      const stored = localStorage.getItem('silo:idle_timeout_ms');
      return stored ? parseInt(stored, 10) : DEFAULT_IDLE_MS;
    } catch {
      return DEFAULT_IDLE_MS;
    }
  })();

  useIdleLock(() => {
    if (session) {
      lock();
      void navigate({ to: '/unlock', replace: true });
    }
  }, idleTimeoutMs);

  // ── Ctrl/Cmd+K → command palette ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Current user info ─────────────────────────────────────────────────────
  const { data: me } = trpc.auth.me.useQuery(undefined, { enabled: !!session });

  // ── Vault list (shared between sidebar + key unwrapping) ──────────────────
  const { data: vaults, isLoading: vaultsLoading } = trpc.vault.list.useQuery(undefined, {
    enabled: !!session,
  });

  // ── Pending invites ───────────────────────────────────────────────────────
  const { data: pendingInvites } = trpc.vault.getPendingInvites.useQuery(undefined, {
    enabled: !!session,
  });

  // Unwrap and cache every vault key when the list arrives.
  useEffect(() => {
    if (!vaults || !session) return;
    for (const vault of vaults) {
      if (session.vaultKeys.has(vault.id)) continue;
      try {
        const key = unwrapVaultKey(
          fromBase64(vault.encryptedVaultKey),
          session.masterKey,
          fromBase64(vault.vaultKeyIv),
        );
        addVaultKey(vault.id, key);
      } catch {
        // Vault key was encrypted via ECDH — handled in PendingInvitesModal.
      }
    }
  }, [vaults]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Logout ────────────────────────────────────────────────────────────────
  const logoutMutation = trpc.auth.logout.useMutation();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Best-effort.
    }
    clearSession();
    void navigate({ to: '/login', replace: true });
  };

  if (!session) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Mobile overlay ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 w-60 bg-white border-r border-gray-200 flex flex-col overflow-hidden
          transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 md:z-auto
        `}
      >
        {/* Logo */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-gray-100">
          <span className="text-lg font-bold text-gray-900">🔐 Silo</span>
          <button
            className="md:hidden text-gray-400 hover:text-gray-600"
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
        </div>

        {/* Vault list */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Vaults
            </span>
            <button
              onClick={() => setShowCreateModal(true)}
              title="New vault"
              className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-base leading-none"
            >
              +
            </button>
          </div>

          {vaultsLoading && (
            <p className="px-2 py-1 text-xs text-gray-400">Loading…</p>
          )}

          {vaults?.map((vault) => (
            <Link
              key={vault.id}
              to="/vaults/$vaultId"
              params={{ vaultId: vault.id }}
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              activeProps={{ className: '!text-indigo-700 !bg-indigo-50 font-medium' }}
              activeOptions={{ exact: false }}
            >
              <span>🗄️</span>
              <span className="truncate">{vault.name}</span>
            </Link>
          ))}

          {!vaultsLoading && vaults?.length === 0 && (
            <p className="px-2 py-1 text-xs text-gray-400 mt-1">
              No vaults yet — create one.
            </p>
          )}
        </nav>

        {/* Pending invites badge */}
        {pendingInvites && pendingInvites.length > 0 && (
          <button
            onClick={() => setShowInvitesBanner(true)}
            className="mx-2 mb-2 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-left hover:bg-amber-100 transition-colors"
          >
            <span className="text-base">📬</span>
            <span className="text-xs text-amber-800 font-medium">
              {pendingInvites.length} vault invite{pendingInvites.length !== 1 ? 's' : ''}
            </span>
          </button>
        )}

        {/* User footer */}
        <div className="border-t border-gray-100 p-3 flex items-center justify-between">
          <Link
            to="/settings/profile"
            className="text-xs text-gray-400 truncate max-w-[130px] hover:text-indigo-600 transition-colors"
            title="Settings"
          >
            {me?.email ?? `${session.userId.slice(0, 8)}…`}
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/settings/profile"
              title="Settings"
              className="text-gray-400 hover:text-gray-700 text-base leading-none transition-colors"
            >
              ⚙
            </Link>
            <button
              onClick={handleLogout}
              disabled={logoutMutation.isPending}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50"
            >
              {logoutMutation.isPending ? '…' : 'Sign out'}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="h-12 flex items-center gap-3 px-4 border-b border-gray-200 bg-white md:hidden shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-600 hover:text-gray-900 text-xl"
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="text-sm font-bold text-gray-900">🔐 Silo</span>
          <div className="flex-1" />
          <button
            onClick={() => setShowCommandPalette(true)}
            className="text-xs text-gray-400 border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50 flex items-center gap-1"
          >
            <span>🔍</span>
            <kbd className="text-xs">⌘K</kbd>
          </button>
        </div>

        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* ── Search hint in desktop sidebar top area ── */}
      {/* (desktop Ctrl+K hint is in the keyboard shortcut) */}

      {/* ── Modals ── */}
      {showCreateModal && (
        <CreateVaultModal
          session={session}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {showInvitesBanner && pendingInvites && pendingInvites.length > 0 && (
        <PendingInvitesModal
          invites={pendingInvites}
          onDone={() => setShowInvitesBanner(false)}
        />
      )}

      {showCommandPalette && (
        <CommandPalette onClose={() => setShowCommandPalette(false)} />
      )}
    </div>
  );
}
