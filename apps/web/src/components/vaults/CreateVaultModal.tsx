import { zodResolver } from '@hookform/resolvers/zod';
import { createVaultKey, toBase64, wrapVaultKey } from '@silo/crypto';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import type { VaultSession } from '../../context/KeyVaultContext';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';

const schema = z.object({
  name: z.string().min(1, 'Vault name is required').max(100),
  organisationId: z.string().min(1, 'Please select an organisation'),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  session: VaultSession;
  onClose: () => void;
}

export function CreateVaultModal({ session, onClose }: Props) {
  const { addVaultKey } = useKeyVault();
  const utils = trpc.useUtils();
  const [serverError, setServerError] = useState('');

  // Organisation list for the dropdown.
  const { data: orgs, isLoading: orgsLoading } = trpc.org.list.useQuery();

  const createMutation = trpc.vault.create.useMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    try {
      setServerError('');

      // 1. Generate a fresh vault key.
      const vaultKey = createVaultKey();

      // 2. Wrap it with the user's master key (AES-256-GCM).
      const { encryptedVaultKey, iv: vaultKeyIvBytes } = wrapVaultKey(vaultKey, session.masterKey);

      // 3. Create vault on server.
      const newVault = await createMutation.mutateAsync({
        name: values.name,
        organisationId: values.organisationId,
        encryptedVaultKey: toBase64(encryptedVaultKey),
        vaultKeyIv: toBase64(vaultKeyIvBytes),
      });

      // 4. Cache the raw vault key in memory so secrets can be decrypted immediately.
      addVaultKey(newVault.id, vaultKey);

      // 5. Invalidate the vault list so the sidebar and vault page refresh.
      await utils.vault.list.invalidate();

      onClose();
    } catch {
      setServerError('Failed to create vault. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm bg-white rounded-xl shadow-xl p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">New vault</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Vault name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vault name
            </label>
            <input
              {...register('name')}
              type="text"
              placeholder="e.g. Production secrets"
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
            )}
          </div>

          {/* Organisation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organisation
            </label>
            <select
              {...register('organisationId')}
              disabled={orgsLoading}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
            >
              <option value="">
                {orgsLoading ? 'Loading…' : 'Select an organisation'}
              </option>
              {orgs?.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {errors.organisationId && (
              <p className="mt-1 text-xs text-red-600">{errors.organisationId.message}</p>
            )}
          </div>

          {/* Server error */}
          {serverError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? 'Creating…' : 'Create vault'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
