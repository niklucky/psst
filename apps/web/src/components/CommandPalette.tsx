import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useKeyVault } from '../context/KeyVaultContext';
import { useDebounce } from '../hooks/useDebounce';
import { trpc } from '../trpc';

const TYPE_ICONS: Record<string, string> = {
  login: '🔑',
  note: '📝',
  env_var: '⚙️',
  file: '📄',
  card: '💳',
};

interface Props {
  onClose: () => void;
}

export function CommandPalette({ onClose }: Props) {
  const { session } = useKeyVault();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debouncedQuery = useDebounce(query, 200);

  const { data: results = [], isFetching } = trpc.secret.globalSearch.useQuery(
    { query: debouncedQuery },
    { enabled: !!session && debouncedQuery.length > 0 },
  );

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        const r = results[selectedIndex]!;
        void navigate({ to: '/vaults/$vaultId', params: { vaultId: r.vaultId }, search: { secret: r.id } });
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [results, selectedIndex, onClose, navigate]);

  const handleSelect = (vaultId: string, secretId: string) => {
    void navigate({ to: '/vaults/$vaultId', params: { vaultId }, search: { secret: secretId } });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Palette */}
      <div className="relative z-10 w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <span className="text-gray-400 text-lg shrink-0">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search secrets across all vaults…"
            className="flex-1 text-sm bg-transparent focus:outline-none text-gray-900 placeholder-gray-400"
          />
          {isFetching && (
            <span className="text-xs text-gray-400 shrink-0 animate-pulse">Searching…</span>
          )}
          <kbd className="shrink-0 text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {query && !isFetching && results.length === 0 && (
            <div className="flex flex-col items-center py-10 text-gray-400">
              <span className="text-3xl mb-2">🔒</span>
              <p className="text-sm">No secrets found for "{query}"</p>
            </div>
          )}

          {results.map((result, i) => (
            <button
              key={result.id}
              onClick={() => handleSelect(result.vaultId, result.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                i === selectedIndex ? 'bg-indigo-50' : ''
              }`}
            >
              <span className="text-xl shrink-0">{TYPE_ICONS[result.type] ?? '🔒'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{result.name}</p>
                <p className="text-xs text-gray-400 truncate">🗄️ {result.vaultName}</p>
              </div>
              <kbd className="shrink-0 text-xs text-gray-300 border border-gray-200 rounded px-1.5 py-0.5">
                ↵
              </kbd>
            </button>
          ))}

          {!query && (
            <div className="flex flex-col items-center py-10 text-gray-400">
              <span className="text-3xl mb-2">⌨️</span>
              <p className="text-sm">Start typing to search all your secrets</p>
              <p className="text-xs mt-1">↑↓ to navigate · Enter to open · Esc to close</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
