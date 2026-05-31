import { decryptSecret, encryptSecret, fromBase64, toBase64 } from '@psst/crypto';
import type {
  CardPayload,
  EnvVarPayload,
  FilePayload,
  LoginPayload,
  NotePayload,
} from '@psst/shared';
import { useMemo, useState } from 'react';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';
import { CardDetail } from './detail/CardDetail';
import { EnvVarDetail } from './detail/EnvVarDetail';
import { FileDetail } from './detail/FileDetail';
import { LoginDetail } from './detail/LoginDetail';
import { NoteDetail } from './detail/NoteDetail';

const TYPE_ICONS: Record<string, string> = {
  login: '🔑',
  note: '📝',
  env_var: '⚙️',
  file: '📄',
  card: '💳',
};

interface Props {
  secretId: string;
  vaultId: string;
  onClose: () => void;
}

export function SecretDetailPanel({ secretId, vaultId, onClose }: Props) {
  const { session } = useKeyVault();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const utils = trpc.useUtils();

  // ── Fetch full secret (includes ciphertext) ──────────────────────────────
  const { data: secret, isLoading } = trpc.secret.get.useQuery(
    { secretId },
    { enabled: !!session },
  );

  // ── Decrypt ──────────────────────────────────────────────────────────────
  const vaultKey = session?.vaultKeys.get(vaultId);

  const decrypted = useMemo<
    LoginPayload | NotePayload | EnvVarPayload | FilePayload | CardPayload | null
  >(() => {
    if (!secret || !vaultKey) return null;
    try {
      const plaintext = decryptSecret(
        fromBase64(secret.ciphertext),
        vaultKey,
        fromBase64(secret.iv),
      );
      return JSON.parse(plaintext) as LoginPayload | NotePayload | EnvVarPayload | FilePayload | CardPayload;
    } catch {
      return null;
    }
  }, [secret, vaultKey]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateMutation = trpc.secret.update.useMutation({
    onSuccess: () => {
      void utils.secret.get.invalidate({ secretId });
      void utils.secret.list.invalidate();
      setMode('view');
    },
  });

  const deleteMutation = trpc.secret.delete.useMutation({
    onSuccess: () => {
      void utils.secret.list.invalidate();
      onClose();
    },
  });

  // ── Save handler ─────────────────────────────────────────────────────────
  const handleSave = async (name: string, payload: object) => {
    if (!vaultKey) return;
    const { ciphertext, iv } = encryptSecret(JSON.stringify(payload), vaultKey);
    await updateMutation.mutateAsync({
      secretId,
      name,
      ciphertext: toBase64(ciphertext),
      iv: toBase64(iv),
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200 shadow-xl">
      {/* Header */}
      <div className="h-14 shrink-0 border-b border-gray-200 flex items-center justify-between px-4 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">{TYPE_ICONS[secret?.type ?? ''] ?? '🔒'}</span>
          <h2 className="font-semibold text-gray-900 truncate">
            {isLoading ? '…' : (secret?.name ?? 'Secret')}
          </h2>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {mode === 'view' && !isLoading && (
            <button
              onClick={() => setMode('edit')}
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"
            >
              Edit
            </button>
          )}
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && !decrypted && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-3xl mb-2">🔒</span>
            <p className="text-sm text-gray-500">
              {!vaultKey
                ? 'Vault key not loaded — please re-enter your master password.'
                : 'Failed to decrypt this secret.'}
            </p>
          </div>
        )}

        {!isLoading && decrypted && secret && (() => {
          const commonProps = {
            name: secret.name,
            mode,
            onSave: handleSave as never,
            onCancel: () => setMode('view'),
            isSaving: updateMutation.isPending,
          };

          switch (secret.type) {
            case 'login':
              return <LoginDetail {...commonProps} payload={decrypted as LoginPayload} />;
            case 'note':
              return <NoteDetail {...commonProps} payload={decrypted as NotePayload} />;
            case 'env_var':
              return <EnvVarDetail {...commonProps} payload={decrypted as EnvVarPayload} />;
            case 'card':
              return <CardDetail {...commonProps} payload={decrypted as CardPayload} />;
            case 'file':
              return (
                <FileDetail
                  {...commonProps}
                  secretId={secretId}
                  vaultKey={vaultKey!}
                  payload={decrypted as FilePayload}
                />
              );
            default:
              return <p className="text-sm text-gray-500">Unknown secret type.</p>;
          }
        })()}
      </div>

      {/* Footer — delete */}
      {!isLoading && secret && mode === 'view' && (
        <div className="shrink-0 border-t border-gray-100 p-3">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 flex-1">Delete permanently?</span>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate({ secretId })}
                disabled={deleteMutation.isPending}
                className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Delete secret
            </button>
          )}
        </div>
      )}
    </div>
  );
}
