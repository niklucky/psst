import {
  decryptVaultKeyFromSender,
  fromBase64,
  toBase64,
  unwrapPrivateKey,
  wrapVaultKey,
} from '@psst/crypto';
import { useState } from 'react';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';

interface PendingInvite {
  vaultId: string;
  vaultName: string;
  role: string;
  encryptedVaultKey: string;
  vaultKeyIv: string;
  senderPublicKey: string | null;
  senderEmail: string | null;
  createdAt: Date | string;
}

interface Props {
  invites: PendingInvite[];
  onDone: () => void;
}

export function PendingInvitesModal({ invites, onDone }: Props) {
  const { session, addVaultKey } = useKeyVault();
  const utils = trpc.useUtils();

  const acceptMutation = trpc.vault.acceptInvite.useMutation({
    onSuccess: () => void utils.vault.list.invalidate(),
  });
  const declineMutation = trpc.vault.declineInvite.useMutation({
    onSuccess: () => void utils.vault.getPendingInvites.invalidate(),
  });

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<PendingInvite[]>(invites);

  const handleAccept = async (invite: PendingInvite) => {
    if (!session) return;
    if (!invite.senderPublicKey) {
      setError('Cannot accept this invite — sender public key is missing.');
      return;
    }

    setProcessingId(invite.vaultId);
    setError(null);

    try {
      // 1. Unwrap the user's X25519 private key
      const privateKey = unwrapPrivateKey(
        fromBase64(session.encryptedPrivateKey),
        session.masterKey,
        fromBase64(session.privateKeyIv),
      );

      // 2. ECDH-decrypt the vault key that was encrypted for us
      const vaultKey = decryptVaultKeyFromSender(
        fromBase64(invite.encryptedVaultKey),
        fromBase64(invite.vaultKeyIv),
        fromBase64(invite.senderPublicKey),
        privateKey,
      );

      // 3. Re-wrap with our master key so future loads work normally
      const { encryptedVaultKey: ciphertext, iv } = wrapVaultKey(vaultKey, session.masterKey);

      // 4. Update the server record + cache the key locally
      await acceptMutation.mutateAsync({
        vaultId: invite.vaultId,
        encryptedVaultKey: toBase64(ciphertext),
        vaultKeyIv: toBase64(iv),
      });
      addVaultKey(invite.vaultId, vaultKey);

      setRemaining((prev) => prev.filter((i) => i.vaultId !== invite.vaultId));
    } catch (err) {
      console.error('Failed to accept invite:', err);
      setError('Could not decrypt vault key. The invite may be invalid.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecline = async (invite: PendingInvite) => {
    setProcessingId(invite.vaultId);
    try {
      await declineMutation.mutateAsync({ vaultId: invite.vaultId });
      setRemaining((prev) => prev.filter((i) => i.vaultId !== invite.vaultId));
    } finally {
      setProcessingId(null);
    }
  };

  // Close automatically when all invites are handled
  if (remaining.length === 0) {
    onDone();
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-sm bg-white rounded-xl shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <span className="text-2xl">📬</span>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Vault invites</h2>
            <p className="text-xs text-gray-500">
              {remaining.length} pending invite{remaining.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Invite list */}
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {remaining.map((invite) => {
            const isProcessing = processingId === invite.vaultId;
            return (
              <div
                key={invite.vaultId}
                className="rounded-lg border border-gray-200 p-4 space-y-3"
              >
                <div className="flex items-start gap-2">
                  <span className="text-xl shrink-0">🗄️</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{invite.vaultName}</p>
                    <p className="text-xs text-gray-500">
                      Invited by {invite.senderEmail ?? 'someone'} · as{' '}
                      <span className="font-medium">{invite.role}</span>
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => void handleAccept(invite)}
                    disabled={isProcessing}
                    className="flex-1 rounded-lg bg-indigo-600 text-white text-sm py-1.5 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {isProcessing ? 'Accepting…' : 'Accept'}
                  </button>
                  <button
                    onClick={() => void handleDecline(invite)}
                    disabled={isProcessing}
                    className="flex-1 rounded-lg border border-gray-200 text-sm text-gray-600 py-1.5 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onDone}
            className="w-full text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
}
