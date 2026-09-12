// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearLocalConnection,
  selectLocalConnection,
  selectedLocalConnection,
} from './local-connection-selection';

afterEach(() => localStorage.clear());

describe('local machine selection', () => {
  it('persists a stable machine identity', () => {
    selectLocalConnection('machine-m1');

    expect(selectedLocalConnection()).toBe('machine-m1');
    expect(localStorage.getItem('pop-agent.local-machine-selection-v2')).toBe('machine-m1');
  });

  it('clears a rejected stable identity without overwriting a newer selection', () => {
    selectLocalConnection('machine-old');
    clearLocalConnection('machine-old');
    expect(selectedLocalConnection()).toBeUndefined();

    selectLocalConnection('machine-new');
    clearLocalConnection('machine-old');
    expect(selectedLocalConnection()).toBe('machine-new');
  });

  it('migrates every legacy automatic or temporary selection to server-only', () => {
    localStorage.setItem('pop-agent.local-connection', 'machine-automatically-selected');

    expect(selectedLocalConnection()).toBeUndefined();
    expect(localStorage.getItem('pop-agent.local-connection')).toBeNull();
    expect(localStorage.getItem('pop-agent.local-machine-selection-v2')).toBeNull();
  });
});
