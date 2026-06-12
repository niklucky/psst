import { createContext, useContext, useState, type ReactNode } from 'react';
import { setSessionToken } from '../trpc';

/**
 * The session token is an opaque, server-revocable bearer token — not key
 * material — so it's safe to persist across reloads. The master key (and
 * everything derived from it) stays in memory only; see `lock` / `lockedToken`.
 */
const TOKEN_STORAGE_KEY = 'silo:session_token';

function readPersistedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Storage unavailable (private browsing, etc.) — degrade to memory-only.
  }
}

/**
 * Holds all key material for the current session.
 * The master key is stored in memory only — never written to localStorage or
 * sessionStorage. A page refresh therefore "locks" the vault (see
 * `lockedToken`) rather than fully logging the user out.
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
  /**
   * The user's personal vault key blob, wrapped under the master key. Carried so
   * `changePassword` can re-wrap it under the new master key — without this it
   * stays wrapped under the old key and `/unlock` (which uses it as the
   * password-correctness check) fails after the next reload.
   */
  encryptedVaultKey: string; // base64
  vaultKeyIv: string; // base64
}

interface KeyVaultContextValue {
  session: VaultSession | null;
  /**
   * Set when a persisted session token was found (e.g. after a reload) but the
   * master key hasn't been re-derived yet — the vault is "locked" and the user
   * just needs to re-enter their password, not fully log in again.
   */
  lockedToken: string | null;
  setSession: (session: VaultSession | null) => void;
  addVaultKey: (vaultId: string, key: Uint8Array) => void;
  /** Full logout — wipes the in-memory session and the persisted token. */
  clearSession: () => void;
  /** Drops the master key but keeps the session token, moving to the "locked" state. */
  lock: () => void;
  /**
   * Enters the "locked" state with a freshly-issued session token but no master
   * key — used by passkey login, which authenticates without the password, so
   * the user lands on `/unlock` to derive the encryption key.
   */
  beginLockedSession: (token: string) => void;
}

const KeyVaultContext = createContext<KeyVaultContextValue | null>(null);

export function KeyVaultProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<VaultSession | null>(null);
  const [lockedToken, setLockedToken] = useState<string | null>(() => readPersistedToken());

  const setSession = (s: VaultSession | null) => {
    setSessionState(s);
    if (s) {
      persistToken(s.sessionToken);
      setLockedToken(null);
    }
  };

  const addVaultKey = (vaultId: string, key: Uint8Array) => {
    setSessionState((prev) => {
      if (!prev) return prev;
      const vaultKeys = new Map(prev.vaultKeys);
      vaultKeys.set(vaultId, key);
      return { ...prev, vaultKeys };
    });
  };

  const clearSession = () => {
    setSessionState(null);
    setLockedToken(null);
    persistToken(null);
    setSessionToken(null);
  };

  const lock = () => {
    if (session) setLockedToken(session.sessionToken);
    setSessionState(null);
    setSessionToken(null);
  };

  const beginLockedSession = (token: string) => {
    persistToken(token);
    setSessionToken(token);
    setSessionState(null);
    setLockedToken(token);
  };

  return (
    <KeyVaultContext.Provider
      value={{ session, lockedToken, setSession, addVaultKey, clearSession, lock, beginLockedSession }}
    >
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
