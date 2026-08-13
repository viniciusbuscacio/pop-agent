// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from './session';

describe('native Desktop session bridge', () => {
  const postMessage = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    postMessage.mockReset();
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) PopDesktop/0.2.15' });
    Object.defineProperty(window, 'webkit', {
      configurable: true,
      value: { messageHandlers: { popSession: { postMessage } } },
    });
  });

  it('syncs login, renewal, persisted startup and logout through the narrow bridge', () => {
    session.start('token-one', true);
    session.refresh('token-two');
    session.syncDesktop();
    session.clear();

    expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
      { kind: 'session', token: 'token-one' },
      { kind: 'session', token: 'token-two' },
      { kind: 'session', token: 'token-two' },
      { kind: 'session', token: '' },
    ]);
  });

  it('does not expose the session bridge to an ordinary browser', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });
    session.start('browser-token', true);

    expect(postMessage).not.toHaveBeenCalled();
  });
});
