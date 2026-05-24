import {
  deriveMasterKey,
  fromBase64,
  generateSalt,
  toBase64,
  unwrapPrivateKey,
  wrapPrivateKey,
  wrapVaultKey,
} from '@psst/crypto';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';
import { encodeSaltField } from '../../utils/auth';
import { usePageTitle } from '../../hooks/usePageTitle';
import { PasswordStrength } from '../../components/ui/PasswordStrength';

// ── Change Email ───────────────────────────────────────────────────────────

function ChangeEmailSection({ currentEmail }: { currentEmail: string }) {
  const utils = trpc.useUtils();
  const mutation = trpc.auth.changeEmail.useMutation({
    onSuccess: () => void utils.auth.me.invalidate(),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: { newEmail: '' },
  });

  const onSubmit = handleSubmit(async ({ newEmail }) => {
    await mutation.mutateAsync({ newEmail });
    reset();
  });

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">Email address</h2>
      <p className="text-sm text-gray-500 mb-4">
        Current: <span className="font-medium text-gray-900">{currentEmail}</span>
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3 max-w-sm">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            New email
          </label>
          <input
            {...register('newEmail', { required: 'Required', validate: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Invalid email' })}
            type="email"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {errors.newEmail && <p className="mt-1 text-xs text-red-600">{errors.newEmail.message}</p>}
        </div>
        {mutation.isError && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">
            {mutation.error.message}
          </p>
        )}
        {mutation.isSuccess && (
          <p className="text-xs text-green-700 bg-green-50 rounded px-3 py-2">
            Email updated ✓
          </p>
        )}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Update email'}
        </button>
      </form>
    </section>
  );
}

// ── Change Password ────────────────────────────────────────────────────────

function ChangePasswordSection() {
  const { session, setSession } = useKeyVault();
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const mutation = trpc.auth.changePassword.useMutation();

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm({
    defaultValues: { newPassword: '', confirmPassword: '' },
  });
  const newPassword = watch('newPassword');

  const onSubmit = handleSubmit(async ({ newPassword: pwd }) => {
    if (!session) return;
    setStatus('working');
    setErrorMsg('');

    try {
      // 1. Generate fresh salts for the new master key + auth hash
      const newMasterSalt = generateSalt();
      const newAuthSalt = generateSalt();
      const newArgon2Salt = encodeSaltField(newMasterSalt, newAuthSalt);

      // 2. Derive new master key
      const newMasterKey = deriveMasterKey(pwd, newMasterSalt);

      // 3. Compute new auth hash
      const newAuthKey = deriveMasterKey(`auth:${pwd}`, newAuthSalt);
      const newAuthHash = toBase64(newAuthKey);

      // 4. Unwrap private key with OLD master key, re-wrap with NEW
      const privateKey = unwrapPrivateKey(
        fromBase64(session.encryptedPrivateKey),
        session.masterKey,
        fromBase64(session.privateKeyIv),
      );
      const { encryptedPrivateKey: newEncPK, iv: newPKIv } = wrapPrivateKey(privateKey, newMasterKey);

      // 5. Re-wrap all active vault keys
      const vaultKeysList = [...session.vaultKeys.entries()].map(([vaultId, vaultKey]) => {
        const { encryptedVaultKey, iv } = wrapVaultKey(vaultKey, newMasterKey);
        return {
          vaultId,
          encryptedVaultKey: toBase64(encryptedVaultKey),
          vaultKeyIv: toBase64(iv),
        };
      });

      // 6. Update server
      await mutation.mutateAsync({
        newAuthHash,
        newArgon2Salt,
        newEncryptedPrivateKey: toBase64(newEncPK),
        newPrivateKeyIv: toBase64(newPKIv),
        vaultKeys: vaultKeysList,
      });

      // 7. Update session in memory
      setSession({
        ...session,
        masterKey: newMasterKey,
        encryptedPrivateKey: toBase64(newEncPK),
        privateKeyIv: toBase64(newPKIv),
      });

      reset();
      setStatus('done');
    } catch (err) {
      console.error('Password change failed:', err);
      setErrorMsg('Password change failed. Please try again.');
      setStatus('error');
    }
  });

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Change master password</h2>
      <p className="text-xs text-gray-500 mb-4">
        All vault keys will be re-encrypted with your new password.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3 max-w-sm">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            New password
          </label>
          <input
            {...register('newPassword', { required: 'Required', minLength: { value: 12, message: 'Minimum 12 characters' } })}
            type="password"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {errors.newPassword && <p className="mt-1 text-xs text-red-600">{errors.newPassword.message}</p>}
          <PasswordStrength password={newPassword} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Confirm password
          </label>
          <input
            {...register('confirmPassword', {
              required: 'Required',
              validate: v => v === newPassword || 'Passwords do not match',
            })}
            type="password"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {errors.confirmPassword && <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>}
        </div>

        {status === 'error' && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{errorMsg}</p>
        )}
        {status === 'done' && (
          <p className="text-xs text-green-700 bg-green-50 rounded px-3 py-2">
            Password changed successfully ✓
          </p>
        )}

        <button
          type="submit"
          disabled={status === 'working'}
          className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
        >
          {status === 'working' ? 'Re-encrypting…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}

// ── Delete Account ─────────────────────────────────────────────────────────

function DeleteAccountSection() {
  const { clearSession } = useKeyVault();
  const [confirm, setConfirm] = useState(false);
  const mutation = trpc.auth.deleteAccount.useMutation({
    onSuccess: () => {
      clearSession();
      window.location.href = '/login';
    },
  });

  return (
    <section className="bg-white rounded-xl border border-red-200 p-6">
      <h2 className="text-sm font-semibold text-red-700 mb-1">Delete account</h2>
      <p className="text-xs text-gray-500 mb-4">
        Permanently deletes your account and all vaults you own. This cannot be undone.
      </p>
      {!confirm ? (
        <button
          onClick={() => setConfirm(true)}
          className="rounded-lg border border-red-300 text-red-700 text-sm px-4 py-1.5 hover:bg-red-50"
        >
          Delete my account
        </button>
      ) : (
        <div className="space-y-3 max-w-sm">
          <p className="text-sm text-red-700 font-medium">Are you absolutely sure?</p>
          <div className="flex gap-2">
            <button
              onClick={() => void mutation.mutateAsync()}
              disabled={mutation.isPending}
              className="flex-1 rounded-lg bg-red-600 text-white text-sm py-1.5 hover:bg-red-700 disabled:opacity-50"
            >
              {mutation.isPending ? 'Deleting…' : 'Yes, delete everything'}
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="flex-1 rounded-lg border border-gray-200 text-sm text-gray-600 py-1.5 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function ProfileSettingsPage() {
  usePageTitle('Profile');
  const { data: me, isLoading } = trpc.auth.me.useQuery();

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-xl">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-xl bg-gray-200 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account settings.</p>
      </div>

      <ChangeEmailSection currentEmail={me?.email ?? ''} />
      <ChangePasswordSection />
      <DeleteAccountSection />
    </div>
  );
}
