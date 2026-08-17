// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clearCache } = vi.hoisted(() => ({ clearCache: vi.fn() }));
vi.mock('./chat-cache', () => ({ chatCache: { clear: clearCache } }));

import { session } from './session';

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  clearCache.mockReset();
  session.clear();
  clearCache.mockClear();
});

describe('browser session storage', () => {
  it('keeps a requested persistent session in localStorage', () => {
    session.start('persistent-token', true);

    expect(session.token()).toBe('persistent-token');
    expect(localStorage.getItem('pop-agent.token')).toBe('persistent-token');
    expect(sessionStorage.getItem('pop-agent.token')).toBeNull();
  });

  it('keeps a page-only session in sessionStorage', () => {
    session.start('page-token', false);

    expect(session.token()).toBe('page-token');
    expect(sessionStorage.getItem('pop-agent.token')).toBe('page-token');
    expect(localStorage.getItem('pop-agent.token')).toBeNull();
  });

  it('falls back to memory when both browser stores reject access', () => {
    const denied = {
      getItem: vi.fn(() => { throw new DOMException('denied', 'SecurityError'); }),
      setItem: vi.fn(() => { throw new DOMException('denied', 'SecurityError'); }),
      removeItem: vi.fn(() => { throw new DOMException('denied', 'SecurityError'); }),
    } as unknown as Storage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(denied);
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(denied);

    expect(() => session.start('memory-token', true)).not.toThrow();
    expect(session.token()).toBe('memory-token');
    session.refresh('renewed-token');
    expect(session.token()).toBe('renewed-token');
    expect(() => session.clear()).not.toThrow();
    expect(session.token()).toBeUndefined();
    expect(clearCache).toHaveBeenCalledOnce();
  });

  it('clears both stores and the authenticated transcript cache', () => {
    localStorage.setItem('pop-agent.token', 'old-local');
    sessionStorage.setItem('pop-agent.token', 'old-session');

    session.clear();

    expect(localStorage.getItem('pop-agent.token')).toBeNull();
    expect(sessionStorage.getItem('pop-agent.token')).toBeNull();
    expect(clearCache).toHaveBeenCalledOnce();
  });
});
