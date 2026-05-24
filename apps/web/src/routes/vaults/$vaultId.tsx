import { useParams } from '@tanstack/react-router';

/**
 * Vault detail page — placeholder for Session 4.4 (secret list).
 */
export function VaultDetailPage() {
  // useParams with strict:false works inside any matched route.
  const params = useParams({ strict: false }) as { vaultId: string };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900">Vault</h1>
      <p className="text-sm text-gray-500 mt-1">
        Secret list coming in Session 4.4.
      </p>
      <p className="mt-4 font-mono text-xs text-gray-400">id: {params.vaultId}</p>
    </div>
  );
}
