#!/usr/bin/env node
import { createInterface as createLineInterface } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { Profiles } from './application/profiles.js';
import { Preferences } from './application/preferences.js';
import { PopAgentApi } from './infrastructure/api.js';
import { FilePreferenceStore } from './infrastructure/preference-file.js';
import { FileProfileStore } from './infrastructure/profile-file.js';
import { LocalAccess } from './infrastructure/local-access.js';
import { installCli } from './infrastructure/installer.js';
import { runCli } from './interface/cli.js';
import { type Context, type Terminal } from './interface/commands.js';

/**
 * Composition root (docs/cli.md, "Layout"). The one place that knows there is
 * a real filesystem, a real terminal and a real network; everything below is
 * handed what it needs and is testable without any of the three.
 */

function createContext(profile: string, terminal: Terminal): Context {
  const profiles = new Profiles(new FileProfileStore());
  return {
    profiles,
    preferences: new Preferences(new FilePreferenceStore()),
    terminal,
    profile,
    // Every call can hand back a fresher token; storing it here is what keeps
    // a client that runs once a week from being signed out (spec §9).
    api: (options) =>
      new PopAgentApi({ ...options, onToken: (token) => profiles.refresh(profile, token) }),
    localAccess: (options) => new LocalAccess(options),
    installCli,
    waitForShutdown,
    watchLocalAccessControl,
  };
}

function watchLocalAccessControl(onEnabled: (enabled: boolean) => void): () => void {
  const lines = createLineInterface({ input: process.stdin, terminal: false });
  lines.on('line', (line) => {
    try {
      const command = JSON.parse(line) as { kind?: unknown; enabled?: unknown };
      if (command.kind === 'set-access' && typeof command.enabled === 'boolean') {
        onEnabled(command.enabled);
      }
    } catch {
      // The tray protocol is line-delimited JSON; malformed input is ignored.
    }
  });
  return () => lines.close();
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

/** The real terminal. Kept here so `run` can be driven by a fake in tests. */
const realTerminal: Terminal = {
  line: (text = '') => process.stdout.write(`${text}\n`),
  write: (text) => process.stdout.write(text),
  password: async (prompt) => {
    // The prompt is written by hand and readline's output is thrown away, so
    // the keystrokes never echo: a password must not survive in a scrollback
    // or in a screen share. readline still does the line editing.
    const swallow = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    process.stdout.write(prompt);
    const rl = createInterface({ input: process.stdin, output: swallow, terminal: true });
    try {
      return await rl.question('');
    } finally {
      rl.close();
      process.stdout.write('\n');
    }
  },
};

// `import.meta.main` is not in Node 22, and comparing argv[1] would break when
// the bin is a symlink from npm. Running main is the package's only job.
runCli(process.argv.slice(2), realTerminal, createContext)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stdout.write(`${error instanceof Error ? error.message : 'Something went wrong.'}\n`);
    process.exitCode = 1;
  });
