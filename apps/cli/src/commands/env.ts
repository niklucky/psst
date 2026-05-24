/**
 * psst env — env var commands (scaffold for Session 5.3)
 *
 * Stubs that print "coming in Session 5.3" so the CLI compiles and
 * the command structure is visible.
 */

import { Command } from 'commander';
import { requireSession, getDefaultVaultId } from '../lib/auth';

function notYetImplemented(name: string): () => void {
  return () => {
    console.log(`\`psst env ${name}\` will be implemented in Session 5.3.`);
    console.log('It will allow you to pull/push .env files to/from an encrypted vault.');
  };
}

// ── env pull ──────────────────────────────────────────────────────────────────

function makeEnvPullCommand(): Command {
  return new Command('pull')
    .description('Pull env vars from a vault into a .env file')
    .option('--vault <id>', 'Vault ID (default: from .psst or global config)')
    .option('--env <environment>', 'Environment (development|staging|production)')
    .option('--project <name>', 'Project name')
    .option('--output <file>', 'Output file (default: .env)')
    .option('--stdout', 'Write to stdout instead of a file')
    .action((_opts) => {
      requireSession();
      const vaultId = _opts.vault ?? getDefaultVaultId();
      if (!vaultId) {
        console.error('No vault specified. Use --vault <id> or run `psst env init`.');
        process.exit(1);
      }
      notYetImplemented('pull')();
    });
}

// ── env push ──────────────────────────────────────────────────────────────────

function makeEnvPushCommand(): Command {
  return new Command('push')
    .description('Push a .env file into an encrypted vault')
    .option('--vault <id>', 'Vault ID')
    .option('--env <environment>', 'Environment (development|staging|production)')
    .option('--project <name>', 'Project name')
    .option('--input <file>', 'Input .env file (default: .env)')
    .action((_opts) => {
      requireSession();
      notYetImplemented('push')();
    });
}

// ── env list ──────────────────────────────────────────────────────────────────

function makeEnvListCommand(): Command {
  return new Command('list')
    .description('List env var secrets (names only) in a vault')
    .option('--vault <id>', 'Vault ID')
    .action((_opts) => {
      requireSession();
      notYetImplemented('list')();
    });
}

// ── env run ───────────────────────────────────────────────────────────────────

function makeEnvRunCommand(): Command {
  return new Command('run')
    .description('Inject env vars into a subprocess')
    .argument('<command...>', 'Command to run')
    .option('--vault <id>', 'Vault ID')
    .option('--env <environment>', 'Environment')
    .option('--project <name>', 'Project name')
    .allowUnknownOption(true)
    .action((_args, _opts) => {
      requireSession();
      notYetImplemented('run')();
    });
}

// ── env init ──────────────────────────────────────────────────────────────────

function makeEnvInitCommand(): Command {
  return new Command('init')
    .description('Interactively configure vault + project for the current directory')
    .action(() => {
      requireSession();
      notYetImplemented('init')();
    });
}

// ── env command group ─────────────────────────────────────────────────────────

export function makeEnvCommand(): Command {
  const cmd = new Command('env').description('Manage environment variables in vaults');

  cmd.addCommand(makeEnvPullCommand());
  cmd.addCommand(makeEnvPushCommand());
  cmd.addCommand(makeEnvListCommand());
  cmd.addCommand(makeEnvRunCommand());
  cmd.addCommand(makeEnvInitCommand());

  return cmd;
}
