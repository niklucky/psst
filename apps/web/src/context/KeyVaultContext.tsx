import { createContext, useContext, useState, type ReactNode } from 'react';

/**
 * Holds all key material for the current session.
 * Stored in memory only — never written to localStorage or sessionStorage.
 * On page refresh the user must log in again (correct zero-knowledge behaviour).
 */
export interface VaultSession {
  userId: string;
  sessionToken: string;
  /** argon2id-derived master key — stays in memory, never sent to server */
  masterKey: Uint8Array;
  /** vaultId → decrypted vault key, populated lazily as vaults are opened */
  vaultKeys: Map<string, Uint8Array>;
  /**
   * X25519 private key material — stored for the invite flow only.
   * The private key itself is never loaded into memory unless the user
   * actively invites someone or accepts a vault invite.
   */
  encryptedPrivateKey: string; // base64
  privateKeyIv: string; // base64
  /** Caller's X25519 public key (base64) — sent to server so recipients can ECDH-decrypt */
  publicKey: string;
}

interface KeyVaultContextValue {
  session: VaultSession | null;
  setSession: (session: VaultSession | null) => void;
  addVaultKey: (vaultId: string, key: Uint8Array) => void;
  clearSession: () => void;
}

const KeyVaultContext = createContext<KeyVaultContextValue | null>(null);

export function KeyVaultProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<VaultSession | null>(null);

  const setSession = (s: VaultSession | null) => setSessionState(s);

  const addVaultKey = (vaultId: string, key: Uint8Array) => {
    setSessionState((prev) => {
      if (!prev) return prev;
      const vaultKeys = new Map(prev.vaultKeys);
      vaultKeys.set(vaultId, key);
      return { ...prev, vaultKeys };
    });
  };

  const clearSession = () => setSessionState(null);

  return (
    <KeyVaultContext.Provider value={{ session, setSession, addVaultKey, clearSession }}>
      {children}
    </KeyVaultContext.Provider>
  );
}

export function useKeyVault(): KeyVaultContextValue {
  const ctx = useContext(KeyVaultContext);
  if (!ctx) throw new Error('useKeyVault must be used within KeyVaultProvider');
  return ctx;
}

/** Returns the session, throwing UNAUTHORIZED if not logged in. */
export function useRequiredSession(): VaultSession {
  const { session } = useKeyVault();
  if (!session) throw new Error('No active session');
  return session;
}
