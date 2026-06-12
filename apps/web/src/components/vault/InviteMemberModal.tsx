import {
  encryptVaultKeyForRecipient,
  fromBase64,
  toBase64,
  unwrapPrivateKey,
} from '@silo/crypto';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';

type Role = 'editor' | 'viewer';

interface Props {
  vaultId: string;
  onClose: () => void;
}

export function InviteMemberModal({ vaultId, onClose }: Props) {
  const { session } = useKeyVault();
  const utils = trpc.useUtils();

  const [role, setRole] = useState<Role>('viewer');
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<{ email: string }>({
    defaultValues: { email: '' },
  });

  const inviteMutation = trpc.vault.invite.useMutation({
    onSuccess: () => void utils.vault.members.invalidate({ vaultId }),
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    if (!session) return;
    setCryptoError(null);

    try {
      // 1. Look up recipient's public key
      const { userId, publicKey: recipientPublicKeyB64 } =
        await utils.client.user.getPublicKey.query({ email });

      // 2. Get the vault key we want to share
      const vaultKey = session.vaultKeys.get(vaultId);
      if (!vaultKey) throw new Error('Vault key not available. Please reload the page.');

      // 3. Unwrap our X25519 private key
      const privateKey = unwrapPrivateKey(
        fromBase64(session.encryptedPrivateKey),
        session.masterKey,
        fromBase64(session.privateKeyIv),
      );

      // 4. ECDH-encrypt the vault key for the recipient
      const { ciphertext, iv } = encryptVaultKeyForRecipient(
        vaultKey,
        fromBase64(recipientPublicKeyB64),
        privateKey,
      );

      // 5. Call the invite procedure
      await inviteMutation.mutateAsync({
        vaultId,
        userId,
        role,
        encryptedVaultKey: toBase64(ciphertext),
        vaultKeyIv: toBase64(iv),
        senderPublicKey: session.publicKey,
      });

      setInvitedEmail(email);
      setStep('success');
    } catch (err: unknown) {
      console.error('Invite failed:', err);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('NOT_FOUND') || msg.includes('No user found')) {
        setCryptoError('No account found with that email address.');
      } else if (msg.includes('CONFLICT')) {
        setCryptoError('This user is already a member or has a pending invite.');
      } else {
        setCryptoError(msg);
      }
    }
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm bg-white rounded-xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Invite to vault</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          {step === 'success' ? (
            <div className="text-center py-4 space-y-3">
              <span className="text-4xl">🎉</span>
              <p className="text-sm font-medium text-gray-900">Invite sent!</p>
              <p className="text-xs text-gray-500">
                <strong>{invitedEmail}</strong> will see the vault next time they sign in.
              </p>
              <button
                onClick={onClose}
                className="mt-2 w-full rounded-lg bg-indigo-600 text-white text-sm py-1.5 hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Email address
                </label>
                <input
                  {...register('email', {
                    required: 'Email is required',
                    validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Invalid email',
                  })}
                  type="email"
                  placeholder="colleague@example.com"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Role
                </label>
                <div className="flex gap-2">
                  {(['editor', 'viewer'] as Role[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={`flex-1 text-sm py-1.5 rounded-lg border transition-colors ${
                        role === r
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {r === 'editor' ? '✏️ Editor' : '👁 Viewer'}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  {role === 'editor'
                    ? 'Can create, edit, and delete secrets.'
                    : 'Can view and copy secrets, cannot modify.'}
                </p>
              </div>

              {cryptoError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {cryptoError}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-gray-200 text-sm text-gray-600 py-1.5 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteMutation.isPending}
                  className="flex-1 rounded-lg bg-indigo-600 text-white text-sm py-1.5 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {inviteMutation.isPending ? 'Inviting…' : 'Send invite'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
