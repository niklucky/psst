import { deriveMasterKey, fromBase64, toBase64, unwrapVaultKey } from '@psst/crypto';
import { zodResolver } from '@hookform/resolvers/zod';
import { startAuthentication } from '@simplewebauthn/browser';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { useKeyVault } from '../context/KeyVaultContext';
import { trpcClient, setSessionToken } from '../trpc';
import { parseSaltField } from '../utils/auth';
import { usePageTitle } from '../hooks/usePageTitle';

const schema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

const codeSchema = z.object({
  code: z.string().min(1, 'Code is required'),
});

type CodeFormValues = z.infer<typeof codeSchema>;

/** Result of a successful login or completed step-up challenge. */
interface LoginResult {
  sessionToken: string;
  userId: string;
  encryptedVaultKey: string;
  vaultKeyIv: string;
  publicKey: string;
  encryptedPrivateKey: string;
  privateKeyIv: string;
}

export function LoginPage() {
  usePageTitle('Sign in');
  const navigate = useNavigate();
  const { setSession, lockedToken, beginLockedSession } = useKeyVault();
  const [status, setStatus] = useState<'idle' | 'fetching-salt' | 'deriving' | 'submitting' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [passkeyStatus, setPasskeyStatus] = useState<'idle' | 'authenticating'>('idle');

  // Step-up challenge state — set when the server requires an emailed code.
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null);
  const [codeStatus, setCodeStatus] = useState<'idle' | 'verifying' | 'error'>('idle');
  const [codeErrorMsg, setCodeErrorMsg] = useState('');

  // A session token survived a reload — send to /unlock instead of a full re-login.
  useEffect(() => {
    if (lockedToken) void navigate({ to: '/unlock', replace: true });
  }, [lockedToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const {
    register: registerCode,
    handleSubmit: handleCodeSubmit,
    formState: { errors: codeErrors },
  } = useForm<CodeFormValues>({ resolver: zodResolver(codeSchema) });

  const finishLogin = (result: LoginResult, masterKey: Uint8Array) => {
    // Wrong password would have failed at argon2 derivation or server authHash check;
    // this is the final cryptographic verification.
    const vaultKey = unwrapVaultKey(
      fromBase64(result.encryptedVaultKey),
      masterKey,
      fromBase64(result.vaultKeyIv),
    );

    // Store everything in memory (private key stays encrypted until needed)
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
      encryptedVaultKey: result.encryptedVaultKey,
      vaultKeyIv: result.vaultKeyIv,
    });

    navigate({ to: '/' });
  };

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
      const derivedMasterKey = deriveMasterKey(values.password, masterSalt);

      // 3. Compute auth hash for server verification
      const authKey = deriveMasterKey(`auth:${values.password}`, authSalt);
      const authHash = toBase64(authKey);

      setStatus('submitting');

      // 4. Login — server verifies authHash, returns encrypted credential blobs
      //    (or a step-up challenge if this device/login looks risky)
      const result = await trpcClient.auth.login.mutate({
        email: values.email,
        authHash,
      });

      if (result.challengeRequired) {
        setMasterKey(derivedMasterKey);
        setChallengeId(result.challengeId);
        setStatus('idle');
        return;
      }

      finishLogin(result, derivedMasterKey);
    } catch (err: unknown) {
      setStatus('error');
      // Never expose technical errors — always show generic message
      setErrorMsg('Incorrect email or password.');
      console.error(err);
    }
  };

  // Passkey login is auth-only: it creates a session without the master password,
  // so we land on /unlock to derive the encryption key — exactly like a reload.
  const onPasskeyLogin = async () => {
    try {
      setPasskeyStatus('authenticating');
      setErrorMsg('');

      const { challengeId: cid, options } = await trpcClient.auth.webauthnLoginOptions.mutate();
      const response = await startAuthentication({ optionsJSON: options });
      const result = await trpcClient.auth.webauthnLoginVerify.mutate({ challengeId: cid, response });

      if (result.challengeRequired) {
        // Passkey synced to an unrecognized device → email step-up. No master
        // key in this flow, so onSubmitCode routes to /unlock once verified.
        setChallengeId(result.challengeId);
        setPasskeyStatus('idle');
        return;
      }

      beginLockedSession(result.sessionToken);
      void navigate({ to: '/unlock' });
    } catch (err) {
      setPasskeyStatus('idle');
      setStatus('error');
      setErrorMsg('Passkey sign-in failed or was cancelled.');
      console.error(err);
    }
  };

  const onSubmitCode = async (values: CodeFormValues) => {
    if (!challengeId) return;

    try {
      setCodeStatus('verifying');
      setCodeErrorMsg('');

      const result = await trpcClient.auth.verifyLoginChallenge.mutate({
        challengeId,
        code: values.code.trim(),
      });

      if (result.challengeRequired) {
        // Should not happen — verifyLoginChallenge always resolves to a session.
        throw new Error('Unexpected challenge response');
      }

      if (masterKey) {
        // Password login: we already derived the key — finish unlocking now.
        finishLogin(result, masterKey);
      } else {
        // Passkey login: no master key yet — go to /unlock for the password.
        beginLockedSession(result.sessionToken);
        void navigate({ to: '/unlock' });
      }
    } catch (err) {
      setCodeStatus('error');
      setCodeErrorMsg('Incorrect or expired code. Please try again.');
      console.error(err);
    }
  };

  const isLoading = status !== 'idle' && status !== 'error';

  if (challengeId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900">Verification required</h1>
            <p className="mt-2 text-sm text-gray-500">
              Enter the code from your email or authenticator app (or a backup code) to finish signing in.
            </p>
          </div>

          <form
            onSubmit={handleCodeSubmit(onSubmitCode)}
            className="space-y-4 rounded-xl bg-white p-8 shadow-sm border border-gray-100"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700">Verification code</label>
              <input
                {...registerCode('code')}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm tracking-widest focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {codeErrors.code && (
                <p className="mt-1 text-xs text-red-600">{codeErrors.code.message}</p>
              )}
            </div>

            {codeStatus === 'error' && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{codeErrorMsg}</p>
            )}

            <button
              type="submit"
              disabled={codeStatus === 'verifying'}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {codeStatus === 'verifying' ? 'Verifying…' : 'Verify and sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

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

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-gray-200" />
            <span className="text-xs uppercase tracking-wider text-gray-400">or</span>
            <span className="h-px flex-1 bg-gray-200" />
          </div>

          <button
            type="button"
            onClick={() => void onPasskeyLogin()}
            disabled={isLoading || passkeyStatus === 'authenticating'}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {passkeyStatus === 'authenticating' ? 'Waiting for passkey…' : '🔑 Sign in with a passkey'}
          </button>

          <p className="text-center text-sm text-gray-500">
            <Link to="/recover" className="text-indigo-600 hover:underline">
              Forgot your password?
            </Link>
          </p>

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
