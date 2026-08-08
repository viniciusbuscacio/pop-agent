// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_UPDATE_MINUTES, useUpdatesStore } from './updates';

beforeEach(() => {
  localStorage.clear();
  useUpdatesStore.setState({ intervalMinutes: DEFAULT_UPDATE_MINUTES });
});

describe('updates store', () => {
  it('defaults to ten minutes', () => {
    expect(useUpdatesStore.getState().intervalMinutes).toBe(10);
  });

  it('remembers a valid choice on this device only', () => {
    useUpdatesStore.getState().setIntervalMinutes(1440);

    expect(localStorage.getItem('pop-agent.updateCheckMinutes')).toBe('1440');
    expect(useUpdatesStore.getState().intervalMinutes).toBe(1440);
  });

  it('rejects an unknown interval and falls back to the default', () => {
    useUpdatesStore.getState().setIntervalMinutes(7);

    expect(useUpdatesStore.getState().intervalMinutes).toBe(DEFAULT_UPDATE_MINUTES);
  });
});
