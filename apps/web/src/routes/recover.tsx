import {
  deriveMasterKey,
  fromBase64,
  generateRecoveryCode,
  generateSalt,
  normalizeRecoveryCode,
  toBase64,
  unwrapMasterKey,
  unwrapPrivateKey,
  unwrapVaultKey,
  wrapPrivateKey,
  wrapVaultKey,
} from '@psst/crypto';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { useKeyVault } from '../context/KeyVaultContext';
import { trpcClient, setSessionToken } from '../trpc';
import { buildRecoveryBlob, encodeSaltField } from '../utils/auth';
import { usePageTitle } from '../hooks/usePageTitle';
import { PasswordStrength } from '../components/ui/PasswordStrength';

const emailSchema = z.object({ email: z.email() });
type EmailValues = z.infer<typeof emailSchema>;

const resetSchema = z
  .object({
    recoveryCode: z.string().min(1, 'Recovery code is required'),
    newPassword: z.string().min(12, 'Password must be at least 12 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type ResetValues = z.infer<typeof resetSchema>;

/** Server blobs returned by `beginRecovery`, needed to re-wrap under the new key. */
type RecoveryData = Awaited<ReturnType<typeof trpcClient.auth.beginRecovery.mutate>>;

/**
 * "Forgot my master password" recovery. Unwraps the master key from the
 * recovery code, re-encrypts everything under a new password, rotates the
 * recovery code, and lands the user in their unlocked vault.
 */
export function RecoverPage() {
  usePageTitle('Recover account');
  const navigate = useNavigate();
  const { setSession } = useKeyVault();

  const [step, setStep] = useState<'email' | 'reset' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [recoveryData, setRecoveryData] = useState<RecoveryData | null>(null);
  const [newRecoveryCode, setNewRecoveryCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [working, setWorking] = useState(false);

  const emailForm = useForm<EmailValues>({ resolver: zodResolver(emailSchema) });
  const resetForm = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });
  const newPassword = resetForm.watch('newPassword', '');

  const onSubmitEmail = async (values: EmailValues) => {
    setErrorMsg('');
    setWorking(true);
    try {
      const data = await trpcClient.auth.beginRecovery.mutate({ email: values.email });
      setEmail(values.email);
      setRecoveryData(data);
      setStep('reset');
    } catch {
      // Generic — don't reveal whether the email/recovery key exists.
      setErrorMsg('No recovery key found for this account.');
    } finally {
      setWorking(false);
    }
  };

  const onSubmitReset = async (values: ResetValues) => {
    if (!recoveryData) return;
    setErrorMsg('');
    setWorking(true);

    try {
      const normalized = normalizeRecoveryCode(values.recoveryCode);

      // 1. Unwrap the OLD master key from the recovery code. A wrong code fails
      //    AES-GCM authentication here — the cryptographic proof it's correct.
      const recoveryKey = deriveMasterKey(normalized, fromBase64(recoveryData.recoverySalt));
      let oldMasterKey: Uint8Array;
      try {
        oldMasterKey = unwrapMasterKey(
          fromBase64(recoveryData.wrappedMasterKey),
          recoveryKey,
          fromBase64(recoveryData.recoveryKeyIv),
        );
      } catch {
        setErrorMsg('Incorrect recovery code.');
        setWorking(false);
        return;
      }

      // 2. Derive the NEW master key from the new password.
      const newMasterSalt = generateSalt();
      const newAuthSalt = generateSalt();
      const newArgon2Salt = encodeSaltField(newMasterSalt, newAuthSalt);
      const newMasterKey = deriveMasterKey(values.newPassword, newMasterSalt);
      const newAuthHash = toBase64(deriveMasterKey(`auth:${values.newPassword}`, newAuthSalt));

      // 3. Re-wrap everything wrapped under the old master key.
      const privateKey = unwrapPrivateKey(
        fromBase64(recoveryData.encryptedPrivateKey),
        oldMasterKey,
        fromBase64(recoveryData.privateKeyIv),
      );
      const { encryptedPrivateKey: newEncPK, iv: newPKIv } = wrapPrivateKey(privateKey, newMasterKey);

      const personalVaultKey = unwrapVaultKey(
        fromBase64(recoveryData.encryptedVaultKey),
        oldMasterKey,
        fromBase64(recoveryData.vaultKeyIv),
      );
      const { encryptedVaultKey: newEncVK, iv: newVKIv } = wrapVaultKey(personalVaultKey, newMasterKey);

      const vaultKeys = recoveryData.vaultKeys.map((vk) => {
        const key = unwrapVaultKey(
          fromBase64(vk.encryptedVaultKey),
          oldMasterKey,
          fromBase64(vk.vaultKeyIv),
        );
        const { encryptedVaultKey, iv } = wrapVaultKey(key, newMasterKey);
        return {
          vaultId: vk.vaultId,
          encryptedVaultKey: toBase64(encryptedVaultKey),
          vaultKeyIv: toBase64(iv),
        };
      });

      // 4. Rotate the recovery code (the one just used is now void).
      const freshCode = generateRecoveryCode();
      const newRecovery = buildRecoveryBlob(freshCode, newMasterKey);

      // 5. Proof we hold the old recovery code, so the server applies the reset.
      const recoveryAuthHash = toBase64(
        deriveMasterKey(`recovery-auth:${normalized}`, fromBase64(recoveryData.recoveryAuthSalt)),
      );

      const result = await trpcClient.auth.completeRecovery.mutate({
        email,
        recoveryAuthHash,
        newAuthHash,
        newArgon2Salt,
        newEncryptedVaultKey: toBase64(newEncVK),
        newVaultKeyIv: toBase64(newVKIv),
        newEncryptedPrivateKey: toBase64(newEncPK),
        newPrivateKeyIv: toBase64(newPKIv),
        vaultKeys,
        newRecovery,
      });

      // 6. Establish the unlocked session with the new master key.
      setSessionToken(result.sessionToken);
      setSession({
        userId: result.userId,
        sessionToken: result.sessionToken,
        masterKey: newMasterKey,
        vaultKeys: new Map(),
        encryptedPrivateKey: result.encryptedPrivateKey,
        privateKeyIv: result.privateKeyIv,
        publicKey: result.publicKey,
        encryptedVaultKey: result.encryptedVaultKey,
        vaultKeyIv: result.vaultKeyIv,
      });

      setNewRecoveryCode(freshCode);
      setStep('done');
    } catch (err) {
      setErrorMsg('Recovery failed. Please try again.');
      console.error(err);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Recover your account</h1>
          <p className="mt-2 text-sm text-gray-500">
            {step === 'done'
              ? 'Your password has been reset.'
              : 'Use your recovery code to set a new master password.'}
          </p>
        </div>

        {step === 'email' && (
          <form
            onSubmit={emailForm.handleSubmit(onSubmitEmail)}
            className="space-y-4 rounded-xl bg-white p-8 shadow-sm border border-gray-100"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                {...emailForm.register('email')}
                type="email"
                autoComplete="email"
                autoFocus
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {emailForm.formState.errors.email && (
                <p className="mt-1 text-xs text-red-600">{emailForm.formState.errors.email.message}</p>
              )}
            </div>

            {errorMsg && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={working}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {working ? 'Checking…' : 'Continue'}
            </button>

            <p className="text-center text-sm text-gray-500">
              Remembered it?{' '}
              <Link to="/login" className="text-indigo-600 hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        )}

        {step === 'reset' && (
          <form
            onSubmit={resetForm.handleSubmit(onSubmitReset)}
            className="space-y-4 rounded-xl bg-white p-8 shadow-sm border border-gray-100"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700">Recovery code</label>
              <input
                {...resetForm.register('recoveryCode')}
                type="text"
                autoFocus
                autoComplete="off"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {resetForm.formState.errors.recoveryCode && (
                <p className="mt-1 text-xs text-red-600">
                  {resetForm.formState.errors.recoveryCode.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">New master password</label>
              <input
                {...resetForm.register('newPassword')}
                type="password"
                autoComplete="new-password"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {resetForm.formState.errors.newPassword && (
                <p className="mt-1 text-xs text-red-600">
                  {resetForm.formState.errors.newPassword.message}
                </p>
              )}
              <PasswordStrength password={newPassword} />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Confirm password</label>
              <input
                {...resetForm.register('confirmPassword')}
                type="password"
                autoComplete="new-password"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {resetForm.formState.errors.confirmPassword && (
                <p className="mt-1 text-xs text-red-600">
                  {resetForm.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>

            {errorMsg && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={working}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {working ? 'Recovering…' : 'Reset password and unlock'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="space-y-4 rounded-xl bg-white p-8 shadow-sm border border-gray-100">
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              Your account is recovered and your vault is unlocked ✓
            </p>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                Your new recovery code — save it now, it won't be shown again
              </p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm break-all">
                {newRecoveryCode}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                The recovery code you just used no longer works.
              </p>
            </div>
            <button
              onClick={() => void navigate({ to: '/' })}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              I've saved it — go to my vault
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
