import type { LoginPayload } from '@psst/shared';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { CopyButton } from '../CopyButton';
import { generateTotp, totpSecondsLeft } from '../../../utils/totp';

// ── TOTP live code ─────────────────────────────────────────────────────────

function TotpCode({ secret }: { secret: string }) {
  const [code, setCode] = useState('······');
  const [secsLeft, setSecsLeft] = useState(30);

  useEffect(() => {
    let active = true;
    async function tick() {
      const c = await generateTotp(secret).catch(() => '------');
      if (active) {
        setCode(c);
        setSecsLeft(totpSecondsLeft());
      }
    }
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [secret]);

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-2xl tracking-widest text-indigo-700">{code}</span>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-xs text-gray-400">{secsLeft}s</span>
        <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-400 rounded-full transition-none"
            style={{ width: `${(secsLeft / 30) * 100}%` }}
          />
        </div>
      </div>
      <CopyButton value={code} label="Copy code" />
    </div>
  );
}

// ── Masked field (password / sensitive text) ───────────────────────────────

function MaskedField({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-mono text-sm break-all">
        {revealed ? value : '•'.repeat(Math.min(value.length, 20))}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="text-xs text-indigo-600 hover:underline shrink-0"
      >
        {revealed ? 'Hide' : 'Reveal'}
      </button>
      <CopyButton value={value} />
    </div>
  );
}

// ── View mode ─────────────────────────────────────────────────────────────

function LoginView({ payload }: { payload: LoginPayload }) {
  return (
    <div className="space-y-4">
      {payload.url && (
        <Row label="URL">
          <a
            href={payload.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-600 hover:underline break-all"
          >
            {payload.url}
          </a>
        </Row>
      )}

      <Row label="Username">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono">{payload.username}</span>
          <CopyButton value={payload.username} />
        </div>
      </Row>

      <Row label="Password">
        <MaskedField value={payload.password} />
      </Row>

      {payload.totp_secret && (
        <Row label="One-time code">
          <TotpCode secret={payload.totp_secret} />
        </Row>
      )}

      {payload.notes && (
        <Row label="Notes">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{payload.notes}</p>
        </Row>
      )}
    </div>
  );
}

// ── Edit mode ─────────────────────────────────────────────────────────────

interface LoginEditProps {
  name: string;
  payload: LoginPayload;
  onSave: (name: string, payload: LoginPayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

export function LoginEdit({ name, payload, onSave, onCancel, isSaving }: LoginEditProps) {
  const { register, handleSubmit } = useForm({
    defaultValues: {
      name,
      username: payload.username,
      password: payload.password,
      url: payload.url ?? '',
      totp_secret: payload.totp_secret ?? '',
      notes: payload.notes ?? '',
    },
  });

  const submit = handleSubmit(async (values) => {
    const newPayload: LoginPayload = {
      username: values.username,
      password: values.password,
      ...(values.url ? { url: values.url } : {}),
      ...(values.totp_secret ? { totp_secret: values.totp_secret } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    };
    await onSave(values.name, newPayload);
  });

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Name" {...register('name')} required />
      <FormField label="URL" {...register('url')} type="url" />
      <FormField label="Username" {...register('username')} required />
      <FormField label="Password" {...register('password')} type="password" required />
      <FormField label="TOTP secret" {...register('totp_secret')} placeholder="base32 secret" />
      <FormTextarea label="Notes" {...register('notes')} />
      <EditButtons onCancel={onCancel} isSaving={isSaving} />
    </form>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

interface Props {
  name: string;
  payload: LoginPayload;
  mode: 'view' | 'edit';
  onSave: (name: string, payload: LoginPayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

export function LoginDetail({ name, payload, mode, onSave, onCancel, isSaving }: Props) {
  return mode === 'view' ? (
    <LoginView payload={payload} />
  ) : (
    <LoginEdit name={name} payload={payload} onSave={onSave} onCancel={onCancel} isSaving={isSaving} />
  );
}

// ── Shared form helpers ────────────────────────────────────────────────────

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</p>
      {children}
    </div>
  );
}

export const FormField = ({
  label,
  required,
  type = 'text',
  placeholder,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
      {label}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
    <input
      type={type}
      placeholder={placeholder}
      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      {...rest}
    />
  </div>
);

export const FormTextarea = ({
  label,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
      {label}
    </label>
    <textarea
      rows={4}
      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
      {...rest}
    />
  </div>
);

export function EditButtons({ onCancel, isSaving }: { onCancel: () => void; isSaving: boolean }) {
  return (
    <div className="flex gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 rounded-lg border border-gray-200 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isSaving}
        className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {isSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
