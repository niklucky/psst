import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CreateVaultModal } from '../../components/vaults/CreateVaultModal';
import { useKeyVault } from '../../context/KeyVaultContext';
import { trpc } from '../../trpc';

// ── Members tab ────────────────────────────────────────────────────────────

const ROLE_COLOURS: Record<string, string> = {
  owner: 'bg-amber-50 text-amber-700',
  admin: 'bg-blue-50 text-blue-700',
  member: 'bg-gray-100 text-gray-600',
};

const ROLE_LABELS: Record<string, string> = {
  owner: '👑 Owner',
  admin: '🛡 Admin',
  member: '👤 Member',
};

function MembersTab({ orgId, myRole }: { orgId: string; myRole: string }) {
  const utils = trpc.useUtils();
  const { session } = useKeyVault();

  const { data: members, isLoading } = trpc.org.listMembers.useQuery({ orgId });

  const updateMutation = trpc.org.updateRole.useMutation({
    onSuccess: () => void utils.org.listMembers.invalidate({ orgId }),
  });
  const removeMutation = trpc.org.removeMember.useMutation({
    onSuccess: () => void utils.org.listMembers.invalidate({ orgId }),
  });
  const inviteMutation = trpc.org.invite.useMutation({
    onSuccess: () => setInviteResult(null),
  });

  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteResult, setInviteResult] = useState<{ token: string; email: string } | null>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm({ defaultValues: { email: '' } });

  const canManage = myRole === 'owner' || myRole === 'admin';

  const onInvite = handleSubmit(async ({ email }) => {
    const result = await inviteMutation.mutateAsync({ orgId, email, role: inviteRole });
    setInviteResult({ token: result.token, email });
    reset();
    setShowInviteForm(false);
  });

  return (
    <div className="space-y-4">
      {/* Invite form toggle */}
      {canManage && (
        <div>
          {!showInviteForm ? (
            <button
              onClick={() => setShowInviteForm(true)}
              className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700"
            >
              + Invite member
            </button>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4 max-w-md space-y-3">
              <p className="text-sm font-medium text-gray-900">Invite by email</p>
              <form onSubmit={(e) => void onInvite(e)} className="space-y-3">
                <input
                  {...register('email', { required: 'Required' })}
                  type="email"
                  placeholder="colleague@example.com"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
                <div className="flex gap-2">
                  {(['admin', 'member'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setInviteRole(r)}
                      className={`flex-1 text-sm py-1 rounded-lg border transition-colors ${inviteRole === r ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}
                    >
                      {r === 'admin' ? '🛡 Admin' : '👤 Member'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={inviteMutation.isPending}
                    className="flex-1 rounded-lg bg-indigo-600 text-white text-sm py-1.5 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {inviteMutation.isPending ? 'Inviting…' : 'Send invite'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowInviteForm(false); reset(); }}
                    className="flex-1 rounded-lg border border-gray-200 text-sm text-gray-600 py-1.5 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Dev: show invite token */}
          {inviteResult && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
              <p className="font-medium text-amber-800 mb-1">Dev mode — invite token for {inviteResult.email}:</p>
              <code className="break-all text-amber-700">{inviteResult.token}</code>
              <p className="mt-1 text-amber-600">Share this token. In production, it would be emailed automatically.</p>
            </div>
          )}
        </div>
      )}

      {/* Members table */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {members && members.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 px-4 py-3">Member</th>
                <th className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 px-4 py-3">Role</th>
                <th className="text-left text-xs font-semibold uppercase tracking-wider text-gray-400 px-4 py-3">Joined</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((m) => {
                const isSelf = m.userId === session?.userId;
                return (
                  <tr key={m.userId}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold uppercase shrink-0">
                          {m.email.charAt(0)}
                        </div>
                        <span>{m.email} {isSelf && <span className="text-xs text-gray-400">(you)</span>}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {canManage && !isSelf && m.role !== 'owner' ? (
                        <select
                          value={m.role}
                          onChange={(e) => void updateMutation.mutateAsync({ orgId, userId: m.userId, role: e.target.value as 'admin' | 'member' })}
                          className="text-sm border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="admin">🛡 Admin</option>
                          <option value="member">👤 Member</option>
                        </select>
                      ) : (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLOURS[m.role] ?? 'bg-gray-100 text-gray-600'}`}>
                          {ROLE_LABELS[m.role] ?? m.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        {!isSelf && m.role !== 'owner' && (
                          <button
                            onClick={() => {
                              if (removeConfirmId !== m.userId) { setRemoveConfirmId(m.userId); return; }
                              void removeMutation.mutateAsync({ orgId, userId: m.userId });
                              setRemoveConfirmId(null);
                            }}
                            className={`text-xs px-2 py-0.5 rounded transition-colors ${removeConfirmId === m.userId ? 'bg-red-100 text-red-700' : 'text-gray-400 hover:text-red-500'}`}
                          >
                            {removeConfirmId === m.userId ? 'Confirm?' : 'Remove'}
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
    </div>
  );
}

// ── Accept Invite form ─────────────────────────────────────────────────────

function AcceptInviteForm({ orgId }: { orgId: string }) {
  const utils = trpc.useUtils();
  const mutation = trpc.org.acceptInvite.useMutation({
    onSuccess: () => {
      void utils.org.list.invalidate();
      void utils.org.listMembers.invalidate({ orgId });
    },
  });
  const [token, setToken] = useState('');

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 max-w-md">
      <p className="text-xs font-semibold text-amber-800 mb-2">Dev: accept an invite token</p>
      <div className="flex gap-2">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste invite token"
          className="flex-1 text-xs border border-amber-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
        <button
          onClick={() => void mutation.mutateAsync({ token })}
          disabled={!token || mutation.isPending}
          className="rounded bg-amber-600 text-white text-xs px-3 py-1 hover:bg-amber-700 disabled:opacity-50"
        >
          {mutation.isPending ? '…' : 'Accept'}
        </button>
      </div>
      {mutation.isError && <p className="mt-1 text-xs text-red-600">{mutation.error.message}</p>}
      {mutation.isSuccess && <p className="mt-1 text-xs text-green-700">Joined org ✓</p>}
    </div>
  );
}

// ── Vaults tab ─────────────────────────────────────────────────────────────

function VaultsTab({ orgId }: { orgId: string }) {
  const { session } = useKeyVault();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: orgVaults, isLoading } = trpc.org.vaults.useQuery({ orgId }, { enabled: !!session });

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowCreateModal(true)}
        className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700"
      >
        + New vault
      </button>

      {isLoading && (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2].map((i) => <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {orgVaults && orgVaults.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {orgVaults.map((v) => (
            <a
              key={v.id}
              href={`/vaults/${v.id}`}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">🗄️</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{v.name}</p>
                  {v.description && <p className="text-xs text-gray-400 truncate">{v.description}</p>}
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                {ROLE_LABELS[v.role] ?? v.role}
              </p>
            </a>
          ))}
        </div>
      )}

      {!isLoading && orgVaults?.length === 0 && (
        <p className="text-sm text-gray-400">No vaults yet. Create one above.</p>
      )}

      {showCreateModal && session && (
        <CreateVaultModal
          session={session}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

type OrgTab = 'members' | 'vaults';

export function OrgSettingsPage() {
  const { data: orgList, isLoading: orgsLoading } = trpc.org.list.useQuery();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OrgTab>('members');

  const { session } = useKeyVault();

  // Default to first org once loaded
  const orgId = selectedOrgId ?? (orgList?.[0]?.id ?? null);
  const currentOrg = orgList?.find((o) => o.id === orgId);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Organisation</h1>
        <p className="text-sm text-gray-500 mt-1">Manage members and vaults.</p>
      </div>

      {/* Org selector (if user belongs to multiple orgs) */}
      {orgsLoading && <div className="h-10 w-64 rounded-lg bg-gray-100 animate-pulse" />}

      {orgList && orgList.length > 1 && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Organisation
          </label>
          <select
            value={orgId ?? ''}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {orgList.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      {orgId && currentOrg && (
        <>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-lg">
              {currentOrg.name.charAt(0)}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{currentOrg.name}</p>
              <p className="text-xs text-gray-400">{currentOrg.slug}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200 flex gap-1">
            {(['members', 'vaults'] as OrgTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm border-b-2 transition-colors capitalize ${
                  activeTab === tab
                    ? 'border-indigo-600 text-indigo-700 font-medium'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {tab === 'members' ? '👥 Members' : '🗄️ Vaults'}
              </button>
            ))}
          </div>

          {activeTab === 'members' && (
            <MembersTab orgId={orgId} myRole={currentOrg.role} />
          )}
          {activeTab === 'vaults' && (
            <VaultsTab orgId={orgId} />
          )}

          {/* Dev helper for accepting invite tokens */}
          {session && activeTab === 'members' && (
            <AcceptInviteForm orgId={orgId} />
          )}
        </>
      )}

      {!orgsLoading && (!orgList || orgList.length === 0) && (
        <p className="text-sm text-gray-400">You don't belong to any organisation.</p>
      )}
    </div>
  );
}
