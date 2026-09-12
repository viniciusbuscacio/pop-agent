import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeBaseUrl, providersService } from './providers';

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

/**
 * `apiRequest` serializes the body itself, so a service that hands it an
 * already-stringified body double-encodes it and the server answers 400. It
 * cost a silently dead button once: the click fired, the request failed, and
 * the catch swallowed it, so the list simply never moved.
 */
describe('the request bodies', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ providers: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sentBody(): Promise<unknown> {
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    return JSON.parse(String(init?.body ?? 'null')) as unknown;
  }

  it('sends the priority list as an object, not as a string', async () => {
    await providersService.setOrder(['anthropic', 'openrouter']);

    expect(await sentBody()).toEqual({ ids: ['anthropic', 'openrouter'] });
  });

  it('sends the on/off switch as an object, not as a string', async () => {
    await providersService.setEnabled('openrouter', false);

    expect(await sentBody()).toEqual({ enabled: false });
  });
});
