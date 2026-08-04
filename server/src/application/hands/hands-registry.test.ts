import { describe, expect, it } from 'vitest';
import {
  HandsRegistry,
  MISSED_PINGS_BEFORE_GONE,
  type HandsConnection,
  type HandsMachine,
} from './hands-registry.js';

const machine = (hostname: string): HandsMachine => ({
  hostname,
  platform: 'darwin',
  arch: 'arm64',
  cwd: '/Users/v',
  clientVersion: '0.2.0',
});

function fake(id: string, hostname = id) {
  const sent: unknown[] = [];
  let closed = false;
  const connection: HandsConnection = {
    id,
    machine: machine(hostname),
    send: (frame) => sent.push(frame),
    close: () => {
      closed = true;
    },
  };
  return { connection, sent, isClosed: () => closed };
}

describe('HandsRegistry', () => {
  it('gives the hands to the terminal that asked', () => {
    const registry = new HandsRegistry();
    const mac = fake('c1');
    registry.attach(mac.connection);

    expect(registry.claim('chat-1', 'c1')).toBe('c1');
    expect(registry.handsFor('chat-1')).toBe(mac.connection);
  });

  it('keeps a second terminal as a spectator', () => {
    // Someone has to own them, or two machines run npm install at once.
    const registry = new HandsRegistry();
    const first = fake('c1');
    const second = fake('c2');
    registry.attach(first.connection);
    registry.attach(second.connection);

    registry.claim('chat-1', 'c1');
    expect(registry.claim('chat-1', 'c2')).toBe('c1');
    expect(registry.handsFor('chat-1')).toBe(first.connection);
  });

  it('frees the chat when its terminal leaves', () => {
    const registry = new HandsRegistry();
    const first = fake('c1');
    const second = fake('c2');
    registry.attach(first.connection);
    registry.attach(second.connection);
    registry.claim('chat-1', 'c1');

    registry.detach('c1');
    expect(registry.handsFor('chat-1')).toBeUndefined();
    // And the next terminal can take them.
    expect(registry.claim('chat-1', 'c2')).toBe('c2');
  });

  it('has no hands for a chat nobody claimed', () => {
    const registry = new HandsRegistry();
    registry.attach(fake('c1').connection);
    expect(registry.handsFor('chat-9')).toBeUndefined();
  });

  it('pings, and lets go of a machine that stops answering', () => {
    // A closed lid leaves the socket standing. Without this the run parked on
    // that machine holds the queue for the phone too.
    const registry = new HandsRegistry();
    const mac = fake('c1');
    registry.attach(mac.connection);
    registry.claim('chat-1', 'c1');

    for (let beat = 0; beat < MISSED_PINGS_BEFORE_GONE; beat += 1) registry.beat();
    expect(mac.sent).toHaveLength(MISSED_PINGS_BEFORE_GONE);
    expect(registry.handsFor('chat-1')).toBe(mac.connection);

    registry.beat();
    expect(mac.isClosed()).toBe(true);
    expect(registry.handsFor('chat-1')).toBeUndefined();
  });

  it('forgives a machine that answers, however long its command takes', () => {
    // The clock measures the machine, never the command: a twenty-minute
    // install answers pings all the way through and must survive.
    const registry = new HandsRegistry();
    const mac = fake('c1');
    registry.attach(mac.connection);

    for (let beat = 0; beat < MISSED_PINGS_BEFORE_GONE * 4; beat += 1) {
      registry.beat();
      registry.heard('c1');
    }
    expect(mac.isClosed()).toBe(false);
    expect(registry.attached()).toHaveLength(1);
  });

  it('ignores a claim from a terminal that is not attached', () => {
    const registry = new HandsRegistry();
    expect(registry.claim('chat-1', 'ghost')).toBeUndefined();
    expect(registry.handsFor('chat-1')).toBeUndefined();
  });

  it('lists what is attached, for the prompt and the log', () => {
    const registry = new HandsRegistry();
    registry.attach(fake('c1', 'macbook').connection);
    expect(registry.attached().map((entry) => entry.hostname)).toEqual(['macbook']);
  });
});
