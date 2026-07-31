// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { useThinkingStore } from './thinking';

beforeEach(() => {
  localStorage.clear();
  useThinkingStore.setState({ show: true });
});

describe('thinking visibility', () => {
  it('defaults to showing the thinking', () => {
    expect(useThinkingStore.getState().show).toBe(true);
  });

  it('toggles and remembers on this device only', () => {
    useThinkingStore.getState().toggle();

    expect(useThinkingStore.getState().show).toBe(false);
    expect(localStorage.getItem('popy.showThinking')).toBe('false');

    useThinkingStore.getState().toggle();
    expect(useThinkingStore.getState().show).toBe(true);
    expect(localStorage.getItem('popy.showThinking')).toBe('true');
  });
});
