#!/usr/bin/env node
/**
 * `popman`'s composition root (docs/cli.md, Naming; docs/specs/Spec-Pop-General.md §17).
 *
 * The wiring only: systemd through `systemctl`, the backups through the same
 * service the HTTP routes use, the password through the same `AuthService`.
 * Nothing is reimplemented here, so an operator command and its equivalent in
 * Settings cannot drift apart.
 *
 * Opening the database costs a moment and is only needed by one command, so
 * it happens inside that branch rather than at startup: `popman restart` on
 * a broken install must not fail because SQLite would not open.
 */

import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { run, systemctlArgv, type ManagerDeps, type ServiceVerb } from './commands.js';

/**
 * The unit. One name, fixed (Vinicius, 04/08).
 *
 * An earlier version asked systemd which `pop*` units were installed and
 * took the first that existed. That was written to paper over a wrong
 * default, and it bought a command whose target depended on what happened to
 * be on the box -- fine on the one machine it was tested on, and a guess
 * everywhere else. A tool that stops a service should be predictable about
 * WHICH service before it is clever about finding one.
 *
 * `POP_AGENT_SERVICE` still overrides, for a box running two.
 */
const UNIT = process.env['POP_AGENT_SERVICE'] ?? 'pop-agent-service';
async function onboardingCode(): Promise<{ code: string; expiresAt: number } | undefined> {
  const { resolveDataDir } = await import('../infrastructure/config/data-dir.js');
  const { JsonServerOnboardingRepo, rotateServerOnboardingCode } = await import(
    '../infrastructure/onboarding/onboarding-state-file.js'
  );
  return rotateServerOnboardingCode(
    new JsonServerOnboardingRepo(join(resolveDataDir(), 'server-onboarding.json')),
    Date.now(),
  );
}

function service(verb: ServiceVerb): number {
  // `sudo` for the verbs that change something. Without it systemd hands the
  // request to polkit, whose text agent on a bare SSH session answers
  // "Authentication failure" -- a dead end for something a plain sudo does.
  const { command, args } = systemctlArgv(verb, UNIT, process.getuid?.() === 0);
  // Inherited stdio: `status` is worth reading, sudo needs the tty for its
  // prompt, and systemctl already says what is worth saying about a failure.
  const result = spawnSync(command, args, { stdio: 'inherit' });
  return result.status ?? 1;
}

/**
 * A password typed into a terminal, with the echo off.
 *
 * `readline` cannot hide input on its own; muting the output stream while it
 * reads is the standard trick. Without a TTY there is nothing to mute and
 * nothing to prompt, so it reads a line and moves on -- which is what makes
 * `popman reset-password < file` work in a script.
 */
async function askPassword(prompt: string): Promise<string | undefined> {
  const input = process.stdin;
  const output = process.stdout;
  const hidden = input.isTTY === true;

  const rl = createInterface({ input, output, terminal: hidden });
  const originalWrite = output.write.bind(output);
  try {
    if (hidden) output.write(prompt);
    const answer = await new Promise<string | undefined>((resolve) => {
      rl.once('close', () => resolve(undefined));
      if (hidden) {
        // Swallow the echo, keep the newline behaviour readline expects.
        (output as unknown as { write: (chunk: string) => boolean }).write = () => true;
      }
      rl.question('', (line) => {
        if (hidden) {
          (output as unknown as { write: typeof originalWrite }).write = originalWrite;
          output.write('\n');
        }
        resolve(line);
      });
    });
    return answer === undefined || answer.trim().length === 0 ? undefined : answer;
  } finally {
    if (hidden) (output as unknown as { write: typeof originalWrite }).write = originalWrite;
    rl.close();
  }
}

async function deps(): Promise<ManagerDeps> {
  const { BackupError } = await import('../application/backup/backup-password.js');
  const backupError = (error: unknown): string => error instanceof BackupError
    ? error.message : 'Backup operation failed. Check the archive and available disk space.';
  // Restore must not open SQLite or create a key before replacing offline data.
  if (process.argv[2] === 'restore' || process.argv[2] === 'backups') {
    const { TarBackupService } = await import('../infrastructure/backup/tar-backup-service.js');
    const { resolveDataDir } = await import('../infrastructure/config/data-dir.js');
    const dataDir = resolveDataDir();
    const backups = new TarBackupService({ dataDir, backupsDir: join(dataDir, '..', 'pop-backups'), now: () => new Date().toISOString() });
    return {
      out: (line) => process.stdout.write(`${line}\n`), err: (line) => process.stderr.write(`${line}\n`),
      service, unit: UNIT, backups, askPassword, onboardingCode, backupError,
      resetPassword: () => Promise.resolve({ ok: false as const }), updateSteps: () => [],
    };
  }
  const { bootstrap } = await import('../infrastructure/bootstrap.js');
  const { TarBackupService } = await import('../infrastructure/backup/tar-backup-service.js');
  const { AuthService } = await import('../application/auth/auth-service.js');
  const { Argon2PasswordHasher } = await import('../infrastructure/auth/argon2-hasher.js');

  const context = bootstrap();
  // Beside the data directory, never inside it, exactly as the server has it:
  // a backup must not end up inside the next backup.
  const backups = new TarBackupService({
    secrets: context.secrets,
    dataDir: context.dataDir,
    backupsDir: join(context.dataDir, '..', 'pop-backups'),
    now: () => new Date().toISOString(),
  });
  const auth = new AuthService({
    settings: context.settings,
    secrets: context.secrets,
    hasher: new Argon2PasswordHasher(),
    clock: { now: () => Date.now() },
  });

  return {
    backupError,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    service,
    unit: UNIT,
    backups: {
      create: () => backups.create(),
      list: () => backups.list(),
      restore: (name, password) => backups.restore(name, password),
    },
    resetPassword: (next) => auth.resetPassword(next),
    askPassword,
    updateSteps: () => [
      'Update this install:',
      '',
      '  cd <the clone>',
      '  git pull',
      '  npm ci',
      '  npm run build',
      '  popman restart',
      '',
      'The terminal client updates separately, from this server:',
      '  the Settings → About card shows the current npm command.',
    ],
    onboardingCode,
  };
}

// Only the commands that need the database pay for opening it.
const light = new Set(['start', 'stop', 'restart', 'status', 'onboarding-code', 'help', '-h', '--help', undefined]);
const argv = process.argv.slice(2);

const resolved: ManagerDeps = light.has(argv[0])
  ? {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
      service,
      unit: UNIT,
      backups: {
        create: () => {
          throw new Error('unreachable');
        },
        list: () => [],
        restore: () => false,
      },
      resetPassword: () => Promise.resolve({ ok: false as const }),
      askPassword,
      updateSteps: () => [],
      onboardingCode,
    }
  : await deps();

process.exitCode = await run(argv, resolved);
