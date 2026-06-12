import type { CardPayload } from '@silo/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CopyButton } from '../CopyButton';
import { EditButtons, FormField, FormTextarea, Row } from './LoginDetail';

// ── Masked card number helper ──────────────────────────────────────────────

function MaskedCardNumber({ number }: { number: string }) {
  const [revealed, setRevealed] = useState(false);
  const display = revealed
    ? number
    : number.replace(/\d(?=\d{4})/g, '•').replace(/(.{4})/g, '$1 ').trim();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-mono text-sm tracking-widest">{display}</span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="text-xs text-indigo-600 hover:underline shrink-0"
      >
        {revealed ? 'Hide' : 'Reveal'}
      </button>
      <CopyButton value={number.replace(/\s/g, '')} label="Copy" />
    </div>
  );
}

function MaskedCvv({ cvv }: { cvv: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm">{revealed ? cvv : '•••'}</span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="text-xs text-indigo-600 hover:underline"
      >
        {revealed ? 'Hide' : 'Reveal'}
      </button>
      <CopyButton value={cvv} />
    </div>
  );
}

// ── View ──────────────────────────────────────────────────────────────────

function CardView({ payload }: { payload: CardPayload }) {
  return (
    <div className="space-y-4">
      <Row label="Card number">
        <MaskedCardNumber number={payload.number} />
      </Row>

      <Row label="Cardholder">
        <div className="flex items-center gap-2">
          <span className="text-sm">{payload.cardholder}</span>
          <CopyButton value={payload.cardholder} />
        </div>
      </Row>

      <div className="grid grid-cols-2 gap-4">
        <Row label="Expiry">
          <span className="text-sm font-mono">{payload.expiry}</span>
        </Row>
        <Row label="CVV">
          <MaskedCvv cvv={payload.cvv} />
        </Row>
      </div>

      {payload.notes && (
        <Row label="Notes">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{payload.notes}</p>
        </Row>
      )}
    </div>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────

interface CardEditProps {
  name: string;
  payload: CardPayload;
  onSave: (name: string, payload: CardPayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

function CardEdit({ name, payload, onSave, onCancel, isSaving }: CardEditProps) {
  const { register, handleSubmit } = useForm({
    defaultValues: {
      name,
      number: payload.number,
      cardholder: payload.cardholder,
      expiry: payload.expiry,
      cvv: payload.cvv,
      notes: payload.notes ?? '',
    },
  });

  const submit = handleSubmit(async (values) => {
    const newPayload: CardPayload = {
      number: values.number,
      cardholder: values.cardholder,
      expiry: values.expiry,
      cvv: values.cvv,
      ...(values.notes ? { notes: values.notes } : {}),
    };
    await onSave(values.name, newPayload);
  });

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Name" {...register('name')} required />
      <FormField label="Card number" {...register('number')} placeholder="1234 5678 9012 3456" required />
      <FormField label="Cardholder" {...register('cardholder')} required />
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Expiry" {...register('expiry')} placeholder="MM/YY" required />
        <FormField label="CVV" {...register('cvv')} required />
      </div>
      <FormTextarea label="Notes" {...register('notes')} />
      <EditButtons onCancel={onCancel} isSaving={isSaving} />
    </form>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

interface Props {
  name: string;
  payload: CardPayload;
  mode: 'view' | 'edit';
  onSave: (name: string, payload: CardPayload) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

export function CardDetail({ name, payload, mode, onSave, onCancel, isSaving }: Props) {
  return mode === 'view' ? (
    <CardView payload={payload} />
  ) : (
    <CardEdit name={name} payload={payload} onSave={onSave} onCancel={onCancel} isSaving={isSaving} />
  );
}
