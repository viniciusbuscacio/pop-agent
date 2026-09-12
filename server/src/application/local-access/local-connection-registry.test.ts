import { LocalAccessPolicyService } from './local-access-policy-service.js';
import { MemorySettings } from '../../testing/app-fixture.js';
import { describe, expect, it } from 'vitest';
import {
  LocalConnectionRegistry,
  MISSED_PINGS_BEFORE_GONE,
  type LocalConnection,
  type LocalMachine,
} from './local-connection-registry.js';

const machine = (hostname: string): LocalMachine => ({
  hostname,
  platform: 'darwin',
  arch: 'arm64',
  cwd: '/Users/v',
  clientVersion: '0.2.0',
});

function fake(id: string, hostname = id) {
  const sent: unknown[] = [];
  let closed = false;
  const connection: LocalConnection = {
    id,
    machine: machine(hostname),
    send: (frame) => sent.push(frame),
    close: () => {
      closed = true;
    },
  };
  return { connection, sent, isClosed: () => closed };
}

describe('LocalConnectionRegistry', () => {
  it('finds the terminal a message named', () => {
    const registry = new LocalConnectionRegistry();
    const mac = fake('c1');
    registry.attach(mac.connection);

    expect(registry.connection('c1')).toBe(mac.connection);
  });

  it('resolves a stable machine selection after its connection changes', () => {
    const registry = new LocalConnectionRegistry();
    const terminal = fake('connection-terminal', 'm1');
    terminal.connection.machine.machineId = 'machine-m1';
    terminal.connection.role = 'interactive';
    const tray = fake('connection-tray', 'm1');
    tray.connection.machine.machineId = 'machine-m1';
    tray.connection.role = 'background';
    registry.attach(terminal.connection);
    registry.attach(tray.connection);

    expect(registry.connection('machine-m1')).toBe(tray.connection);
    expect(registry.pwaConnection('machine-m1')).toBe(tray.connection);
  });

  it('requires a background connection for PWA access on macOS and Windows', () => {
    const registry = new LocalConnectionRegistry();
    const mac = fake('mac-interactive');
    mac.connection.machine.machineId = 'machine-mac';
    mac.connection.role = 'interactive';
    const windows = fake('windows-interactive');
    windows.connection.machine.machineId = 'machine-windows';
    windows.connection.machine.platform = 'win32';
    windows.connection.role = 'interactive';
    registry.attach(mac.connection);
    registry.attach(windows.connection);

    expect(registry.pwaConnection('machine-mac')).toBeUndefined();
    expect(registry.pwaConnection('machine-windows')).toBeUndefined();
    expect(registry.connection('mac-interactive')).toBe(mac.connection);
  });

  it('keeps Linux PWA selection role-independent', () => {
    const registry = new LocalConnectionRegistry();
    const linux = fake('linux-interactive');
    linux.connection.machine.machineId = 'machine-linux';
    linux.connection.machine.platform = 'linux';
    linux.connection.role = 'interactive';
    registry.attach(linux.connection);

    expect(registry.pwaConnection('machine-linux')).toBe(linux.connection);
    expect(registry.pwaConnections()).toContain(linux.connection);
    registry.detach(linux.connection.id);
    const reconnected = fake('linux-reconnected');
    reconnected.connection.machine = { ...linux.connection.machine };
    reconnected.connection.role = 'interactive';
    registry.attach(reconnected.connection);
    expect(registry.executionConnection('machine-linux')).toBe(reconnected.connection);
  });

  it('has nothing for a message that named nobody', () => {
    // Every message from the PWA. Not an error: the run simply has the
    // server's tools, which is what a phone session always had.
    const registry = new LocalConnectionRegistry();
    registry.attach(fake('c1').connection);
    expect(registry.connection(undefined)).toBeUndefined();
  });

  it('revokes every connection on an invalidated epoch', () => {
    const registry = new LocalConnectionRegistry();
    const old = fake('old');
    const current = fake('current');
    old.connection.epoch = 1;
    current.connection.epoch = 2;
    registry.attach(old.connection);
    registry.attach(current.connection);
    registry.revokeEpoch(1);
    expect(old.isClosed()).toBe(true);
    expect(current.isClosed()).toBe(false);
  });

  it('has nothing for a terminal that already left', () => {
    const registry = new LocalConnectionRegistry();
    registry.attach(fake('c1').connection);
    registry.detach('c1');
    expect(registry.connection('c1')).toBeUndefined();
  });

  it('keeps two terminals apart', () => {
    // The whole reason hands follow the message: a MacBook and a ThinkPad in
    // one conversation each answer their own, with nothing to arbitrate.
    const registry = new LocalConnectionRegistry();
    const mac = fake('c1', 'macbook');
    const think = fake('c2', 'thinkpad');
    registry.attach(mac.connection);
    registry.attach(think.connection);

    expect(registry.connection('c1')).toBe(mac.connection);
    expect(registry.connection('c2')).toBe(think.connection);
  });

  it('pings, and lets go of a machine that stops answering', () => {
    // A closed lid leaves the socket standing. Without this the run parked on
    // that machine holds the queue for the phone too.
    const registry = new LocalConnectionRegistry();
    const mac = fake('c1');
    registry.attach(mac.connection);

    for (let beat = 0; beat < MISSED_PINGS_BEFORE_GONE; beat += 1) registry.beat();
    expect(mac.sent).toHaveLength(MISSED_PINGS_BEFORE_GONE - 1);
    expect(mac.isClosed()).toBe(true);
    expect(registry.connection('c1')).toBeUndefined();
  });

  it('forgives a machine that answers, however long its command takes', () => {
    // The clock measures the machine, never the command: a twenty-minute
    // install answers pings all the way through and must survive.
    const registry = new LocalConnectionRegistry();
    const mac = fake('c1');
    registry.attach(mac.connection);

    for (let beat = 0; beat < MISSED_PINGS_BEFORE_GONE * 4; beat += 1) {
      registry.beat();
      registry.heard('c1');
    }
    expect(mac.isClosed()).toBe(false);
    expect(registry.attached()).toHaveLength(1);
  });

  it('refuses a call for a terminal that is not there', () => {
    // Rejecting beats falling back to the server: "run this on my machine"
    // answered by the wrong machine is worse than an error.
    const registry = new LocalConnectionRegistry();
    return expect(
      registry.call('ghost', { tool: 'bash', input: {} }, () => undefined),
    ).rejects.toThrow();
  });

  it('never falls back to an interactive connection after the tray disconnects', async () => {
    const registry = new LocalConnectionRegistry();
    const tray = fake('tray');
    tray.connection.machine.machineId = 'machine-m1';
    tray.connection.role = 'background';
    registry.attach(tray.connection);
    registry.detach(tray.connection.id);

    const terminal = fake('terminal');
    terminal.connection.machine.machineId = 'machine-m1';
    terminal.connection.role = 'interactive';
    registry.attach(terminal.connection);

    expect(registry.connection('machine-m1')).toBe(terminal.connection);
    await expect(
      registry.call(tray.connection.id, { tool: 'read', input: { path: '/tmp/a' } }, () => undefined),
    ).rejects.toThrow('no longer available');
  });

  it('lists what is attached, for the prompt and the log', () => {
    const registry = new LocalConnectionRegistry();
    registry.attach(fake('c1', 'macbook').connection);
    expect(registry.attached().map((entry) => entry.hostname)).toEqual(['macbook']);
  });
});

it('removes every transport, rejects stale socket attachment and keeps other machines connected', () => {
  const policy = new LocalAccessPolicyService(new MemorySettings());
  const registry = new LocalConnectionRegistry(undefined, () => 200, policy);
  const first = fake('first');
  const second = fake('second');
  const other = fake('other');
  first.connection.machine.machineId = 'same-machine';
  second.connection.machine.machineId = 'same-machine';
  other.connection.machine.machineId = 'other-machine';
  first.connection.authenticatedAt = second.connection.authenticatedAt = 100;
  registry.attach(first.connection);
  registry.attach(second.connection);
  registry.attach(other.connection);
  registry.setAccessEnabled('same-machine', true);
  first.connection.close = () => { throw new Error('broken socket'); };
  expect(registry.removeMachine('same-machine')).toBe(true);
  expect(second.isClosed()).toBe(true);
  expect(registry.transportConnection('first')).toBeUndefined();
  expect(registry.transportConnection('second')).toBeUndefined();
  expect(registry.transportConnection('other')).toBeDefined();
  expect(registry.attach(second.connection)).toBe(false);
  expect(registry.knownMachines().map(m => m.machineId)).toEqual(['other-machine']);
  second.connection.authenticatedAt = 201;
  expect(registry.attach(second.connection)).toBe(true);
  expect(registry.accessEnabled('same-machine')).toBe(false);
});
