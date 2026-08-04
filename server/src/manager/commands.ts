/**
 * `popyman` — the operator's tool (docs/cli.md, Naming; popy.spec §17).
 *
 * The split from `popy` is not cosmetic. Keeping them one command would drag
 * `better-sqlite3`, `argon2` and code that knows where `secret.key` lives onto
 * every laptop that wants to chat from a terminal. So the everyday tool gets
 * the good name and installs anywhere, and the dangerous one ships with the
 * server, runs only there, and reads like what it is.
 *
 * Everything here touches the machine: systemd, the SQLite file, the backups
 * directory. None of it goes over HTTP, and `reset-password` in particular
 * must not -- see {@link AuthService.resetPassword}.
 *
 * The parsing and the wording live here, apart from the process, so the
 * behaviour can be tested without a systemd or a database.
 */

export interface ManagerIo {
  out(line: string): void;
  err(line: string): void;
}

export interface ManagerDeps extends ManagerIo {
  /** Runs a systemctl verb; returns its exit code. */
  service(verb: 'start' | 'stop' | 'restart' | 'status'): number;
  backups: {
    create(): { name: string; size: number };
    list(): { name: string; size: number; createdAt: string }[];
    restore(name: string): boolean;
  };
  /** Replaces the password and returns the new recovery key. */
  resetPassword(next: string): Promise<{ ok: true; recoveryKey: string } | { ok: false }>;
  /** Asks for a password without echoing it; undefined when nothing typed. */
  askPassword(prompt: string): Promise<string | undefined>;
  /** How this install is updated, as one printable block. */
  updateSteps(): string[];
}

export const USAGE = [
  'popyman — the Popy service, from the machine it runs on',
  '',
  '  popyman start | stop | restart | status',
  '  popyman backup                  make one now',
  '  popyman backups                 list what is kept',
  '  popyman restore <name>          replace the data with a backup',
  '  popyman reset-password          lost the password AND the recovery key',
  '  popyman update                  how to move this install forward',
  '',
  'The chat client is a different command: popy. See docs/cli.md.',
];

const MIN_PASSWORD = 10;

export async function run(argv: string[], deps: ManagerDeps): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      for (const line of USAGE) deps.out(line);
      return command === undefined ? 1 : 0;

    case 'start':
    case 'stop':
    case 'restart':
    case 'status':
      return deps.service(command);

    case 'backup': {
      const made = deps.backups.create();
      deps.out(`${made.name}  ${megabytes(made.size)}`);
      return 0;
    }

    case 'backups': {
      const kept = deps.backups.list();
      if (kept.length === 0) {
        deps.out('No backups yet. `popyman backup` makes one.');
        return 0;
      }
      for (const entry of kept) {
        deps.out(`${entry.createdAt}  ${megabytes(entry.size).padStart(9)}  ${entry.name}`);
      }
      return 0;
    }

    case 'restore': {
      const name = rest[0];
      if (name === undefined) {
        deps.err('Which backup? `popyman backups` lists them.');
        return 1;
      }
      // Not confirmed here, and that is deliberate: restore is reached by
      // typing a specific filename that had to be read off `backups` first,
      // which is a longer path than any y/N prompt.
      if (!deps.backups.restore(name)) {
        deps.err(`No such backup: ${name}`);
        return 1;
      }
      deps.out(`Restored ${name}. Restart the service: popyman restart`);
      return 0;
    }

    case 'reset-password': {
      const next = await deps.askPassword('New password: ');
      if (next === undefined || next.length === 0) {
        deps.err('Nothing typed; the password is unchanged.');
        return 1;
      }
      const again = await deps.askPassword('Again: ');
      if (again !== next) {
        deps.err('They do not match; the password is unchanged.');
        return 1;
      }
      if (next.length < MIN_PASSWORD) {
        deps.err(`At least ${MIN_PASSWORD} characters; the password is unchanged.`);
        return 1;
      }

      const result = await deps.resetPassword(next);
      if (!result.ok) {
        deps.err('No account has been set up on this install yet.');
        return 1;
      }

      // The key is shown once and never stored in a readable form. Saying so
      // is the difference between the user writing it down and finding out
      // later that nobody can.
      deps.out('Password changed. Every signed-in device was signed out.');
      deps.out('');
      deps.out('Your new recovery key — write it down, it is not shown again:');
      deps.out(`  ${result.recoveryKey}`);
      return 0;
    }

    case 'update': {
      for (const line of deps.updateSteps()) deps.out(line);
      return 0;
    }

    case 'access-list':
      // Named in popy.spec §18 and not built: there is no IP access list to
      // manage yet. Saying so beats a command that appears to work.
      deps.err('Not built yet: Popy has no IP access list (popy.spec §18).');
      return 1;

    default:
      deps.err(`popyman: unknown command "${command}"`);
      for (const line of USAGE) deps.err(line);
      return 1;
  }
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
