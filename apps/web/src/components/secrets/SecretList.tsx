import type { SecretType } from '@silo/shared';
import { useKeyVault } from '../../context/KeyVaultContext';
import { useDebounce } from '../../hooks/useDebounce';
import { trpc } from '../../trpc';

// ── Types ─────────────────────────────────────────────────────────────────

export type TypeFilter = 'all' | SecretType;

// ── Constants ─────────────────────────────────────────────────────────────

const TYPE_TABS: { label: string; value: TypeFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Logins', value: 'login' },
  { label: 'Notes', value: 'note' },
  { label: 'Env vars', value: 'env_var' },
  { label: 'Files', value: 'file' },
  { label: 'Cards', value: 'card' },
];

const TYPE_ICONS: Record<string, string> = {
  login: '🔑',
  note: '📝',
  env_var: '⚙️',
  file: '📄',
  card: '💳',
};

const TYPE_LABELS: Record<string, string> = {
  login: 'Login',
  note: 'Note',
  env_var: 'Env var',
  file: 'File',
  card: 'Card',
};

const EMPTY_STATES: Record<TypeFilter, { emoji: string; line1: string; line2?: string }> = {
  all: { emoji: '🔒', line1: 'No secrets yet', line2: 'Add your first secret to get started.' },
  login: { emoji: '🔑', line1: 'No logins yet', line2: 'Save your first login to get started.' },
  note: { emoji: '📝', line1: 'No notes yet', line2: 'Add a secure note.' },
  env_var: { emoji: '⚙️', line1: 'No env vars yet', line2: 'Store your environment variables here.' },
  file: { emoji: '📄', line1: 'No files yet', line2: 'Upload an encrypted file.' },
  card: { emoji: '💳', line1: 'No cards yet', line2: 'Store a payment card securely.' },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ── Component ─────────────────────────────────────────────────────────────

interface Props {
  vaultId: string;
  folderFilter: string | null;
  typeFilter: TypeFilter;
  search: string;
  selectedTagIds: Set<string>;
  onSearchChange: (v: string) => void;
  onTypeFilterChange: (v: TypeFilter) => void;
  /** Called when the user clicks a secret row. */
  onSecretClick?: (secretId: string) => void;
  /** Called when the user clicks the "+" button. */
  onCreateClick?: () => void;
  /** ID of the currently selected secret (highlighted in the list). */
  selectedSecretId?: string | null;
}

export function SecretList({
  vaultId,
  folderFilter,
  typeFilter,
  search,
  selectedTagIds,
  onSearchChange,
  onTypeFilterChange,
  onSecretClick,
  onCreateClick,
  selectedSecretId,
}: Props) {
  const { session } = useKeyVault();
  const debouncedSearch = useDebounce(search, 300);

  // Fetch tags for rendering chips on each row.
  const { data: allTags } = trpc.tag.list.useQuery(
    { vaultId },
    { enabled: !!session && !!vaultId },
  );
  const tagMap = new Map(allTags?.map((t) => [t.id, t]) ?? []);

  // Fetch secret metadata — never includes ciphertext.
  const { data: secrets, isLoading } = trpc.secret.list.useQuery(
    {
      vaultId,
      ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
      ...(folderFilter ? { folderId: folderFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    },
    { enabled: !!session && !!vaultId },
  );

  // Tag filter is applied client-side (secret.list already returns tagIds).
  const displayed =
    selectedTagIds.size === 0
      ? (secrets ?? [])
      : (secrets ?? []).filter((s) => s.tagIds.some((tid) => selectedTagIds.has(tid)));

  const isEmpty = !isLoading && displayed.length === 0;
  const emptyState = EMPTY_STATES[typeFilter];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Search bar + type tabs ── */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-4 pt-3">
        {/* Search + add button */}
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
              🔍
            </span>
            <input
              type="search"
              placeholder="Search secrets…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          {onCreateClick && (
            <button
              onClick={onCreateClick}
              title="New secret"
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-xl leading-none"
            >
              +
            </button>
          )}
        </div>

        {/* Type filter tabs */}
        <div className="-mx-4 px-4 flex overflow-x-auto scrollbar-none">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onTypeFilterChange(tab.value)}
              className={`shrink-0 px-3 py-2 text-sm border-b-2 transition-colors ${
                typeFilter === tab.value
                  ? 'border-indigo-600 text-indigo-700 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Secret rows ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading skeletons */}
        {isLoading && (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-24 text-center px-6">
            <span className="text-4xl mb-3">{emptyState.emoji}</span>
            <p className="text-sm font-medium text-gray-800">{emptyState.line1}</p>
            {emptyState.line2 && (
              <p className="text-xs text-gray-400 mt-1">{emptyState.line2}</p>
            )}
          </div>
        )}

        {/* Rows */}
        {!isLoading && displayed.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {displayed.map((secret) => {
              const tags = secret.tagIds
                .slice(0, 3)
                .map((tid) => tagMap.get(tid))
                .filter(Boolean);
              const extraCount = secret.tagIds.length - 3;

              return (
                <li
                  key={secret.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', secret.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => onSecretClick?.(secret.id)}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                    selectedSecretId === secret.id
                      ? 'bg-indigo-50'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {/* Type icon */}
                  <span className="text-xl shrink-0" aria-hidden>
                    {TYPE_ICONS[secret.type] ?? '🔒'}
                  </span>

                  {/* Name + tag chips */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{secret.name}</p>

                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {tags.map((tag) =>
                          tag ? (
                            <span
                              key={tag.id}
                              style={
                                tag.colour
                                  ? {
                                      backgroundColor: `${tag.colour}22`,
                                      color: tag.colour,
                                    }
                                  : undefined
                              }
                              className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500"
                            >
                              {tag.name}
                            </span>
                          ) : null,
                        )}
                        {extraCount > 0 && (
                          <span className="text-xs text-gray-400">+{extraCount}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Type badge + date */}
                  <div className="shrink-0 text-right space-y-1">
                    <span className="block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                      {TYPE_LABELS[secret.type] ?? secret.type}
                    </span>
                    <span className="block text-xs text-gray-400">
                      {formatDate(secret.updatedAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
