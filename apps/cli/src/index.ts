/**
 * silo CLI — zero-knowledge secrets management for developers
 *
 * Usage:
 *   silo login                 — authenticate
 *   silo logout                — clear session
 *   silo whoami                — show current user
 *   silo vault list            — list vaults
 *   silo vault use <name>      — set default vault
 *   silo secret list           — list secrets in a vault
 *   silo secret get <name>     — decrypt and print a secret
 *   silo secret create         — interactively create a secret
 *   silo secret delete <name>  — delete a secret
 *   silo secret search <term>  — search across all vaults
 *   silo env pull              — pull .env from vault
 *   silo env push              — push .env to vault
 *   silo env run -- <cmd>      — run command with vault env vars injected
 *   silo env init              — configure vault for current directory
 */

import { Command } from 'commander';
import { makeLoginCommand, makeLogoutCommand, makeWhoamiCommand } from './commands/login';
import { makeSecretCommand } from './commands/secret';
import { makeEnvCommand } from './commands/env';
import { makeVaultCommand } from './commands/vault';

const program = new Command();

program
  .name('silo')
  .description('Zero-knowledge secrets management CLI')
  .version('0.0.0')
  .enablePositionalOptions();

// Auth commands (top-level for discoverability)
program.addCommand(makeLoginCommand());
program.addCommand(makeLogoutCommand());
program.addCommand(makeWhoamiCommand());

// Secret management
program.addCommand(makeSecretCommand());

// Vault management
program.addCommand(makeVaultCommand());

// Env var management
program.addCommand(makeEnvCommand());

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Unexpected error: ${message}`);
  process.exit(1);
});
