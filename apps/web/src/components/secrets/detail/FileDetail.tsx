import type { FilePayload } from '@psst/shared';
import { useForm } from 'react-hook-form';
import { EditButtons, FormField, Row } from './LoginDetail';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── View ──────────────────────────────────────────────────────────────────

function FileView({ payload }: { payload: FilePayload }) {
  return (
    <div className="space-y-4">
      <Row label="Filename">
        <span className="text-sm font-mono">{payload.filename}</span>
      </Row>

      <Row label="Type">
        <span className="text-sm">{payload.mime_type}</span>
      </Row>

      <Row label="Size">
        <span className="text-sm">{formatBytes(payload.size)}</span>
      </Row>

      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
        <p className="text-sm text-gray-500">
          📦 File download coming in a later session (requires object storage setup).
        </p>
      </div>
    </div>
  );
}

// ── Edit (minimal — file re-upload deferred) ──────────────────────────────

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
    // File re-upload deferred — only allows renaming for now.
    await onSave(values.name, payload);
  });

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Name" {...register('name')} required />
      <p className="text-xs text-gray-400">
        File replacement requires object storage — coming in a later session.
      </p>
      <EditButtons onCancel={onCancel} isSaving={isSaving} />
    </form>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

interface Props {
  name: string;
  payload: FilePayload;
  mode: 'view' | 'edit';
  onSave: (name: string, payload: FilePayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

export function FileDetail({ name, payload, mode, onSave, onCancel, isSaving }: Props) {
  return mode === 'view' ? (
    <FileView payload={payload} />
  ) : (
    <FileEdit name={name} payload={payload} onSave={onSave} onCancel={onCancel} isSaving={isSaving} />
  );
}
