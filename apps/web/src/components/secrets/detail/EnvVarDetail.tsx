import type { EnvVarPayload } from '@silo/shared';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { CopyButton } from '../CopyButton';
import { EditButtons, FormField } from './LoginDetail';

// ── View ──────────────────────────────────────────────────────────────────

function EnvVarView({ payload }: { payload: EnvVarPayload }) {
  const [revealedRows, setRevealedRows] = useState<Set<number>>(new Set());
  const allValues = payload.variables.map((v) => `${v.key}=${v.value}`).join('\n');

  const toggleReveal = (idx: number) =>
    setRevealedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  return (
    <div className="space-y-3">
      {(payload.project || payload.environment) && (
        <div className="flex gap-3 text-xs text-gray-500 mb-2">
          {payload.project && (
            <span>
              <span className="font-medium">Project:</span> {payload.project}
            </span>
          )}
          {payload.environment && (
            <span>
              <span className="font-medium">Env:</span> {payload.environment}
            </span>
          )}
        </div>
      )}

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 w-2/5">KEY</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">VALUE</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {payload.variables.map((v, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs text-gray-700 break-all">{v.key}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs break-all">
                      {revealedRows.has(i)
                        ? v.value
                        : '•'.repeat(Math.min(v.value.length, 16))}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleReveal(i)}
                      className="text-xs text-indigo-600 hover:underline shrink-0"
                    >
                      {revealedRows.has(i) ? 'Hide' : 'Show'}
                    </button>
                    <CopyButton value={v.value} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CopyButton
        value={allValues}
        label="Copy all as .env"
        className="text-sm px-3 py-1.5"
      />
    </div>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────

interface EnvVarFormValues {
  name: string;
  project: string;
  environment: '' | 'development' | 'staging' | 'production';
  variables: { key: string; value: string }[];
}

interface EnvVarEditProps {
  name: string;
  payload: EnvVarPayload;
  onSave: (name: string, payload: EnvVarPayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

function EnvVarEdit({ name, payload, onSave, onCancel, isSaving }: EnvVarEditProps) {
  const { register, control, handleSubmit } = useForm<EnvVarFormValues>({
    defaultValues: {
      name,
      project: payload.project ?? '',
      environment: payload.environment ?? '',
      variables: payload.variables.length > 0 ? payload.variables : [{ key: '', value: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'variables' });

  const submit = handleSubmit(async (values) => {
    const newPayload: EnvVarPayload = {
      variables: values.variables.filter((v) => v.key.trim() !== ''),
      ...(values.project ? { project: values.project } : {}),
      ...(values.environment ? { environment: values.environment } : {}),
    };
    await onSave(values.name, newPayload);
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
                className="text-gray-400 hover:text-red-500 shrink-0 text-lg leading-none"
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

// ── Main export ────────────────────────────────────────────────────────────

interface Props {
  name: string;
  payload: EnvVarPayload;
  mode: 'view' | 'edit';
  onSave: (name: string, payload: EnvVarPayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

export function EnvVarDetail({ name, payload, mode, onSave, onCancel, isSaving }: Props) {
  return mode === 'view' ? (
    <EnvVarView payload={payload} />
  ) : (
    <EnvVarEdit
      name={name}
      payload={payload}
      onSave={onSave}
      onCancel={onCancel}
      isSaving={isSaving}
    />
  );
}
