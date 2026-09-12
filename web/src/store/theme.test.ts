// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, useThemeStore } from './theme';

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ choice: 'system' });
});

describe('theme', () => {
  it('writes the choice onto the document so the tokens switch', () => {
    applyTheme('light');
    expect(document.documentElement.dataset['theme']).toBe('light');

    applyTheme('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('remembers the choice on this device only', () => {
    useThemeStore.getState().setChoice('light');

    expect(localStorage.getItem('pop-agent.theme')).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(useThemeStore.getState().choice).toBe('light');
  });
});
