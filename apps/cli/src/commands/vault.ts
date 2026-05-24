/**
 * psst vault — vault management commands
 *
 * list   — show all vaults the current user has access to
 * use    — set the default vault (saved to config)
 */

import { Command } from 'commander';
import { requireSession } from '../lib/auth';
import { getApiClient } from '../lib/api';
import { readConfig, writeConfig } from '../lib/config';

// ── vault list ────────────────────────────────────────────────────────────────

function makeVaultListCommand(): Command {
  return new Command('list')
    .description('List all vaults you have access to')
    .action(async () => {
      requireSession();
      const api = getApiClient();

      try {
        const vaults = await api.vault.list.query();

        if (vaults.length === 0) {
          console.log('No vaults found.');
          return;
        }

        const config = readConfig();
        const defaultVaultId = config.defaultVaultId;

        console.log(['ID'.padEnd(36), 'Name'.padEnd(36), 'Role'.padEnd(8), 'Secrets'].join('  '));
        console.log('-'.repeat(90));

        for (const v of vaults) {
          const marker = v.id === defaultVaultId ? ' *' : '  ';
          console.log(
            [
              v.id.padEnd(36),
              v.name.padEnd(36),
              v.role.padEnd(8),
              String(v.secretCount).padStart(7),
            ].join('  ') + marker,
          );
        }

        if (defaultVaultId) {
          console.log('\n  * default vault');
        }
        console.log(`\n${vaults.length} vault${vaults.length !== 1 ? 's' : ''} total.`);
      } catch (err: unknown) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

// ── vault use ─────────────────────────────────────────────────────────────────

function makeVaultUseCommand(): Command {
  return new Command('use')
    .description('Set the default vault for all commands')
    .argument('<vault-id-or-name>', 'Vault UUID or name')
    .action(async (vaultIdOrName: string) => {
      requireSession();
      const api = getApiClient();

      try {
        const vaults = await api.vault.list.query();

        // Try exact ID match first, then case-insensitive name match
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let match = uuidRe.test(vaultIdOrName)
          ? vaults.find((v) => v.id === vaultIdOrName)
          : vaults.find((v) => v.name.toLowerCase() === vaultIdOrName.toLowerCase());

        if (!match) {
          // Partial name match if no exact hit
          const partial = vaults.filter((v) =>
            v.name.toLowerCase().includes(vaultIdOrName.toLowerCase()),
          );
          if (partial.length === 1) {
            match = partial[0];
          } else if (partial.length > 1) {
            console.error(
              `Ambiguous vault name "${vaultIdOrName}". Matches:\n` +
                partial.map((v) => `  ${v.id}  ${v.name}`).join('\n') +
                '\nPlease use the full UUID.',
            );
            process.exit(1);
          }
        }

        if (!match) {
          console.error(`No vault found matching "${vaultIdOrName}".`);
          console.error(`Run \`psst vault list\` to see available vaults.`);
          process.exit(1);
        }

        const config = readConfig();
        writeConfig({ ...config, defaultVaultId: match.id });
        console.log(`Default vault set to "${match.name}" (${match.id}).`);
      } catch (err: unknown) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

// ── vault command group ───────────────────────────────────────────────────────

export function makeVaultCommand(): Command {
  const cmd = new Command('vault').description('Manage vaults');

  cmd.addCommand(makeVaultListCommand());
  cmd.addCommand(makeVaultUseCommand());

  return cmd;
}
