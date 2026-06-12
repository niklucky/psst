import { decrypt, fromBase64 } from '@silo/crypto';
import type { FilePayload } from '@silo/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { trpc } from '../../../trpc';
import { EditButtons, FormField, Row } from './LoginDetail';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── View ──────────────────────────────────────────────────────────────────

function FileView({
  secretId,
  vaultKey,
  payload,
}: {
  secretId: string;
  vaultKey: Uint8Array;
  payload: FilePayload;
}) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadUrlQuery = trpc.file.getDownloadUrl.useQuery(
    { secretId, storageKey: payload.storage_key },
    { enabled: false, retry: false },
  );

  const handleDownload = async () => {
    setError(null);
    setIsDownloading(true);
    try {
      const { data } = await downloadUrlQuery.refetch();
      if (!data?.downloadUrl) throw new Error('Could not get download URL');

      const resp = await fetch(data.downloadUrl);
      if (!resp.ok) throw new Error(`Download failed (HTTP ${resp.status})`);

      const encryptedBytes = new Uint8Array(await resp.arrayBuffer());
      const fileBytes = decrypt(encryptedBytes, vaultKey, fromBase64(payload.file_iv));

      const blob = new Blob([new Uint8Array(fileBytes)], { type: payload.mime_type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = payload.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Row label="Filename">
        <span className="text-sm font-mono break-all">{payload.filename}</span>
      </Row>

      <Row label="Type">
        <span className="text-sm">{payload.mime_type}</span>
      </Row>

      <Row label="Size">
        <span className="text-sm">{formatBytes(payload.size)}</span>
      </Row>

      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={isDownloading}
        className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        {isDownloading ? 'Downloading…' : 'Download'}
      </button>

      {error && (
        <p className="text-xs text-red-600 rounded-lg bg-red-50 px-3 py-2">{error}</p>
      )}
    </div>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────

interface FileEditProps {
  name: string;
  payload: FilePayload;
  onSave: (name: string, payload: FilePayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

function FileEdit({ name, payload, onSave, onCancel, isSaving }: FileEditProps) {
  const { register, handleSubmit } = useForm({ defaultValues: { name } });

  const submit = handleSubmit(async (values) => {
    await onSave(values.name, payload);
  });

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Name" {...register('name')} required />
      <p className="text-xs text-gray-400">
        To replace the file, delete this secret and create a new one.
      </p>
      <Row label="Current file">
        <span className="text-sm font-mono">{payload.filename}</span>
        <span className="ml-2 text-xs text-gray-400">({formatBytes(payload.size)})</span>
      </Row>
      <EditButtons onCancel={onCancel} isSaving={isSaving} />
    </form>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

interface Props {
  secretId: string;
  vaultKey: Uint8Array;
  name: string;
  payload: FilePayload;
  mode: 'view' | 'edit';
  onSave: (name: string, payload: FilePayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

export function FileDetail({ secretId, vaultKey, name, payload, mode, onSave, onCancel, isSaving }: Props) {
  return mode === 'view' ? (
    <FileView secretId={secretId} vaultKey={vaultKey} payload={payload} />
  ) : (
    <FileEdit name={name} payload={payload} onSave={onSave} onCancel={onCancel} isSaving={isSaving} />
  );
}
