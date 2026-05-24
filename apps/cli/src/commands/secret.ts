/**
 * psst secret — general secret management commands
 *
 * list   — table of secrets in a vault (filterable by type/folder)
 * get    — decrypt and display a secret; --field for scripting, --reveal to unmask
 * create — interactive prompts to create a new secret
 * delete — delete with confirmation prompt
 * search — full-text search across all vaults
 */

import { Command } from 'commander';
import { encryptSecret, decryptSecret, toBase64, fromBase64 } from '@psst/crypto';
import type { SecretPayload, SecretType, LoginPayload, NotePayload, EnvVarPayload } from '@psst/shared';
import { requireSession, requireMasterKey, getDefaultVaultId } from '../lib/auth';
import { getVaultKeysMap } from '../lib/crypto';
import { getApiClient } from '../lib/api';
import { promptInput, promptPassword } from '../lib/prompt';

const MASK = '••••••••';

// ── Resolve vault key (with re-derive fallback) ───────────────────────────────

async function resolveVaultKeyForId(vaultId: string): Promise<Uint8Array> {
  const session = requireSession();
  const api = getApiClient();

  const cached = getVaultKeysMap().get(vaultId);
  if (cached) return cached;

  const masterKey = await requireMasterKey(session);
  const vaultList = await api.vault.list.query();
  const row = vaultList.find((v) => v.id === vaultId);
  if (!row) {
    console.error(`Vault ${vaultId} not found or access denied.`);
    process.exit(1);
  }
  const { unwrapVaultKey } = await import('@psst/crypto');
  return unwrapVaultKey(fromBase64(row.encryptedVaultKey), masterKey, fromBase64(row.vaultKeyIv));
}

// ── Resolve vault ID (from option / .psst / global default) ──────────────────

function resolveVaultId(opt?: string, required = true): string {
  const vaultId = opt ?? getDefaultVaultId();
  if (!vaultId && required) {
    console.error('No vault specified. Use --vault <id> or run `psst env init`.');
    process.exit(1);
  }
  return vaultId as string;
}

// ── Look up a secret by ID or (partial) name within a vault ──────────────────

async function findSecret(
  nameOrId: string,
  vaultId: string,
): Promise<{ id: string; vaultId: string; name: string; type: string; ciphertext: string; iv: string }> {
  const api = getApiClient();

  // UUID-shaped string → fetch directly
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(nameOrId)) {
    return api.secret.get.query({ secretId: nameOrId });
  }

  // Name search within the vault
  const list = await api.secret.list.query({ vaultId, search: nameOrId });
  if (list.length === 0) {
    console.error(`No secret found matching "${nameOrId}" in vault.`);
    process.exit(1);
  }
  if (list.length > 1) {
    console.error(
      `Ambiguous: ${list.length} secrets match "${nameOrId}":\n` +
        list.map((s) => `  ${s.id}  ${s.name}`).join('\n') +
        '\nPlease use the exact ID.',
    );
    process.exit(1);
  }
  // Fetch the full secret (with ciphertext)
  return api.secret.get.query({ secretId: list[0]!.id });
}

// ── secret list ───────────────────────────────────────────────────────────────

function makeSecretListCommand(): Command {
  return new Command('list')
    .description('List secrets in a vault')
    .option('--vault <id>', 'Vault ID')
    .option('--type <type>', 'Filter by type (login, note, env_var, card, file)')
    .option('--folder <id>', 'Filter by folder ID')
    .action(
      async (options: { vault?: string; type?: string; folder?: string }) => {
        requireSession();
        const api = getApiClient();
        const vaultId = resolveVaultId(options.vault);

        try {
          const secretList = await api.secret.list.query({
            vaultId,
            ...(options.type ? { type: options.type as SecretType } : {}),
            ...(options.folder ? { folderId: options.folder } : {}),
          });

          if (secretList.length === 0) {
            console.log('No secrets found.');
            return;
          }

          // Truncate ID to 8 chars for readability
          console.log(
            ['ID'.padEnd(8), 'Name'.padEnd(40), 'Type'.padEnd(10), 'Updated'].join('  '),
          );
          console.log('-'.repeat(74));

          for (const s of secretList) {
            const updated = new Date(s.updatedAt).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            });
            console.log(
              [s.id.slice(0, 8).padEnd(8), s.name.padEnd(40), s.type.padEnd(10), updated].join(
                '  ',
              ),
            );
          }

          console.log(`\n${secretList.length} secret${secretList.length !== 1 ? 's' : ''} total.`);
        } catch (err: unknown) {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      },
    );
}

// ── secret get ────────────────────────────────────────────────────────────────

function makeSecretGetCommand(): Command {
  return new Command('get')
    .description('Decrypt and print a secret')
    .argument('<name-or-id>', 'Secret name (or UUID) to look up')
    .option('--vault <id>', 'Vault ID (required when searching by name)')
    .option('--field <field>', 'Print just this field value (e.g. username, password, url)')
    .option('--reveal', 'Unmask password/sensitive fields in output')
    .option('--json', 'Output raw decrypted JSON payload')
    .action(
      async (
        nameOrId: string,
        options: { vault?: string; field?: string; reveal?: boolean; json?: boolean },
      ) => {
        requireSession();
        const vaultId = resolveVaultId(options.vault, !options.vault);

        try {
          const secret = await findSecret(nameOrId, vaultId);
          const vaultKey = await resolveVaultKeyForId(secret.vaultId);

          const payloadJson = decryptSecret(
            new Uint8Array(Buffer.from(secret.ciphertext, 'base64')),
            vaultKey,
            new Uint8Array(Buffer.from(secret.iv, 'base64')),
          );
          const payload = JSON.parse(payloadJson) as SecretPayload;

          // ── --json ─────────────────────────────────────────────────────────
          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
            return;
          }

          // ── --field (scripting mode, prints raw value to stdout) ───────────
          if (options.field) {
            const field = options.field.toLowerCase();
            let value: string | undefined;

            if (payload._type === 'login') {
              const p = payload as LoginPayload & { _type: 'login' };
              value =
                field === 'username' ? p.username
                : field === 'password' ? p.password
                : field === 'url' ? p.url
                : field === 'notes' ? p.notes
                : undefined;
            } else if (payload._type === 'note') {
              value = field === 'content' ? (payload as NotePayload & { _type: 'note' }).content : undefined;
            }

            if (value === undefined) {
              console.error(`Field "${options.field}" not found on this secret type.`);
              process.exit(1);
            }
            // Raw output — no newline — for pipe compatibility
            process.stdout.write(value);
            return;
          }

          // ── Human-readable output ─────────────────────────────────────────
          console.log(`Name: ${secret.name}`);
          console.log(`Type: ${secret.type}`);
          console.log('');

          const reveal = options.reveal ?? false;

          switch (payload._type) {
            case 'login': {
              const p = payload as LoginPayload & { _type: 'login' };
              console.log(`Username: ${p.username}`);
              console.log(`Password: ${reveal ? p.password : MASK}`);
              if (p.url) console.log(`URL:      ${p.url}`);
              if (p.notes) console.log(`Notes:    ${p.notes}`);
              if (!reveal) console.log(`\n(Use --reveal to show password, --field password to copy it)`);
              break;
            }
            case 'note': {
              const p = payload as NotePayload & { _type: 'note' };
              console.log(p.content);
              break;
            }
            case 'env_var': {
              const p = payload as EnvVarPayload & { _type: 'env_var' };
              for (const { key, value } of p.variables) {
                const displayValue = reveal ? value : MASK;
                console.log(`${key}=${displayValue}`);
              }
              if (!reveal) console.log(`\n(Use --reveal to show values)`);
              break;
            }
            case 'card': {
              const p = payload as { _type: 'card'; number: string; cardholder: string; expiry: string; cvv: string; notes?: string };
              console.log(`Cardholder: ${p.cardholder}`);
              console.log(`Number:     ${reveal ? p.number : '•••• •••• •••• ' + p.number.slice(-4)}`);
              console.log(`Expiry:     ${p.expiry}`);
              console.log(`CVV:        ${reveal ? p.cvv : '•••'}`);
              if (p.notes) console.log(`Notes:      ${p.notes}`);
              if (!reveal) console.log(`\n(Use --reveal to show full card number and CVV)`);
              break;
            }
            default:
              console.log(JSON.stringify(payload, null, 2));
          }
        } catch (err: unknown) {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      },
    );
}

// ── secret create ─────────────────────────────────────────────────────────────

function makeSecretCreateCommand(): Command {
  return new Command('create')
    .description('Interactively create a new secret in a vault')
    .option('--vault <id>', 'Vault ID')
    .option('--type <type>', 'Secret type: login | note | env_var | card')
    .action(async (options: { vault?: string; type?: string }) => {
      requireSession();
      const api = getApiClient();
      const vaultId = resolveVaultId(options.vault);

      // Prompt for type if not provided
      let secretType = options.type as SecretType | undefined;
      if (!secretType) {
        const typeInput = await promptInput(
          'Type [login / note / env_var / card] (default: login): ',
        );
        secretType = (['login', 'note', 'env_var', 'card'].includes(typeInput.trim())
          ? (typeInput.trim() as SecretType)
          : 'login');
      }

      const name = (await promptInput('Name: ')).trim();
      if (!name) {
        console.error('Name is required.');
        process.exit(1);
      }

      let payload: SecretPayload;

      switch (secretType) {
        case 'login': {
          const username = await promptInput('Username: ');
          const password = await promptPassword('Password: ');
          const url = (await promptInput('URL (optional): ')).trim();
          const notes = (await promptInput('Notes (optional): ')).trim();
          payload = {
            _type: 'login',
            username: username.trim(),
            password,
            ...(url ? { url } : {}),
            ...(notes ? { notes } : {}),
          };
          break;
        }
        case 'note': {
          console.log('Note content (end with a line containing only "." on its own):');
          const lines: string[] = [];
          // Read multi-line note via repeated prompts
          while (true) {
            const line = await promptInput('> ');
            if (line === '.') break;
            lines.push(line);
          }
          payload = { _type: 'note', content: lines.join('\n') };
          break;
        }
        case 'env_var': {
          console.log('Enter KEY=VALUE pairs (blank line to finish):');
          const variables: { key: string; value: string }[] = [];
          while (true) {
            const line = (await promptInput('  ')).trim();
            if (!line) break;
            const eq = line.indexOf('=');
            if (eq === -1) { console.log('  (skip — expected KEY=VALUE)'); continue; }
            variables.push({ key: line.slice(0, eq).trim(), value: line.slice(eq + 1) });
          }
          if (variables.length === 0) {
            console.error('No variables entered.');
            process.exit(1);
          }
          payload = { _type: 'env_var', variables };
          break;
        }
        case 'card': {
          const cardholder = (await promptInput('Cardholder name: ')).trim();
          const number = (await promptInput('Card number: ')).trim();
          const expiry = (await promptInput('Expiry (MM/YY): ')).trim();
          const cvv = await promptPassword('CVV: ');
          payload = { _type: 'card', cardholder, number, expiry, cvv };
          break;
        }
        default:
          console.error(`Unsupported type: ${secretType}`);
          process.exit(1);
      }

      // Resolve vault key and encrypt
      const vaultKey = await resolveVaultKeyForId(vaultId);
      const { ciphertext, iv } = encryptSecret(JSON.stringify(payload), vaultKey);

      await api.secret.create.mutate({
        vaultId,
        type: secretType,
        name,
        ciphertext: toBase64(ciphertext),
        iv: toBase64(iv),
      });

      console.log(`\nSecret "${name}" created.`);
    });
}

// ── secret delete ─────────────────────────────────────────────────────────────

function makeSecretDeleteCommand(): Command {
  return new Command('delete')
    .description('Delete a secret (with confirmation)')
    .argument('<name-or-id>', 'Secret name or UUID')
    .option('--vault <id>', 'Vault ID (required when searching by name)')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      async (nameOrId: string, options: { vault?: string; yes?: boolean }) => {
        requireSession();
        const api = getApiClient();
        const vaultId = resolveVaultId(options.vault, !options.vault);

        try {
          const secret = await findSecret(nameOrId, vaultId);

          if (!options.yes) {
            const confirm = await promptInput(
              `Delete "${secret.name}" (${secret.type})? [y/N]: `,
            );
            if (confirm.trim().toLowerCase() !== 'y') {
              console.log('Aborted.');
              return;
            }
          }

          await api.secret.delete.mutate({ secretId: secret.id });
          console.log(`Deleted "${secret.name}".`);
        } catch (err: unknown) {
          console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      },
    );
}

// ── secret search ─────────────────────────────────────────────────────────────

function makeSecretSearchCommand(): Command {
  return new Command('search')
    .description('Search secrets by name across all vaults')
    .argument('<query>', 'Search term')
    .action(async (query: string) => {
      requireSession();
      const api = getApiClient();

      try {
        const results = await api.secret.globalSearch.query({ query });

        if (results.length === 0) {
          console.log('No results.');
          return;
        }

        console.log(['Name'.padEnd(40), 'Type'.padEnd(10), 'Vault'].join('  '));
        console.log('-'.repeat(74));
        for (const r of results) {
          console.log(
            [r.name.padEnd(40), r.type.padEnd(10), r.vaultName ?? r.vaultId].join('  '),
          );
        }
      } catch (err: unknown) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

// ── secret command group ──────────────────────────────────────────────────────

export function makeSecretCommand(): Command {
  const cmd = new Command('secret').description('Manage secrets');

  cmd.addCommand(makeSecretListCommand());
  cmd.addCommand(makeSecretGetCommand());
  cmd.addCommand(makeSecretCreateCommand());
  cmd.addCommand(makeSecretDeleteCommand());
  cmd.addCommand(makeSecretSearchCommand());

  return cmd;
}
