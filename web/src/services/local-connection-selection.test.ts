// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { selectLocalConnection, selectedLocalConnection } from './local-connection-selection';

afterEach(() => localStorage.clear());

describe('local machine selection', () => {
  it('persists a stable machine identity', () => {
    selectLocalConnection('machine-m1');

    expect(selectedLocalConnection()).toBe('machine-m1');
    expect(localStorage.getItem('pop-agent.local-connection')).toBe('machine-m1');
  });

  it('clears a legacy temporary connection identity after an upgrade', () => {
    localStorage.setItem('pop-agent.local-connection', 'local-old-connection');

    expect(selectedLocalConnection()).toBeUndefined();
    expect(localStorage.getItem('pop-agent.local-connection')).toBeNull();
  });
});
