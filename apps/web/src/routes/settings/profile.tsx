import {
  deriveMasterKey,
  fromBase64,
  generateRecoveryCode,
  generateSalt,
  toBase64,
  unwrapPrivateKey,
  unwrapVaultKey,
  wrapPrivateKey,
  wrapVaultKey,
} from '@psst/crypto';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';
import { buildRecoveryBlob, encodeSaltField } from '../../utils/auth';
import { usePageTitle } from '../../hooks/usePageTitle';
import { PasswordStrength } from '../../components/ui/PasswordStrength';

// ── Email Verification ──────────────────────────────────────────────────────

function EmailVerificationSection({ verified }: { verified: boolean }) {
  const mutation = trpc.auth.resendVerificationEmail.useMutation();

  if (verified) return null;

  return (
    <section className="bg-amber-50 rounded-xl border border-amber-200 p-6 flex items-center justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold text-amber-900">Email not verified</h2>
        <p className="text-xs text-amber-700 mt-1">
          Please check your inbox for a verification link.
        </p>
      </div>
      {mutation.isSuccess ? (
        <span className="text-xs text-green-700 whitespace-nowrap">Email sent ✓</span>
      ) : (
        <div className="text-right">
          <button
            onClick={() => void mutation.mutateAsync()}
            disabled={mutation.isPending}
            className="rounded-lg bg-amber-600 text-white text-sm px-4 py-1.5 hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
          >
            {mutation.isPending ? 'Sending…' : 'Resend email'}
          </button>
          {mutation.isError && (
            <p className="mt-1 text-xs text-amber-700 whitespace-nowrap">{mutation.error.message}</p>
          )}
        </div>
      )}
    </section>
  );
}

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
  const utils = trpc.useUtils();
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

      // 4b. Re-wrap the personal vault key (the /unlock password-check sentinel)
      // under the new master key — otherwise unlock fails after the next reload.
      const personalVaultKey = unwrapVaultKey(
        fromBase64(session.encryptedVaultKey),
        session.masterKey,
        fromBase64(session.vaultKeyIv),
      );
      const { encryptedVaultKey: newEncVK, iv: newVKIv } = wrapVaultKey(personalVaultKey, newMasterKey);

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
        newEncryptedVaultKey: toBase64(newEncVK),
        newVaultKeyIv: toBase64(newVKIv),
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
        encryptedVaultKey: toBase64(newEncVK),
        vaultKeyIv: toBase64(newVKIv),
      });

      // The server drops the recovery key on a password change (it now wraps a
      // stale master key) — refresh the status so RecoveryKeySection stops
      // showing "set up ✓" and prompts the user to re-enroll.
      void utils.auth.recoveryStatus.invalidate();

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

// ── Two-Factor Authentication ──────────────────────────────────────────────

function TotpEnrollment({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  const startMutation = trpc.auth.totpEnrollStart.useMutation();
  const verifyMutation = trpc.auth.totpEnrollVerify.useMutation();
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { code: '' },
  });

  useEffect(() => {
    void (async () => {
      const result = await startMutation.mutateAsync();
      setSecret(result.secret);
      setQrDataUrl(await QRCode.toDataURL(result.otpauthUrl));
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = handleSubmit(async ({ code }) => {
    const result = await verifyMutation.mutateAsync({ code: code.trim() });
    setBackupCodes(result.backupCodes);
    void utils.auth.totpStatus.invalidate();
  });

  if (backupCodes) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">
          Two-factor authentication is enabled ✓
        </p>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Backup codes — save these now, they won't be shown again
          </p>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm">
            {backupCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
        <button
          onClick={onDone}
          className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-sm">
      {qrDataUrl ? (
        <img src={qrDataUrl} alt="2FA QR code" className="rounded-lg border border-gray-200" width={200} height={200} />
      ) : (
        <div className="h-[200px] w-[200px] rounded-lg bg-gray-100 animate-pulse" />
      )}
      {secret && (
        <p className="text-xs text-gray-500">
          Or enter this key manually: <span className="font-mono text-gray-900">{secret}</span>
        </p>
      )}
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Code from your authenticator app
          </label>
          <input
            {...register('code', { required: 'Required' })}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {errors.code && <p className="mt-1 text-xs text-red-600">{errors.code.message}</p>}
        </div>
        {verifyMutation.isError && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">Incorrect code. Please try again.</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={verifyMutation.isPending}
            className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
          >
            {verifyMutation.isPending ? 'Verifying…' : 'Enable 2FA'}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-gray-200 text-sm text-gray-600 px-4 py-1.5 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function TotpDisable({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  const mutation = trpc.auth.totpDisable.useMutation({
    onSuccess: () => {
      void utils.auth.totpStatus.invalidate();
      onDone();
    },
  });

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { code: '' },
  });

  const onSubmit = handleSubmit(async ({ code }) => {
    await mutation.mutateAsync({ code: code.trim() });
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3 max-w-sm">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Enter a code from your authenticator app or a backup code to disable 2FA
        </label>
        <input
          {...register('code', { required: 'Required' })}
          type="text"
          autoComplete="one-time-code"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {errors.code && <p className="mt-1 text-xs text-red-600">{errors.code.message}</p>}
      </div>
      {mutation.isError && (
        <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">Incorrect code. Please try again.</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-lg bg-red-600 text-white text-sm px-4 py-1.5 hover:bg-red-700 disabled:opacity-50"
        >
          {mutation.isPending ? 'Disabling…' : 'Disable 2FA'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-gray-200 text-sm text-gray-600 px-4 py-1.5 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function TwoFactorSection() {
  const { data, isLoading } = trpc.auth.totpStatus.useQuery();
  const [mode, setMode] = useState<'idle' | 'enroll' | 'disable'>('idle');

  if (isLoading) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Two-factor authentication</h2>
      <p className="text-xs text-gray-500 mb-4">
        Require a code from an authenticator app when signing in.
      </p>

      {mode === 'enroll' && <TotpEnrollment onDone={() => setMode('idle')} />}
      {mode === 'disable' && <TotpDisable onDone={() => setMode('idle')} />}

      {mode === 'idle' && (
        data?.enabled ? (
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-green-700">2FA is enabled ✓</span>
            <button
              onClick={() => setMode('disable')}
              className="rounded-lg border border-red-300 text-red-700 text-sm px-4 py-1.5 hover:bg-red-50"
            >
              Disable
            </button>
          </div>
        ) : (
          <button
            onClick={() => setMode('enroll')}
            className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700"
          >
            Enable 2FA
          </button>
        )
      )}
    </section>
  );
}

// ── Passkeys (WebAuthn) ────────────────────────────────────────────────────

function PasskeysSection() {
  const utils = trpc.useUtils();
  const { data: passkeys, isLoading } = trpc.auth.webauthnCredentials.useQuery();
  const optionsMutation = trpc.auth.webauthnRegisterOptions.useMutation();
  const verifyMutation = trpc.auth.webauthnRegisterVerify.useMutation();
  const deleteMutation = trpc.auth.webauthnDeleteCredential.useMutation({
    onSuccess: () => void utils.auth.webauthnCredentials.invalidate(),
  });

  const [error, setError] = useState('');
  const [registering, setRegistering] = useState(false);

  const onRegister = async () => {
    setError('');
    setRegistering(true);
    try {
      const { challengeId, options } = await optionsMutation.mutateAsync();
      const response = await startRegistration({ optionsJSON: options });
      const name = options.user.displayName || 'Passkey';
      await verifyMutation.mutateAsync({ challengeId, response, name });
      await utils.auth.webauthnCredentials.invalidate();
    } catch (err) {
      // A user cancelling the browser prompt throws too — keep the copy generic.
      setError('Could not register a passkey. Please try again.');
      console.error(err);
    } finally {
      setRegistering(false);
    }
  };

  if (isLoading) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Passkeys</h2>
      <p className="text-xs text-gray-500 mb-4">
        Sign in with Touch ID, Windows Hello, or a security key instead of typing your password.
        You'll still enter your master password to unlock your vault.
      </p>

      {passkeys && passkeys.length > 0 && (
        <ul className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
          {passkeys.map((pk) => (
            <li key={pk.id} className="flex items-center justify-between gap-4 px-3 py-2">
              <div>
                <p className="text-sm text-gray-900">{pk.name || 'Passkey'}</p>
                <p className="text-xs text-gray-400">
                  Added {new Date(pk.createdAt).toLocaleDateString()}
                  {pk.lastUsedAt ? ` · last used ${new Date(pk.lastUsedAt).toLocaleDateString()}` : ''}
                </p>
              </div>
              <button
                onClick={() => deleteMutation.mutate({ id: pk.id })}
                disabled={deleteMutation.isPending}
                className="rounded-lg border border-gray-200 text-xs text-gray-600 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mb-3 text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

      <button
        onClick={() => void onRegister()}
        disabled={registering}
        className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
      >
        {registering ? 'Waiting for passkey…' : 'Add a passkey'}
      </button>
    </section>
  );
}

// ── Recovery Key ───────────────────────────────────────────────────────────

function RecoveryKeySection() {
  const { session } = useKeyVault();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.auth.recoveryStatus.useQuery();
  const setupMutation = trpc.auth.recoverySetup.useMutation();
  const disableMutation = trpc.auth.recoveryDisable.useMutation({
    onSuccess: () => void utils.auth.recoveryStatus.invalidate(),
  });

  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [error, setError] = useState('');

  const onGenerate = async () => {
    if (!session) return;
    setError('');
    setConfirmRegen(false);
    try {
      // Derive the whole blob client-side from the in-memory master key — the
      // server never sees the recovery code.
      const code = generateRecoveryCode();
      const blob = buildRecoveryBlob(code, session.masterKey);
      await setupMutation.mutateAsync(blob);
      await utils.auth.recoveryStatus.invalidate();
      setRecoveryCode(code);
    } catch (err) {
      setError('Could not set up a recovery key. Please try again.');
      console.error(err);
    }
  };

  // Freshly generated code — shown once. Takes priority over every other state.
  const renderRevealedCode = (code: string) => (
    <div className="space-y-3 max-w-sm">
      <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">Recovery key enabled ✓</p>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Save this code now — it won't be shown again
        </p>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm break-all">
          {code}
        </div>
      </div>
      <button
        onClick={() => setRecoveryCode(null)}
        className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700"
      >
        I've saved it
      </button>
    </div>
  );

  // No recovery key yet — nothing to lose, so set up without confirmation.
  const renderNotEnabled = () => (
    <button
      onClick={() => void onGenerate()}
      disabled={setupMutation.isPending}
      className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
    >
      {setupMutation.isPending ? 'Generating…' : 'Set up recovery key'}
    </button>
  );

  // Regenerate confirmation — voiding the existing code is destructive.
  const renderConfirmRegen = () => (
    <div className="space-y-3 max-w-sm">
      <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">
        Regenerating invalidates your current recovery code immediately. Make sure to save the new
        one — there's no way to recover the old code.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => void onGenerate()}
          disabled={setupMutation.isPending}
          className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
        >
          {setupMutation.isPending ? 'Generating…' : 'Yes, regenerate'}
        </button>
        <button
          onClick={() => setConfirmRegen(false)}
          disabled={setupMutation.isPending}
          className="rounded-lg border border-gray-200 text-sm text-gray-600 px-4 py-1.5 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  // Recovery key is set up — offer to regenerate or disable it.
  const renderEnabled = () => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-green-700">Recovery key is set up ✓</span>
      <div className="flex gap-2">
        <button
          onClick={() => setConfirmRegen(true)}
          className="rounded-lg border border-gray-300 text-gray-700 text-sm px-4 py-1.5 hover:bg-gray-50"
        >
          Regenerate
        </button>
        <button
          onClick={() => disableMutation.mutate()}
          disabled={disableMutation.isPending}
          className="rounded-lg border border-red-300 text-red-700 text-sm px-4 py-1.5 hover:bg-red-50 disabled:opacity-50"
        >
          Disable
        </button>
      </div>
    </div>
  );

  const renderBody = () => {
    if (recoveryCode) return renderRevealedCode(recoveryCode);
    if (!data?.enabled) return renderNotEnabled();
    if (confirmRegen) return renderConfirmRegen();
    return renderEnabled();
  };

  if (isLoading) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Recovery key</h2>
      <p className="text-xs text-gray-500 mb-4">
        A one-time recovery code lets you regain access to your vault if you forget your master
        password. Without it, a forgotten password means permanent data loss. Changing your
        password invalidates the code — you'll need to generate a new one.
      </p>

      {/* Errors only arise while (re)generating, which leaves us out of the reveal state. */}
      {error && !recoveryCode && (
        <p className="mb-3 text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
      )}

      {renderBody()}
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

      <EmailVerificationSection verified={!!me?.emailVerifiedAt} />
      <ChangeEmailSection currentEmail={me?.email ?? ''} />
      <ChangePasswordSection />
      <TwoFactorSection />
      <PasskeysSection />
      <RecoveryKeySection />
      <DeleteAccountSection />
    </div>
  );
}
