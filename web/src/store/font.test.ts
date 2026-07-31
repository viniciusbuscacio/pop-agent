// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyFontSize, useFontStore } from './font';

beforeEach(() => {
  localStorage.clear();
  useFontStore.setState({ choice: 'default' });
  document.documentElement.style.fontSize = '';
});

describe('font size', () => {
  it('scales the root font-size so every rem follows', () => {
    applyFontSize('large');
    expect(document.documentElement.style.fontSize).toBe('112.5%');

    applyFontSize('default');
    expect(document.documentElement.style.fontSize).toBe('100%');
  });

  it('remembers the choice on this device only', () => {
    useFontStore.getState().setChoice('xlarge');

    expect(localStorage.getItem('popy.fontSize')).toBe('xlarge');
    expect(document.documentElement.style.fontSize).toBe('125%');
    expect(useFontStore.getState().choice).toBe('xlarge');
  });

  it('falls back to default on a value from the future', () => {
    localStorage.setItem('popy.fontSize', 'gigantic');
    // A fresh read (new session) must not crash on the unknown value.
    useFontStore.getState().setChoice('default');
    expect(document.documentElement.style.fontSize).toBe('100%');
  });
});
