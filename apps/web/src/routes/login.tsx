import { deriveMasterKey, fromBase64, toBase64, unwrapVaultKey } from '@psst/crypto';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { useKeyVault } from '../context/KeyVaultContext';
import { trpcClient, setSessionToken } from '../trpc';
import { parseSaltField } from '../utils/auth';

const schema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;


export function LoginPage() {
  const navigate = useNavigate();
  const { setSession, addVaultKey } = useKeyVault();
  const [status, setStatus] = useState<'idle' | 'fetching-salt' | 'deriving' | 'submitting' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    try {
      setStatus('fetching-salt');
      setErrorMsg('');

      // 1. Fetch argon2 salt (needed before we can derive the master key)
      const { argon2Salt: argon2SaltFull } = await trpcClient.auth.getSalt.query({
        email: values.email,
      });

      setStatus('deriving');

      // 2. Derive master key (slow — show spinner)
      const { masterSalt, authSalt } = parseSaltField(argon2SaltFull);
      const masterKey = deriveMasterKey(values.password, masterSalt);

      // 3. Compute auth hash for server verification
      const authKey = deriveMasterKey(`auth:${values.password}`, authSalt);
      const authHash = toBase64(authKey);

      setStatus('submitting');

      // 4. Login — server verifies authHash, returns encrypted credential blobs
      const result = await trpcClient.auth.login.mutate({
        email: values.email,
        authHash,
      });

      // 5. Unwrap vault key client-side using master key
      // Wrong password would have failed at argon2 derivation or server authHash check;
      // this is the final cryptographic verification.
      const vaultKey = unwrapVaultKey(
        fromBase64(result.encryptedVaultKey),
        masterKey,
        fromBase64(result.vaultKeyIv),
      );

      // 6. Store everything in memory (private key stays encrypted until needed)
      setSessionToken(result.sessionToken);
      const vaultKeys = new Map<string, Uint8Array>();
      setSession({
        userId: result.userId,
        sessionToken: result.sessionToken,
        masterKey,
        vaultKeys,
        encryptedPrivateKey: result.encryptedPrivateKey,
        privateKeyIv: result.privateKeyIv,
        publicKey: result.publicKey,
      });

      navigate({ to: '/' });
    } catch (err: unknown) {
      setStatus('error');
      // Never expose technical errors — always show generic message
      setErrorMsg('Incorrect email or password.');
      console.error(err);
    }
  };

  const isLoading = status !== 'idle' && status !== 'error';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Sign in to Psst</h1>
          <p className="mt-2 text-sm text-gray-500">Your secrets stay encrypted end-to-end.</p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4 rounded-xl bg-white p-8 shadow-sm border border-gray-100"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              {...register('email')}
              type="email"
              autoComplete="email"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Master password</label>
            <input
              {...register('password')}
              type="password"
              autoComplete="current-password"
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
            {status === 'fetching-salt'
              ? 'Looking up account…'
              : status === 'deriving'
                ? 'Deriving keys… (this takes a moment)'
                : status === 'submitting'
                  ? 'Signing in…'
                  : 'Sign in'}
          </button>

          <p className="text-center text-sm text-gray-500">
            No account yet?{' '}
            <Link to="/register" className="text-indigo-600 hover:underline">
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
