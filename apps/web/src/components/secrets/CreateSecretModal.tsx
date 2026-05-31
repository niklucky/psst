import { encrypt, encryptSecret, toBase64 } from '@psst/crypto';
import type {
  CardPayload,
  EnvVarPayload,
  FilePayload,
  LoginPayload,
  NotePayload,
  SecretType,
} from '@psst/shared';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { VaultSession } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';
import { EditButtons, FormField, FormTextarea } from './detail/LoginDetail';

// ── Type picker ─────────────────────────────────────────────────────────────

const TYPES: { type: SecretType; icon: string; label: string; description: string }[] = [
  { type: 'login', icon: '🔑', label: 'Login', description: 'Username, password, URL' },
  { type: 'note', icon: '📝', label: 'Secure note', description: 'Free-form text / Markdown' },
  { type: 'env_var', icon: '⚙️', label: 'Env variables', description: 'KEY=VALUE pairs' },
  { type: 'card', icon: '💳', label: 'Payment card', description: 'Number, expiry, CVV' },
  { type: 'file', icon: '📄', label: 'File', description: 'Encrypted file attachment' },
];

function TypePicker({ onPick }: { onPick: (type: SecretType) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500 mb-3">What kind of secret do you want to store?</p>
      {TYPES.map(({ type, icon, label, description }) => (
        <button
          key={type}
          type="button"
          onClick={() => onPick(type)}
          className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-left transition-colors"
        >
          <span className="text-2xl shrink-0">{icon}</span>
          <div>
            <p className="text-sm font-medium text-gray-900">{label}</p>
            <p className="text-xs text-gray-400">{description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Per-type creation forms ─────────────────────────────────────────────────

function LoginCreateForm({
  onSubmit,
  isSaving,
  onCancel,
}: {
  onSubmit: (name: string, payload: LoginPayload) => Promise<void>;
  isSaving: boolean;
  onCancel: () => void;
}) {
  const { register, handleSubmit } = useForm({
    defaultValues: { name: '', username: '', password: '', url: '', totp_secret: '', notes: '' },
  });
  const submit = handleSubmit(async (v) => {
    await onSubmit(v.name, {
      username: v.username,
      password: v.password,
      ...(v.url ? { url: v.url } : {}),
      ...(v.totp_secret ? { totp_secret: v.totp_secret } : {}),
      ...(v.notes ? { notes: v.notes } : {}),
    });
  });
  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Name" {...register('name')} required placeholder="e.g. GitHub" />
      <FormField label="URL" {...register('url')} type="url" placeholder="https://..." />
      <FormField label="Username" {...register('username')} required />
      <FormField label="Password" {...register('password')} type="password" required />
      <FormField label="TOTP secret" {...register('totp_secret')} placeholder="base32 secret" />
      <FormTextarea label="Notes" {...register('notes')} />
      <EditButtons onCancel={onCancel} isSaving={isSaving} />
    </form>
  );
}

function NoteCreateForm({
  onSubmit,
  isSaving,
  onCancel,
}: {
  onSubmit: (name: string, payload: NotePayload) => Promise<void>;
  isSaving: boolean;
  onCancel: () => void;
}) {
  const { register, handleSubmit } = useForm({ defaultValues: { name: '', content: '' } });
  const submit = handleSubmit(async (v) => {
    await onSubmit(v.name, { content: v.content });
  });
  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Name" {...register('name')} required />
      <FormTextarea label="Content (Markdown)" {...register('content')} rows={10} />
      <EditButtons onCancel={onCancel} isSaving={isSaving} />
    </form>
  );
}

function EnvVarCreateForm({
  onSubmit,
  isSaving,
  onCancel,
}: {
  onSubmit: (name: string, payload: EnvVarPayload) => Promise<void>;
  isSaving: boolean;
  onCancel: () => void;
}) {
  const { register, control, handleSubmit } = useForm({
    defaultValues: {
      name: '',
      project: '',
      environment: '' as '' | 'development' | 'staging' | 'production',
      variables: [{ key: '', value: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'variables' });
  const submit = handleSubmit(async (v) => {
    await onSubmit(v.name, {
      variables: v.variables.filter((r) => r.key.trim() !== ''),
      ...(v.project ? { project: v.project } : {}),
      ...(v.environment ? { environment: v.environment } : {}),
    });
  });
  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Name" {...register('name')} required />
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Project" {...register('project')} />
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Environment
          </label>
          <select
            {...register('environment')}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Any</option>
            <option value="development">Development</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Variables
        </p>
        <div className="space-y-2">
          {fields.map((field, i) => (
            <div key={field.id} className="flex gap-2 items-center">
              <input
                {...register(`variables.${i}.key`)}
                placeholder="KEY"
                className="flex-1 text-xs font-mono border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <input
                {...register(`variables.${i}.value`)}
                placeholder="value"
                className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-gray-400 hover:text-red-500 text-lg leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => append({ key: '', value: '' })}
          className="mt-2 text-xs text-indigo-600 hover:underline"
        >
          + Add variable
        </button>
      </div>
      <EditButtons onCancel={onCancel} isSaving={isSaving} />
    </form>
  );
}

function CardCreateForm({
  onSubmit,
  isSaving,
  onCancel,
}: {
  onSubmit: (name: string, payload: CardPayload) => Promise<void>;
  isSaving: boolean;
  onCancel: () => void;
}) {
  const { register, handleSubmit } = useForm({
    defaultValues: { name: '', number: '', cardholder: '', expiry: '', cvv: '', notes: '' },
  });
  const submit = handleSubmit(async (v) => {
    await onSubmit(v.name, {
      number: v.number,
      cardholder: v.cardholder,
      expiry: v.expiry,
      cvv: v.cvv,
      ...(v.notes ? { notes: v.notes } : {}),
    });
  });
  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Name" {...register('name')} required placeholder="e.g. Visa debit" />
      <FormField label="Card number" {...register('number')} required placeholder="1234 5678 9012 3456" />
      <FormField label="Cardholder name" {...register('cardholder')} required />
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Expiry" {...register('expiry')} required placeholder="MM/YY" />
        <FormField label="CVV" {...register('cvv')} required />
      </div>
      <FormTextarea label="Notes" {...register('notes')} />
      <EditButtons onCancel={onCancel} isSaving={isSaving} />
    </form>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileCreateForm({
  vaultId,
  session,
  onCancel,
  onClose,
}: {
  vaultId: string;
  session: VaultSession;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const utils = trpc.useUtils();

  const uploadUrlMutation = trpc.file.getUploadUrl.useMutation();
  const createMutation = trpc.secret.create.useMutation({
    onSuccess: () => {
      void utils.secret.list.invalidate();
      onClose();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    const vaultKey = session.vaultKeys.get(vaultId);
    if (!vaultKey) {
      setError('Vault key not available — try logging out and back in.');
      return;
    }

    setError(null);
    setIsWorking(true);
    setProgress(0);

    try {
      const { uploadUrl, storageKey } = await uploadUrlMutation.mutateAsync({
        vaultId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      });

      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const { ciphertext: encryptedBytes, iv: fileIv } = encrypt(fileBytes, vaultKey);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.send(new Uint8Array(encryptedBytes));
      });

      const filePayload: FilePayload = {
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
        storage_key: storageKey,
        file_iv: toBase64(fileIv),
      };
      const { ciphertext, iv } = encryptSecret(JSON.stringify(filePayload), vaultKey);

      await createMutation.mutateAsync({
        vaultId,
        type: 'file',
        name: name.trim() || file.name,
        ciphertext: toBase64(ciphertext),
        iv: toBase64(iv),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed — please try again.');
      setProgress(null);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Name <span className="text-gray-300 font-normal normal-case">(optional — defaults to filename)</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. SSH key"
          disabled={isWorking}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <label
        className={`flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed transition-colors ${
          isWorking
            ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
            : file
              ? 'border-indigo-400 bg-indigo-50 cursor-pointer'
              : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50 cursor-pointer'
        }`}
      >
        <span className="text-2xl">{file ? '📄' : '📁'}</span>
        <span className="text-sm font-medium text-gray-700">
          {file ? file.name : 'Click to choose a file'}
        </span>
        {file && <span className="text-xs text-gray-400">{formatBytes(file.size)}</span>}
        <input
          type="file"
          className="sr-only"
          disabled={isWorking}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>

      {progress !== null && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-right text-xs text-gray-400">{progress}%</p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 rounded-lg bg-red-50 px-3 py-2">{error}</p>
      )}

      <EditButtons onCancel={onCancel} isSaving={isWorking || createMutation.isPending} />
    </form>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────

interface Props {
  vaultId: string;
  session: VaultSession;
  onClose: () => void;
}

export function CreateSecretModal({ vaultId, session, onClose }: Props) {
  const [selectedType, setSelectedType] = useState<SecretType | null>(null);
  const utils = trpc.useUtils();

  const createMutation = trpc.secret.create.useMutation({
    onSuccess: () => {
      void utils.secret.list.invalidate();
      onClose();
    },
  });

  const handleCreate = async (name: string, payload: object) => {
    if (!selectedType) return;
    const vaultKey = session.vaultKeys.get(vaultId);
    if (!vaultKey) throw new Error('Vault key not available');

    const { ciphertext, iv } = encryptSecret(JSON.stringify(payload), vaultKey);
    await createMutation.mutateAsync({
      vaultId,
      type: selectedType,
      name,
      ciphertext: toBase64(ciphertext),
      iv: toBase64(iv),
    });
  };

  const typeInfo = TYPES.find((t) => t.type === selectedType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            {selectedType && (
              <button
                type="button"
                onClick={() => setSelectedType(null)}
                className="text-gray-400 hover:text-gray-600 mr-1"
                aria-label="Back"
              >
                ←
              </button>
            )}
            <h2 className="text-base font-semibold text-gray-900">
              {selectedType ? `New ${typeInfo?.label ?? selectedType}` : 'New secret'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5">
          {!selectedType && <TypePicker onPick={setSelectedType} />}

          {selectedType === 'login' && (
            <LoginCreateForm
              onSubmit={handleCreate as (name: string, payload: LoginPayload) => Promise<void>}
              isSaving={createMutation.isPending}
              onCancel={onClose}
            />
          )}
          {selectedType === 'note' && (
            <NoteCreateForm
              onSubmit={handleCreate as (name: string, payload: NotePayload) => Promise<void>}
              isSaving={createMutation.isPending}
              onCancel={onClose}
            />
          )}
          {selectedType === 'env_var' && (
            <EnvVarCreateForm
              onSubmit={handleCreate as (name: string, payload: EnvVarPayload) => Promise<void>}
              isSaving={createMutation.isPending}
              onCancel={onClose}
            />
          )}
          {selectedType === 'card' && (
            <CardCreateForm
              onSubmit={handleCreate as (name: string, payload: CardPayload) => Promise<void>}
              isSaving={createMutation.isPending}
              onCancel={onClose}
            />
          )}
          {selectedType === 'file' && (
            <FileCreateForm
              vaultId={vaultId}
              session={session}
              onCancel={() => setSelectedType(null)}
              onClose={onClose}
            />
          )}

          {createMutation.isError && (
            <p className="mt-3 text-xs text-red-600 rounded-lg bg-red-50 px-3 py-2">
              Failed to create secret. Please try again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
