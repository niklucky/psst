/**
 * silo env — env var commands
 *
 * pull   — fetch env_var secrets from a vault, write to .env file
 * push   — read .env file, encrypt and store/update as env_var secret
 * list   — show env_var secrets (names only) in a vault
 * run    — inject env vars into process.env, then exec a command
 * init   — interactively configure vault + project for current directory
 */

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { encryptSecret, decryptSecret, fromBase64, toBase64 } from '@silo/crypto';
import type { EnvVarPayload } from '@silo/shared';
import { requireSession, getDefaultVaultId, setDefaultVaultId, requireMasterKey } from '../lib/auth';
import { getVaultKeysMap } from '../lib/crypto';
import { getApiClient } from '../lib/api';
import { promptInput } from '../lib/prompt';

// ── .silo project-local config ────────────────────────────────────────────────

interface ProjectConfig {
  vaultId: string;
  project: string;
  environment: 'development' | 'staging' | 'production';
}

function readProjectConfig(): ProjectConfig | null {
  try {
    const raw = fs.readFileSync('.silo', 'utf8');
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return null;
  }
}

function writeProjectConfig(cfg: ProjectConfig): void {
  fs.writeFileSync('.silo', JSON.stringify(cfg, null, 2) + '\n');
}

// ── .env file helpers ─────────────────────────────────────────────────────────

/**
 * Parse KEY=VALUE pairs from a .env file, skipping comments and blanks.
 */
function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) vars[key] = value;
  }
  return vars;
}

/**
 * Serialise a Record<string, string> to .env format.
 */
function serializeEnvFile(vars: Record<string, string>): string {
  return (
    Object.entries(vars)
      .map(([k, v]) => {
        // Quote values that contain whitespace, #, $, quotes, or backslash
        const needsQuotes = /[\s#$"'`\\]/.test(v);
        return needsQuotes ? `${k}="${v.replace(/"/g, '\\"')}"` : `${k}=${v}`;
      })
      .join('\n') + '\n'
  );
}

// ── Naming convention ─────────────────────────────────────────────────────────
// Secret name: "<project>.<environment>" or fallbacks

function buildSecretName(project?: string, environment?: string): string {
  if (project && environment) return `${project}.${environment}`;
  if (project) return project;
  if (environment) return `env_vars.${environment}`;
  return 'env_vars';
}

// ── Vault ID resolution ───────────────────────────────────────────────────────

function resolveVaultId(opt?: string): string {
  const vaultId = opt ?? readProjectConfig()?.vaultId ?? getDefaultVaultId();
  if (!vaultId) {
    console.error('No vault specified. Use --vault <id> or run `silo env init`.');
    process.exit(1);
  }
  return vaultId;
}

// ── Vault key resolution (with fallback re-derive) ────────────────────────────

async function resolveVaultKey(vaultId: string): Promise<Uint8Array> {
  const session = requireSession();
  const api = getApiClient();

  const vaultKeys = getVaultKeysMap();
  const cached = vaultKeys.get(vaultId);
  if (cached) return cached;

  // Not in cache — derive master key and unwrap
  const masterKey = await requireMasterKey(session);
  const vaultList = await api.vault.list.query();
  const vaultRow = vaultList.find((v) => v.id === vaultId);
  if (!vaultRow) {
    console.error(`Vault ${vaultId} not found or you don't have access.`);
    process.exit(1);
  }
  const { unwrapVaultKey } = await import('@silo/crypto');
  return unwrapVaultKey(
    fromBase64(vaultRow.encryptedVaultKey),
    masterKey,
    fromBase64(vaultRow.vaultKeyIv),
  );
}

// ── env pull ──────────────────────────────────────────────────────────────────

function makeEnvPullCommand(): Command {
  return new Command('pull')
    .description('Pull env vars from a vault into a .env file')
    .option('--vault <id>', 'Vault ID')
    .option('--env <environment>', 'Environment (development|staging|production)')
    .option('--project <name>', 'Project name')
    .option('--output <file>', 'Output file (default: .env)')
    .option('--stdout', 'Print to stdout instead of writing a file')
    .action(
      async (opts: {
        vault?: string;
        env?: string;
        project?: string;
        output?: string;
        stdout?: boolean;
      }) => {
        requireSession();
        const api = getApiClient();
        const vaultId = resolveVaultId(opts.vault);

        // Resolve project/env from .silo if not supplied on command line
        const projectCfg = readProjectConfig();
        const project = opts.project ?? projectCfg?.project;
        const environment = (opts.env ?? projectCfg?.environment) as
          | EnvVarPayload['environment']
          | undefined;

        const vaultKey = await resolveVaultKey(vaultId);

        // List env_var secrets in this vault
        const secretList = await api.secret.list.query({ vaultId, type: 'env_var' });

        if (secretList.length === 0) {
          console.error(`No env_var secrets found in vault ${vaultId}.`);
          process.exit(1);
        }

        // Match by naming convention; fall back to sole secret if only one exists
        const targetName = buildSecretName(project, environment);
        let matched = secretList.find((s) => s.name === targetName);
        if (!matched && secretList.length === 1) matched = secretList[0];

        if (!matched) {
          console.error(
            `Found ${secretList.length} env_var secrets but none match "${targetName}".\n` +
              `Available: ${secretList.map((s) => s.name).join(', ')}\n` +
              `Tip: Use --project and --env to narrow the match, or run \`silo env init\`.`,
          );
          process.exit(1);
        }

        const secret = await api.secret.get.query({ secretId: matched.id });
        const payloadJson = decryptSecret(
          new Uint8Array(Buffer.from(secret.ciphertext, 'base64')),
          vaultKey,
          new Uint8Array(Buffer.from(secret.iv, 'base64')),
        );
        const payload = JSON.parse(payloadJson) as EnvVarPayload & { _type: 'env_var' };

        const vars: Record<string, string> = {};
        for (const { key, value } of payload.variables) {
          vars[key] = value;
        }
        const content = serializeEnvFile(vars);

        if (opts.stdout) {
          process.stdout.write(content);
        } else {
          const outFile = opts.output ?? '.env';
          fs.writeFileSync(outFile, content);
          const count = Object.keys(vars).length;
          console.log(`Wrote ${count} variable${count !== 1 ? 's' : ''} to ${outFile}`);
          console.log(`  Source: ${secret.name}`);
        }
      },
    );
}

// ── env push ──────────────────────────────────────────────────────────────────

function makeEnvPushCommand(): Command {
  return new Command('push')
    .description('Push a .env file into an encrypted vault')
    .option('--vault <id>', 'Vault ID')
    .option('--env <environment>', 'Environment (development|staging|production)')
    .option('--project <name>', 'Project name')
    .option('--input <file>', 'Input .env file (default: .env)')
    .action(
      async (opts: { vault?: string; env?: string; project?: string; input?: string }) => {
        requireSession();
        const api = getApiClient();
        const vaultId = resolveVaultId(opts.vault);

        const projectCfg = readProjectConfig();
        const project = opts.project ?? projectCfg?.project;
        const environment = (opts.env ?? projectCfg?.environment) as
          | EnvVarPayload['environment']
          | undefined;

        // Read input file
        const inputFile = opts.input ?? '.env';
        if (!fs.existsSync(inputFile)) {
          console.error(`File not found: ${inputFile}`);
          process.exit(1);
        }
        const vars = parseEnvFile(fs.readFileSync(inputFile, 'utf8'));
        const varCount = Object.keys(vars).length;

        if (varCount === 0) {
          console.error(`No KEY=VALUE pairs found in ${inputFile}.`);
          process.exit(1);
        }

        // Build payload
        const payload: EnvVarPayload & { _type: 'env_var' } = {
          _type: 'env_var',
          variables: Object.entries(vars).map(([key, value]) => ({ key, value })),
          ...(project ? { project } : {}),
          ...(environment ? { environment } : {}),
        };

        const vaultKey = await resolveVaultKey(vaultId);
        const { ciphertext, iv } = encryptSecret(JSON.stringify(payload), vaultKey);

        // Create or update by matching name
        const secretName = buildSecretName(project, environment);
        const existing = await api.secret.list.query({ vaultId, type: 'env_var' });
        const match = existing.find((s) => s.name === secretName);

        if (match) {
          await api.secret.update.mutate({
            secretId: match.id,
            ciphertext: toBase64(ciphertext),
            iv: toBase64(iv),
          });
          console.log(`Updated "${secretName}" (${varCount} variable${varCount !== 1 ? 's' : ''}).`);
        } else {
          await api.secret.create.mutate({
            vaultId,
            type: 'env_var',
            name: secretName,
            ciphertext: toBase64(ciphertext),
            iv: toBase64(iv),
          });
          console.log(`Created "${secretName}" (${varCount} variable${varCount !== 1 ? 's' : ''}).`);
        }
      },
    );
}

// ── env list ──────────────────────────────────────────────────────────────────

function makeEnvListCommand(): Command {
  return new Command('list')
    .description('List env var secrets (names only) in a vault')
    .option('--vault <id>', 'Vault ID')
    .action(async (opts: { vault?: string }) => {
      requireSession();
      const api = getApiClient();
      const vaultId = resolveVaultId(opts.vault);

      const secretList = await api.secret.list.query({ vaultId, type: 'env_var' });

      if (secretList.length === 0) {
        console.log('No env_var secrets found.');
        return;
      }

      console.log(['Name'.padEnd(50), 'Updated'].join('  '));
      console.log('-'.repeat(70));
      for (const s of secretList) {
        const updated = new Date(s.updatedAt).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
        console.log([s.name.padEnd(50), updated].join('  '));
      }
    });
}

// ── env run ───────────────────────────────────────────────────────────────────

function makeEnvRunCommand(): Command {
  return new Command('run')
    .description('Inject env vars from a vault into a subprocess')
    .argument('<cmd>', 'Command to run')
    .argument('[args...]', 'Arguments for the command')
    .option('--vault <id>', 'Vault ID')
    .option('--env <environment>', 'Environment (development|staging|production)')
    .option('--project <name>', 'Project name')
    .passThroughOptions(true)
    .action(
      async (
        cmd: string,
        args: string[],
        opts: { vault?: string; env?: string; project?: string },
      ) => {
        requireSession();
        const api = getApiClient();
        const vaultId = resolveVaultId(opts.vault);

        const projectCfg = readProjectConfig();
        const project = opts.project ?? projectCfg?.project;
        const environment = (opts.env ?? projectCfg?.environment) as
          | EnvVarPayload['environment']
          | undefined;

        const vaultKey = await resolveVaultKey(vaultId);

        const secretList = await api.secret.list.query({ vaultId, type: 'env_var' });
        const targetName = buildSecretName(project, environment);
        let matched = secretList.find((s) => s.name === targetName);
        if (!matched && secretList.length === 1) matched = secretList[0];

        if (!matched) {
          console.error(
            secretList.length === 0
              ? `No env_var secrets found in vault ${vaultId}.`
              : `No env_var secret matches "${targetName}". Use --project / --env or run \`silo env init\`.`,
          );
          process.exit(1);
        }

        const secret = await api.secret.get.query({ secretId: matched.id });
        const payloadJson = decryptSecret(
          new Uint8Array(Buffer.from(secret.ciphertext, 'base64')),
          vaultKey,
          new Uint8Array(Buffer.from(secret.iv, 'base64')),
        );
        const payload = JSON.parse(payloadJson) as EnvVarPayload & { _type: 'env_var' };

        // Layer vault env vars on top of current process.env
        const env: NodeJS.ProcessEnv = {
          ...process.env,
        };
        for (const { key, value } of payload.variables) {
          env[key] = value;
        }

        const result = spawnSync(cmd, args, { env, stdio: 'inherit', shell: false });
        process.exit(result.status ?? 0);
      },
    );
}

// ── env init ──────────────────────────────────────────────────────────────────

function makeEnvInitCommand(): Command {
  return new Command('init')
    .description('Configure vault + project for the current directory (writes .silo)')
    .action(async () => {
      requireSession();
      const api = getApiClient();

      console.log('Setting up Silo for this directory.\n');

      const vaults = await api.vault.list.query();
      if (vaults.length === 0) {
        console.error('No vaults available. Create one at the web dashboard first.');
        process.exit(1);
      }

      console.log('Available vaults:');
      vaults.forEach((v, i) => {
        console.log(`  ${i + 1}. ${v.name}  (${v.id})`);
      });

      const vaultChoice = await promptInput('\nVault number [1]: ');
      const vaultIdx = parseInt(vaultChoice.trim() || '1', 10) - 1;
      if (vaultIdx < 0 || vaultIdx >= vaults.length) {
        console.error('Invalid choice.');
        process.exit(1);
      }
      const vaultId = vaults[vaultIdx]!.id;
      const vaultName = vaults[vaultIdx]!.name;

      const project = (await promptInput('Project name (e.g. my-app): ')).trim();
      if (!project) {
        console.error('Project name cannot be empty.');
        process.exit(1);
      }

      const envInput = (
        await promptInput('Environment [development/staging/production] (default: development): ')
      ).trim();
      const environment: ProjectConfig['environment'] = ['development', 'staging', 'production'].includes(
        envInput,
      )
        ? (envInput as ProjectConfig['environment'])
        : 'development';

      const projectCfg: ProjectConfig = { vaultId, project, environment };
      writeProjectConfig(projectCfg);

      // Save as global default vault too
      setDefaultVaultId(vaultId);

      console.log(`\nWrote .silo`);
      console.log(`  Vault:       ${vaultName}`);
      console.log(`  Project:     ${project}`);
      console.log(`  Environment: ${environment}`);

      // Add .silo to .gitignore if in a git repo
      const gitignorePath = path.join(process.cwd(), '.gitignore');
      try {
        let gitignore = fs.existsSync(gitignorePath)
          ? fs.readFileSync(gitignorePath, 'utf8')
          : '';
        if (!gitignore.split('\n').some((l) => l.trim() === '.silo')) {
          gitignore += (gitignore.endsWith('\n') ? '' : '\n') + '.silo\n';
          fs.writeFileSync(gitignorePath, gitignore);
          console.log('Added .silo to .gitignore');
        }
      } catch {
        // .gitignore not writable — not fatal
      }

      console.log(`\nRun \`silo env pull\` to fetch your env vars.`);
    });
}

// ── env command group ─────────────────────────────────────────────────────────

export function makeEnvCommand(): Command {
  const cmd = new Command('env')
    .description('Manage environment variables in vaults')
    .enablePositionalOptions();

  cmd.addCommand(makeEnvPullCommand());
  cmd.addCommand(makeEnvPushCommand());
  cmd.addCommand(makeEnvListCommand());
  cmd.addCommand(makeEnvRunCommand());
  cmd.addCommand(makeEnvInitCommand());

  return cmd;
}
