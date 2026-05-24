/**
 * psst CLI — zero-knowledge secrets management for developers
 *
 * Usage:
 *   psst login                 — authenticate
 *   psst logout                — clear session
 *   psst whoami                — show current user
 *   psst vault list            — list vaults
 *   psst vault use <name>      — set default vault
 *   psst secret list           — list secrets in a vault
 *   psst secret get <name>     — decrypt and print a secret
 *   psst secret create         — interactively create a secret
 *   psst secret delete <name>  — delete a secret
 *   psst secret search <term>  — search across all vaults
 *   psst env pull              — pull .env from vault
 *   psst env push              — push .env to vault
 *   psst env run -- <cmd>      — run command with vault env vars injected
 *   psst env init              — configure vault for current directory
 */

import { Command } from 'commander';
import { makeLoginCommand, makeLogoutCommand, makeWhoamiCommand } from './commands/login';
import { makeSecretCommand } from './commands/secret';
import { makeEnvCommand } from './commands/env';
import { makeVaultCommand } from './commands/vault';

const program = new Command();

program
  .name('psst')
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
