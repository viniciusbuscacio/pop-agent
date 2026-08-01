import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl } from './providers';

describe('normalizeBaseUrl', () => {
  it('strips a pasted full endpoint down to the base', () => {
    expect(normalizeBaseUrl('http://localhost:11434/v1/chat/completions')).toBe(
      'http://localhost:11434/v1',
    );
    expect(normalizeBaseUrl('https://api.example.com/v1/CHAT/COMPLETIONS/')).toBe(
      'https://api.example.com/v1',
    );
  });

  it('strips trailing slashes and whitespace', () => {
    expect(normalizeBaseUrl('  https://api.example.com/v1///  ')).toBe('https://api.example.com/v1');
  });

  it('leaves a clean base URL alone', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });

  it('does not touch a completions segment in the middle of the path', () => {
    expect(normalizeBaseUrl('https://api.example.com/chat/completions/v1')).toBe(
      'https://api.example.com/chat/completions/v1',
    );
  });
});
