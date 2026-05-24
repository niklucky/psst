import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { fromBase64, unwrapVaultKey } from '@psst/crypto';
import { trpc } from '../../trpc';
import { useKeyVault } from '../../context/KeyVaultContext';
import { CreateVaultModal } from '../vaults/CreateVaultModal';
import { PendingInvitesModal } from '../vault/PendingInvitesModal';

/**
 * Authenticated layout — sidebar + main content.
 * Redirects to /login when there is no active session.
 */
export function AppLayout() {
  const { session, clearSession, addVaultKey } = useKeyVault();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInvitesBanner, setShowInvitesBanner] = useState(true);

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) {
      void navigate({ to: '/login', replace: true });
    }
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

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
        // Vault key was encrypted via ECDH (shared vault) — handled in Session 4.7.
      }
    }
  }, [vaults]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Logout ────────────────────────────────────────────────────────────────
  const logoutMutation = trpc.auth.logout.useMutation();

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Best-effort — clear locally regardless.
    }
    clearSession();
    void navigate({ to: '/login', replace: true });
  };

  // Don't render while redirecting.
  if (!session) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Sidebar ── */}
      <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-gray-100">
          <span className="text-lg font-bold text-gray-900">🔐 Psst</span>
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
      <main className="flex-1 overflow-hidden flex flex-col">
        <Outlet />
      </main>

      {/* ── Create vault modal ── */}
      {showCreateModal && (
        <CreateVaultModal
          session={session}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* ── Pending invites modal ── */}
      {showInvitesBanner && pendingInvites && pendingInvites.length > 0 && (
        <PendingInvitesModal
          invites={pendingInvites}
          onDone={() => setShowInvitesBanner(false)}
        />
      )}
    </div>
  );
}
