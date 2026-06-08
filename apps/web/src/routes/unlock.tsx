import { deriveMasterKey, fromBase64, unwrapVaultKey } from '@psst/crypto';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { useKeyVault } from '../context/KeyVaultContext';
import { trpcClient, setSessionToken } from '../trpc';
import { parseSaltField } from '../utils/auth';
import { usePageTitle } from '../hooks/usePageTitle';

const schema = z.object({
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

/**
 * Shown when a persisted session token survived a reload but the master key
 * (held in memory only) didn't. Re-derives the master key from the password —
 * no full re-login round trip needed.
 */
export function UnlockPage() {
  usePageTitle('Unlock');
  const navigate = useNavigate();
  const { lockedToken, setSession, clearSession } = useKeyVault();
  const [status, setStatus] = useState<'idle' | 'unlocking' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Nothing to unlock — go to the regular login screen.
  useEffect(() => {
    if (!lockedToken) void navigate({ to: '/login', replace: true });
  }, [lockedToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values: FormValues) => {
    if (!lockedToken) return;

    try {
      setStatus('unlocking');
      setErrorMsg('');

      // Attach the persisted token so `auth.me` resolves against this user.
      setSessionToken(lockedToken);
      const me = await trpcClient.auth.me.query();

      const { masterSalt } = parseSaltField(me.argon2Salt);
      const masterKey = deriveMasterKey(values.password, masterSalt);

      // Wrong password would derive the wrong key and fail to unwrap here —
      // this is the cryptographic proof the password is correct.
      unwrapVaultKey(fromBase64(me.encryptedVaultKey), masterKey, fromBase64(me.vaultKeyIv));

      const vaultKeys = new Map<string, Uint8Array>();
      setSession({
        userId: me.id,
        sessionToken: lockedToken,
        masterKey,
        vaultKeys,
        encryptedPrivateKey: me.encryptedPrivateKey,
        privateKeyIv: me.privateKeyIv,
        publicKey: me.publicKey,
      });

      navigate({ to: '/' });
    } catch (err: unknown) {
      const code = (err as { data?: { code?: string } })?.data?.code;
      if (code === 'UNAUTHORIZED') {
        // The token itself is no longer valid server-side — full logout.
        clearSession();
        setSessionToken(null);
        void navigate({ to: '/login', replace: true });
        return;
      }

      setStatus('error');
      setErrorMsg('Incorrect password.');
      console.error(err);
    }
  };

  const handleSignOut = () => {
    clearSession();
    setSessionToken(null);
    void navigate({ to: '/login', replace: true });
  };

  const isLoading = status === 'unlocking';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">🔐 Vault locked</h1>
          <p className="mt-2 text-sm text-gray-500">Enter your master password to unlock.</p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4 rounded-xl bg-white p-8 shadow-sm border border-gray-100"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700">Master password</label>
            <input
              {...register('password')}
              type="password"
              autoComplete="current-password"
              autoFocus
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>

          {status === 'error' && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Unlocking…' : 'Unlock'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Not you?{' '}
            <button
              type="button"
              onClick={handleSignOut}
              className="text-indigo-600 hover:underline"
            >
              Sign out
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
