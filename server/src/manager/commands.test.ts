import { describe, expect, it } from 'vitest';
import { run, systemctlArgv, type ManagerDeps } from './commands.js';

/**
 * popman's behaviour, without a systemd or a database (docs/specs/Spec-Pop-General.md §17).
 *
 * What is worth pinning is the wording as much as the exit code: these
 * commands are read by whoever is locked out at the time, and "the password
 * is unchanged" is the sentence that stops them guessing whether it half
 * worked.
 */
function harness(overrides: Partial<ManagerDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];

  const deps: ManagerDeps = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    service: (verb) => {
      calls.push(verb);
      return 0;
    },
    unit: 'pop-agent-service',
    backups: {
      create: () => ({ name: 'pop-2026-08-04.tar.gz', size: 5 * 1024 * 1024 }),
      list: () => [],
      restore: (name) => name === 'pop-2026-08-04.tar.gz',
    },
    resetPassword: () => Promise.resolve({ ok: true, recoveryKey: 'KEY-1234' }),
    askPassword: () => Promise.resolve('correcthorsebattery'),
    updateSteps: () => ['git pull'],
    ...overrides,
  };

  return { deps, out, err, calls };
}

describe('popman', () => {
  it('passes the service verbs straight through', async () => {
    const h = harness();
    expect(await run(['restart'], h.deps)).toBe(0);
    expect(h.calls).toEqual(['restart']);
  });

  it('says which unit it is acting on', async () => {
    // A box can carry pop and pop-agent-service at once, and "Failed to stop
    // pop.service" is a true sentence about the wrong service.
    const h = harness();
    await run(['stop'], h.deps);
    expect(h.out.join('\n')).toContain('pop-agent-service');
  });

  it('does not announce status, which speaks for itself', async () => {
    const h = harness();
    await run(['status'], h.deps);
    expect(h.out).toEqual([]);
  });

  it('prints usage and fails when asked for nothing', async () => {
    // A bare `popman` is a mistake, not a request; exiting 0 would let it
    // pass in a script that meant to start the service.
    const h = harness();
    expect(await run([], h.deps)).toBe(1);
    expect(h.out.join('\n')).toContain('popman start');
  });

  it('says which command it did not understand', async () => {
    const h = harness();
    expect(await run(['strat'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('strat');
  });

  it('refuses restore without a name, and points at the list', async () => {
    const h = harness();
    expect(await run(['restore'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('popman backups');
  });

  it('reports a backup name that does not exist', async () => {
    const h = harness();
    expect(await run(['restore', 'nope.tar.gz'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('No such backup');
  });

  it('tells you to restart after a restore, because it does not', async () => {
    const h = harness();
    expect(await run(['restore', 'pop-2026-08-04.tar.gz'], h.deps)).toBe(0);
    expect(h.out.join('\n')).toContain('popman restart');
  });

  it('shows the new recovery key once, and says it is once', async () => {
    const h = harness();
    expect(await run(['reset-password'], h.deps)).toBe(0);
    const said = h.out.join('\n');
    expect(said).toContain('KEY-1234');
    expect(said).toContain('not shown again');
    expect(said).toContain('signed out');
  });

  it('changes nothing when the two passwords differ', async () => {
    let asked = 0;
    const h = harness({
      askPassword: () => Promise.resolve(asked++ === 0 ? 'correcthorse1' : 'correcthorse2'),
      resetPassword: () => {
        throw new Error('must not be called');
      },
    });
    expect(await run(['reset-password'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('unchanged');
  });

  it('changes nothing when the password is too short', async () => {
    const h = harness({
      askPassword: () => Promise.resolve('short'),
      resetPassword: () => {
        throw new Error('must not be called');
      },
    });
    expect(await run(['reset-password'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('unchanged');
  });

  it('says plainly when there is no account to reset', async () => {
    // A long-enough password, so the failure is the missing account and not
    // the length rule standing in front of it.
    const h = harness({
      askPassword: () => Promise.resolve('correcthorsebattery'),
      resetPassword: () => Promise.resolve({ ok: false }),
    });
    expect(await run(['reset-password'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('No account');
  });

  it('admits access-list does not exist rather than pretending', async () => {
    const h = harness();
    expect(await run(['access-list', 'clean'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toContain('Not built yet');
  });

  it('reads status without sudo, and changes the machine with it', async () => {
    // Asking for a password to READ is a habit worth not teaching; and
    // without sudo the other three fall to polkit, whose text agent answers
    // "Authentication failure" on a plain SSH session.
    expect(systemctlArgv('status', 'pop-agent-service', false).command).toBe('systemctl');
    expect(systemctlArgv('stop', 'pop-agent-service', false)).toEqual({
      command: 'sudo',
      args: ['systemctl', 'stop', 'pop-agent-service'],
    });
  });

  it('skips sudo when it is already root', async () => {
    expect(systemctlArgv('stop', 'pop', true)).toEqual({
      command: 'systemctl',
      args: ['stop', 'pop'],
    });
  });

  it('says there are no backups instead of printing nothing', async () => {
    const h = harness();
    expect(await run(['backups'], h.deps)).toBe(0);
    expect(h.out.join('\n')).toContain('popman backup');
  });
});
