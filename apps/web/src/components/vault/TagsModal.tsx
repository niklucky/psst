import { useState } from 'react';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';

// ── Preset colour palette ──────────────────────────────────────────────────

const PRESET_COLOURS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
];

// ── Colour swatch picker ───────────────────────────────────────────────────

function ColourPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {PRESET_COLOURS.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          onClick={() => onChange(c)}
          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: c,
            borderColor: value === c ? '#111827' : 'transparent',
          }}
        />
      ))}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

interface Props {
  vaultId: string;
  onClose: () => void;
}

export function TagsModal({ vaultId, onClose }: Props) {
  const { session } = useKeyVault();
  const utils = trpc.useUtils();

  const { data: tags, isLoading } = trpc.tag.list.useQuery(
    { vaultId },
    { enabled: !!session && !!vaultId },
  );

  const createMutation = trpc.tag.create.useMutation({
    onSuccess: () => void utils.tag.list.invalidate({ vaultId }),
  });
  const deleteMutation = trpc.tag.delete.useMutation({
    onSuccess: () => void utils.tag.list.invalidate({ vaultId }),
  });

  const [newName, setNewName] = useState('');
  const [newColour, setNewColour] = useState(PRESET_COLOURS[0]!);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await createMutation.mutateAsync({ vaultId, name, colour: newColour });
    setNewName('');
  };

  const handleDelete = async (tagId: string) => {
    if (deleteConfirmId !== tagId) {
      setDeleteConfirmId(tagId);
      return;
    }
    await deleteMutation.mutateAsync({ tagId });
    setDeleteConfirmId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm bg-white rounded-xl shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Manage tags</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Existing tags */}
        <div className="overflow-y-auto flex-1 px-5 py-3">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-9 rounded-lg bg-gray-100 animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && tags?.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No tags yet.</p>
          )}

          {!isLoading && (
            <ul className="space-y-1">
              {tags?.map((tag) => (
                <li
                  key={tag.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50"
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: tag.colour ?? '#6b7280' }}
                  />
                  <span className="flex-1 text-sm text-gray-800 truncate">{tag.name}</span>
                  <button
                    onClick={() => void handleDelete(tag.id)}
                    disabled={deleteMutation.isPending}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      deleteConfirmId === tag.id
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'text-gray-400 hover:text-red-500'
                    }`}
                  >
                    {deleteConfirmId === tag.id ? 'Confirm?' : '✕'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Create new tag */}
        <div className="shrink-0 border-t border-gray-100 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            New tag
          </p>
          <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Tag name"
              maxLength={50}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <ColourPicker value={newColour} onChange={setNewColour} />
            <button
              type="submit"
              disabled={!newName.trim() || createMutation.isPending}
              className="w-full rounded-lg bg-indigo-600 text-white text-sm py-1.5 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? 'Creating…' : 'Create tag'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
