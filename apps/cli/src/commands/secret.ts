/**
 * psst secret — general secret management commands (scaffold for Session 5.4)
 */

import { Command } from 'commander';
import { requireSession } from '../lib/auth';
import { getApiClient } from '../lib/api';
import { getVaultKeysMap, decryptSecret } from '../lib/crypto';
import type { SecretPayload, SecretType } from '@psst/shared';

// ── secret list ───────────────────────────────────────────────────────────────

function makeSecretListCommand(): Command {
  return new Command('list')
    .description('List secrets in a vault')
    .requiredOption('--vault <id>', 'Vault ID')
    .option('--type <type>', 'Filter by type (login, note, env_var, card, file)')
    .action(async (options: { vault: string; type?: string }) => {
      requireSession();
      const api = getApiClient();

      try {
        const secrets = await api.secret.list.query({
          vaultId: options.vault,
          ...(options.type ? { type: options.type as SecretType } : {}),
        });

        if (secrets.length === 0) {
          console.log('No secrets found.');
          return;
        }

        // Table header
        console.log(
          ['ID'.padEnd(36), 'Name'.padEnd(40), 'Type'.padEnd(12), 'Updated'].join('  '),
        );
        console.log('-'.repeat(100));

        for (const s of secrets) {
          const updated = new Date(s.updatedAt).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
          console.log(
            [
              s.id.padEnd(36),
              s.name.padEnd(40),
              s.type.padEnd(12),
              updated,
            ].join('  '),
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

// ── secret get ────────────────────────────────────────────────────────────────

function makeSecretGetCommand(): Command {
  return new Command('get')
    .description('Decrypt and print a secret')
    .argument('<secret-id>', 'Secret ID')
    .option('--vault <id>', 'Vault ID (required if not in .psst)')
    .option('--json', 'Output raw JSON payload')
    .action(async (secretId: string, options: { vault?: string; json?: boolean }) => {
      requireSession();
      const api = getApiClient();
      const vaultKeys = getVaultKeysMap();

      try {
        const secret = await api.secret.get.query({ secretId });
        const vaultKey = vaultKeys.get(secret.vaultId);
        if (!vaultKey) {
          console.error(
            `No vault key for vault ${secret.vaultId}. Try running \`psst login\` again.`,
          );
          process.exit(1);
        }

        const payloadJson = decryptSecret(
          new Uint8Array(Buffer.from(secret.ciphertext, 'base64')),
          vaultKey,
          new Uint8Array(Buffer.from(secret.iv, 'base64')),
        );
        const payload = JSON.parse(payloadJson) as SecretPayload;

        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        console.log(`Name:  ${secret.name}`);
        console.log(`Type:  ${secret.type}`);
        console.log('');

        switch (payload._type) {
          case 'login':
            console.log(`Username: ${payload.username}`);
            console.log(`Password: ${payload.password}`);
            if (payload.url) console.log(`URL:      ${payload.url}`);
            if (payload.notes) console.log(`Notes:    ${payload.notes}`);
            break;
          case 'note':
            console.log(payload.content);
            break;
          case 'env_var':
            for (const { key, value } of payload.variables) {
              console.log(`${key}=${value}`);
            }
            break;
          case 'card':
            console.log(`Cardholder: ${payload.cardholder}`);
            console.log(`Number:     ${payload.number}`);
            console.log(`Expiry:     ${payload.expiry}`);
            console.log(`CVV:        ${payload.cvv}`);
            break;
          default:
            console.log(JSON.stringify(payload, null, 2));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
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

        for (const r of results) {
          console.log(`${r.name.padEnd(40)}  ${r.type.padEnd(12)}  ${r.vaultName ?? r.vaultId}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}

// ── secret command group ──────────────────────────────────────────────────────

export function makeSecretCommand(): Command {
  const cmd = new Command('secret').description('Manage secrets');

  cmd.addCommand(makeSecretListCommand());
  cmd.addCommand(makeSecretGetCommand());
  cmd.addCommand(makeSecretSearchCommand());

  return cmd;
}
