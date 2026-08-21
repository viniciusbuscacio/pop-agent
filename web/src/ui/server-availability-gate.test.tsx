// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const health = vi.hoisted(() => {
  let state: { kind: string } = { kind: 'ok' };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(kind: string) {
      state = { kind };
      for (const listener of listeners) listener();
    },
  };
});

vi.mock('../services/health', () => ({
  healthMonitor: {
    getState: health.getState,
    subscribe: health.subscribe,
  },
}));

import { ServerAvailabilityGate } from './server-availability-gate';

afterEach(() => {
  cleanup();
  health.set('ok');
});

describe('ServerAvailabilityGate', () => {
  it('keeps loaded content visible but inert until the server reconnects', () => {
    render(
      <ServerAvailabilityGate>
        <button type="button">Server action</button>
      </ServerAvailabilityGate>,
    );
    const gate = screen.getByTestId('server-availability-gate');
    expect(gate.hasAttribute('inert')).toBe(false);

    act(() => health.set('offline'));
    expect(gate.hasAttribute('inert')).toBe(true);
    expect(gate.getAttribute('data-server-unavailable')).toBe('true');
    expect(screen.getByRole('button', { hidden: true }).textContent).toBe('Server action');

    act(() => health.set('ok'));
    expect(gate.hasAttribute('inert')).toBe(false);
    expect(gate.getAttribute('data-server-unavailable')).toBe('false');
  });
});
