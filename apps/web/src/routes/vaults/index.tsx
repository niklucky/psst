import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { CreateVaultModal } from '../../components/vaults/CreateVaultModal';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

export function VaultsPage() {
  const { session } = useKeyVault();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: vaults, isLoading } = trpc.vault.list.useQuery(undefined, {
    enabled: !!session,
  });

  if (!session) return null;

  return (
    <div className="p-6 max-w-5xl overflow-y-auto flex-1">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vaults</h1>
          {!isLoading && vaults && (
            <p className="text-sm text-gray-400 mt-0.5">
              {vaults.length} vault{vaults.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          + New vault
        </button>
      </div>

      {/* ── Loading skeletons ── */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!isLoading && vaults?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4">🗄️</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">No vaults yet</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-xs">
            Vaults hold your encrypted secrets. Create one to get started.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create your first vault
          </button>
        </div>
      )}

      {/* ── Vault grid ── */}
      {!isLoading && vaults && vaults.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {vaults.map((vault) => (
            <Link
              key={vault.id}
              to="/vaults/$vaultId"
              params={{ vaultId: vault.id }}
              className="group block rounded-xl bg-white border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              {/* Card header */}
              <div className="flex items-start justify-between mb-3">
                <span className="text-2xl">🗄️</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {ROLE_LABELS[vault.role] ?? vault.role}
                </span>
              </div>

              {/* Vault name */}
              <h3 className="font-semibold text-gray-900 group-hover:text-indigo-700 truncate transition-colors">
                {vault.name}
              </h3>

              {/* Optional description */}
              {vault.description && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">{vault.description}</p>
              )}

              {/* Stats row */}
              <div className="flex items-center gap-3 mt-4 text-xs text-gray-400">
                <span title="Members">👥 {vault.memberCount}</span>
                <span title="Secrets">🔑 {vault.secretCount}</span>
                <span className="ml-auto" title="Last updated">
                  {formatDate(vault.updatedAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ── Create vault modal ── */}
      {showCreateModal && (
        <CreateVaultModal
          session={session}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
