import type { NotePayload } from '@psst/shared';
import Markdown from 'react-markdown';
import { useForm } from 'react-hook-form';
import { EditButtons, FormField, FormTextarea } from './LoginDetail';

// ── View ──────────────────────────────────────────────────────────────────

function NoteView({ payload }: { payload: NotePayload }) {
  return (
    <div className="prose prose-sm max-w-none text-gray-700">
      <Markdown>{payload.content}</Markdown>
    </div>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────

interface NoteEditProps {
  name: string;
  payload: NotePayload;
  onSave: (name: string, payload: NotePayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

function NoteEdit({ name, payload, onSave, onCancel, isSaving }: NoteEditProps) {
  const { register, handleSubmit } = useForm({
    defaultValues: { name, content: payload.content },
  });

  const submit = handleSubmit(async (values) => {
    await onSave(values.name, { content: values.content });
  });

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Name" {...register('name')} required />
      <FormTextarea label="Content (Markdown)" {...register('content')} rows={12} />
      <EditButtons onCancel={onCancel} isSaving={isSaving} />
    </form>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

interface Props {
  name: string;
  payload: NotePayload;
  mode: 'view' | 'edit';
  onSave: (name: string, payload: NotePayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

export function NoteDetail({ name, payload, mode, onSave, onCancel, isSaving }: Props) {
  return mode === 'view' ? (
    <NoteView payload={payload} />
  ) : (
    <NoteEdit name={name} payload={payload} onSave={onSave} onCancel={onCancel} isSaving={isSaving} />
  );
}
