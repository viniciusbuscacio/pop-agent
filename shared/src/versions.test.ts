import { describe, expect, it } from 'vitest';
import { compareVersions, installCommand, MIN_CLIENT_VERSION } from './index.js';

/**
 * The rule the attach enforces (docs/cli.md, Version compatibility). Three
 * outcomes, and the only one that must never be wrong is the refusal: a pair
 * that cannot speak has to be stopped before it produces a protocol error
 * nobody can read.
 */
describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('0.2.0', '0.3.0')).toBeLessThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.2.1', '0.2.0')).toBeGreaterThan(0);
  });

  it('calls equal versions equal', () => {
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0);
  });

  it('treats a missing piece as zero, so 0.2 and 0.2.0 are the same', () => {
    expect(compareVersions('0.2', '0.2.0')).toBe(0);
  });

  it('does not throw on nonsense, and sorts it oldest', () => {
    // A client that sends rubbish is refused, not crashed on: the attach
    // reads "older than the minimum" and answers with the install command.
    expect(compareVersions('', MIN_CLIENT_VERSION)).toBeLessThan(0);
    expect(compareVersions('not-a-version', '0.0.1')).toBeLessThan(0);
  });
});

describe('installCommand', () => {
  it('puts the version in the filename, because npm caches by URL', () => {
    // Without it an update silently reinstalls whatever was fetched first.
    expect(installCommand('https://pop-agent.example', '0.3.0')).toBe(
      'npm i -g https://pop-agent.example/cli-0.3.0.tgz',
    );
  });

  it('does not double the slash when the origin carries one', () => {
    expect(installCommand('https://pop-agent.example/', '0.3.0')).toBe(
      'npm i -g https://pop-agent.example/cli-0.3.0.tgz',
    );
  });
});
