import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { InviteMemberModal } from '../../../components/vault/InviteMemberModal';
import { useKeyVault } from '../../../context/KeyVaultContext';
import { trpc } from '../../../trpc';

const ROLE_LABELS: Record<string, string> = {
  owner: '👑 Owner',
  editor: '✏️ Editor',
  viewer: '👁 Viewer',
};

const ROLE_COLOURS: Record<string, string> = {
  owner: 'bg-amber-50 text-amber-700',
  editor: 'bg-blue-50 text-blue-700',
  viewer: 'bg-gray-100 text-gray-600',
};

const STATUS_LABELS: Record<string, string> = {
  active: '',
  pending: '(pending)',
};

export function VaultMembersPage() {
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const { session } = useKeyVault();
  const utils = trpc.useUtils();

  const enabled = !!session && !!vaultId;

  const { data: members, isLoading } = trpc.vault.members.useQuery({ vaultId }, { enabled });
  const { data: vault } = trpc.vault.get.useQuery({ vaultId }, { enabled });

  const updateRoleMutation = trpc.vault.updateMemberRole.useMutation({
    onSuccess: () => void utils.vault.members.invalidate({ vaultId }),
  });
  const removeMutation = trpc.vault.removeMember.useMutation({
    onSuccess: () => void utils.vault.members.invalidate({ vaultId }),
  });

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  const myRole = members?.find((m) => m.userId === session?.userId)?.role ?? 'viewer';
  const isOwner = myRole === 'owner';

  const handleRoleChange = (userId: string, role: 'owner' | 'editor' | 'viewer') => {
    void updateRoleMutation.mutateAsync({ vaultId, userId, role });
  };

  const handleRemove = (userId: string) => {
    if (removeConfirmId !== userId) {
      setRemoveConfirmId(userId);
      return;
    }
    void removeMutation.mutateAsync({ vaultId, userId });
    setRemoveConfirmId(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="h-14 shrink-0 border-b border-gray-200 bg-white flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <span className="text-xl">👥</span>
          <h1 className="font-semibold text-gray-900">
            {vault?.name ? `${vault.name} — Members` : 'Vault Members'}
          </h1>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700 transition-colors"
          >
            <span>+</span>
            Invite member
          </button>
        )}
      </div>

      {/* Member list */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && members && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 px-4 py-3">
                    Member
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 px-4 py-3">
                    Role
                  </th>
                  <th className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 px-4 py-3">
                    Joined
                  </th>
                  {isOwner && (
                    <th className="px-4 py-3" />
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map((member) => {
                  const isSelf = member.userId === session?.userId;
                  const isPending = member.inviteStatus === 'pending';

                  return (
                    <tr key={member.userId} className={isPending ? 'opacity-60' : ''}>
                      {/* Email */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold uppercase shrink-0">
                            {member.email.charAt(0)}
                          </div>
                          <div>
                            <p className="text-gray-900">{member.email}</p>
                            {isSelf && (
                              <p className="text-xs text-gray-400">You</p>
                            )}
                            {isPending && (
                              <p className="text-xs text-amber-600">Invite pending</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        {isOwner && !isSelf && !isPending ? (
                          <select
                            value={member.role}
                            onChange={(e) =>
                              handleRoleChange(
                                member.userId,
                                e.target.value as 'owner' | 'editor' | 'viewer',
                              )
                            }
                            disabled={updateRoleMutation.isPending}
                            className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="owner">👑 Owner</option>
                            <option value="editor">✏️ Editor</option>
                            <option value="viewer">👁 Viewer</option>
                          </select>
                        ) : (
                          <span
                            className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                              ROLE_COLOURS[member.role] ?? 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {ROLE_LABELS[member.role] ?? member.role}
                            {isPending ? ` ${STATUS_LABELS['pending']}` : ''}
                          </span>
                        )}
                      </td>

                      {/* Joined date */}
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(member.grantedAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Remove button */}
                      {isOwner && (
                        <td className="px-4 py-3 text-right">
                          {!isSelf && (
                            <button
                              onClick={() => handleRemove(member.userId)}
                              disabled={removeMutation.isPending}
                              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                                removeConfirmId === member.userId
                                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                  : 'text-gray-400 hover:text-red-500'
                              }`}
                            >
                              {removeConfirmId === member.userId ? 'Confirm remove?' : 'Remove'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && (!members || members.length === 0) && (
          <p className="text-sm text-gray-400 text-center py-12">No members yet.</p>
        )}
      </div>

      {showInviteModal && (
        <InviteMemberModal vaultId={vaultId} onClose={() => setShowInviteModal(false)} />
      )}
    </div>
  );
}
