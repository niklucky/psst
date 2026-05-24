import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { SecretList } from '../../components/secrets/SecretList';
import type { TypeFilter } from '../../components/secrets/SecretList';
import { VaultLeftPanel } from '../../components/vault/VaultLeftPanel';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';

export function VaultDetailPage() {
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const { session } = useKeyVault();

  // ── Filter state (shared between both panels) ─────────────────────────
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  const handleTagToggle = (tagId: string) =>
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });

  // ── Vault header ──────────────────────────────────────────────────────
  const { data: vault, isLoading: vaultLoading } = trpc.vault.get.useQuery(
    { vaultId },
    { enabled: !!session && !!vaultId },
  );

  if (!session) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      {/* ── Vault name bar ── */}
      <div className="h-14 shrink-0 border-b border-gray-200 bg-white flex items-center px-6 gap-3">
        {vaultLoading ? (
          <div className="h-5 w-48 rounded bg-gray-100 animate-pulse" />
        ) : (
          <>
            <span className="text-xl">🗄️</span>
            <h1 className="font-semibold text-gray-900">{vault?.name ?? 'Vault'}</h1>
            {vault?.description && (
              <span className="text-sm text-gray-400 truncate">{vault.description}</span>
            )}
          </>
        )}
      </div>

      {/* ── Two-panel body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: folder tree + tag filters */}
        <VaultLeftPanel
          vaultId={vaultId}
          folderFilter={folderFilter}
          selectedTagIds={selectedTagIds}
          onFolderSelect={setFolderFilter}
          onTagToggle={handleTagToggle}
        />

        {/* Right panel: search + type tabs + secret rows */}
        <SecretList
          vaultId={vaultId}
          folderFilter={folderFilter}
          typeFilter={typeFilter}
          search={search}
          selectedTagIds={selectedTagIds}
          onSearchChange={setSearch}
          onTypeFilterChange={setTypeFilter}
          onSecretClick={(id) => {
            // Session 4.5 will open the detail panel here.
            console.log('Secret clicked:', id);
          }}
        />
      </div>
    </div>
  );
}
