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

  it('has nothing for a message that named nobody', () => {
    // Every message from the PWA. Not an error: the run simply has the
    // server's tools, which is what a phone session always had.
    const registry = new LocalConnectionRegistry();
    registry.attach(fake('c1').connection);
    expect(registry.connection(undefined)).toBeUndefined();
  });

  it('keeps one managed-default and replaces the previous connection', () => {
    const registry = new LocalConnectionRegistry();
    const first = fake('c1');
    const second = fake('c2');
    first.connection.role = 'managed-default';
    second.connection.role = 'managed-default';
    registry.attach(first.connection);
    registry.attach(second.connection);
    expect(first.isClosed()).toBe(true);
    expect(registry.defaultConnection()).toBe(second.connection);
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

  it('lists what is attached, for the prompt and the log', () => {
    const registry = new LocalConnectionRegistry();
    registry.attach(fake('c1', 'macbook').connection);
    expect(registry.attached().map((entry) => entry.hostname)).toEqual(['macbook']);
  });
});
