#!/usr/bin/env node
/**
 * `popyman`'s composition root (docs/cli.md, Naming; popy.spec §17).
 *
 * The wiring only: systemd through `systemctl`, the backups through the same
 * service the HTTP routes use, the password through the same `AuthService`.
 * Nothing is reimplemented here, so an operator command and its equivalent in
 * Settings cannot drift apart.
 *
 * Opening the database costs a moment and is only needed by one command, so
 * it happens inside that branch rather than at startup: `popyman restart` on
 * a broken install must not fail because SQLite would not open.
 */

import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { run, type ManagerDeps } from './commands.js';

/** The unit name. Overridable, because the dev box runs `popy-dev`. */
const UNIT = process.env['POPY_SERVICE'] ?? 'popy';

function service(verb: 'start' | 'stop' | 'restart' | 'status'): number {
  // Inherited stdio: `status` is worth reading, and systemctl already says
  // everything worth saying about a failure.
  const result = spawnSync('systemctl', [verb, UNIT], { stdio: 'inherit' });
  return result.status ?? 1;
}

/**
 * A password typed into a terminal, with the echo off.
 *
 * `readline` cannot hide input on its own; muting the output stream while it
 * reads is the standard trick. Without a TTY there is nothing to mute and
 * nothing to prompt, so it reads a line and moves on -- which is what makes
 * `popyman reset-password < file` work in a script.
 */
async function askPassword(prompt: string): Promise<string | undefined> {
  const input = process.stdin;
  const output = process.stdout;
  const hidden = input.isTTY === true;

  const rl = createInterface({ input, output, terminal: hidden });
  try {
    if (hidden) output.write(prompt);
    const answer = await new Promise<string>((resolve) => {
      const originalWrite = output.write.bind(output);
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
    return answer.trim().length === 0 ? undefined : answer;
  } finally {
    rl.close();
  }
}

async function deps(): Promise<ManagerDeps> {
  const { bootstrap } = await import('../infrastructure/bootstrap.js');
  const { TarBackupService } = await import('../infrastructure/backup/tar-backup-service.js');
  const { AuthService } = await import('../application/auth/auth-service.js');
  const { Argon2PasswordHasher } = await import('../infrastructure/auth/argon2-hasher.js');

  const context = bootstrap();
  // Beside the data directory, never inside it, exactly as the server has it:
  // a backup must not end up inside the next backup.
  const backups = new TarBackupService({
    dataDir: context.dataDir,
    backupsDir: join(context.dataDir, '..', 'popy-backups'),
    now: () => new Date().toISOString(),
  });
  const auth = new AuthService({
    settings: context.settings,
    secrets: context.secrets,
    hasher: new Argon2PasswordHasher(),
    clock: { now: () => Date.now() },
  });

  return {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    service,
    backups: {
      create: () => backups.create(),
      list: () => backups.list(),
      restore: (name) => backups.restore(name),
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
      '  popyman restart',
      '',
      'The terminal client updates separately, from this server:',
      '  the Settings → About card shows the current npm command.',
    ],
  };
}

// Only the commands that need the database pay for opening it.
const light = new Set(['start', 'stop', 'restart', 'status', 'help', '-h', '--help', undefined]);
const argv = process.argv.slice(2);

const resolved: ManagerDeps = light.has(argv[0])
  ? {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
      service,
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
    }
  : await deps();

process.exitCode = await run(argv, resolved);
