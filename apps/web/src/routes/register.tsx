import {
  deriveMasterKey,
  fromBase64,
  generateKeypair,
  generateSalt,
  toBase64,
  wrapPrivateKey,
  wrapVaultKey,
  createVaultKey,
} from '@psst/crypto';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { useKeyVault } from '../context/KeyVaultContext';
import { trpcClient, setSessionToken } from '../trpc';
import { PasswordStrength } from '../components/ui/PasswordStrength';
import { usePageTitle } from '../hooks/usePageTitle';

const schema = z
  .object({
    email: z.email(),
    password: z.string().min(12, 'Password must be at least 12 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  usePageTitle('Create account');
  const navigate = useNavigate();
  const { setSession } = useKeyVault();
  const [status, setStatus] = useState<'idle' | 'deriving' | 'submitting' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });
  const passwordValue = watch('password', '');

  const onSubmit = async (values: FormValues) => {
    try {
      setStatus('deriving');
      setErrorMsg('');

      // --- Client-side key generation ---
      // 1. Salt for master key derivation (stored on server)
      const argon2SaltBytes = generateSalt();
      const argon2Salt = toBase64(argon2SaltBytes);

      // 2. Derive master key from password (slow — show spinner)
      const masterKey = deriveMasterKey(values.password, argon2SaltBytes);

      // 3. Create and wrap vault key
      const vaultKey = createVaultKey();
      const { encryptedVaultKey, iv: vaultKeyIvBytes } = wrapVaultKey(vaultKey, masterKey);

      // 4. Generate X25519 keypair and wrap private key
      const { publicKey: publicKeyBytes, privateKey: privateKeyBytes } = generateKeypair();
      const { encryptedPrivateKey, iv: privateKeyIvBytes } = wrapPrivateKey(
        privateKeyBytes,
        masterKey,
      );

      // 5. Auth hash: second argon2 derivation with a separate salt (different from master key salt)
      // We use a fixed domain separator so the auth hash can never be the master key
      const authSaltBytes = generateSalt();
      const authKey = deriveMasterKey(`auth:${values.password}`, authSaltBytes);
      const authHash = toBase64(authKey);
      // Store the auth salt alongside argon2Salt in a combined base64 (auth_salt|argon2_salt)
      // The server only needs argon2Salt for the client to re-derive the master key.
      // authHash verification uses a separate derivation the client always recomputes.
      // For simplicity: encode authSalt into the argon2Salt field as JSON.
      const argon2SaltFull = toBase64(
        new TextEncoder().encode(
          JSON.stringify({
            masterSalt: argon2Salt,
            authSalt: toBase64(authSaltBytes),
          }),
        ),
      );

      setStatus('submitting');

      const result = await trpcClient.auth.register.mutate({
        email: values.email,
        argon2Salt: argon2SaltFull,
        authHash,
        encryptedVaultKey: toBase64(encryptedVaultKey),
        vaultKeyIv: toBase64(vaultKeyIvBytes),
        publicKey: toBase64(publicKeyBytes),
        encryptedPrivateKey: toBase64(encryptedPrivateKey),
        privateKeyIv: toBase64(privateKeyIvBytes),
      });

      // Store session in memory (private key stays encrypted until the invite flow needs it)
      setSessionToken(result.sessionToken);
      const vaultKeys = new Map<string, Uint8Array>();
      setSession({
        userId: result.userId,
        sessionToken: result.sessionToken,
        masterKey,
        vaultKeys,
        encryptedPrivateKey: toBase64(encryptedPrivateKey),
        privateKeyIv: toBase64(privateKeyIvBytes),
        publicKey: toBase64(publicKeyBytes),
        encryptedVaultKey: toBase64(encryptedVaultKey),
        vaultKeyIv: toBase64(vaultKeyIvBytes),
      });

      navigate({ to: '/' });
    } catch (err) {
      setStatus('error');
      setErrorMsg('Registration failed. Please try again.');
      console.error(err);
    }
  };

  const isLoading = status === 'deriving' || status === 'submitting';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Create your account</h1>
          <p className="mt-2 text-sm text-gray-500">
            Your master password is never sent to our servers.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl bg-white p-8 shadow-sm border border-gray-100">
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
              autoComplete="new-password"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            )}
            <PasswordStrength password={passwordValue} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Confirm password</label>
            <input
              {...register('confirmPassword')}
              type="password"
              autoComplete="new-password"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
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
            {status === 'deriving'
              ? 'Deriving keys… (this takes a moment)'
              : status === 'submitting'
                ? 'Creating account…'
                : 'Create account'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="text-indigo-600 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
