import type { AuthStateResponse } from '@pop-agent/shared';
import { authService } from './auth';

/** Retry only the read-only setup lookup; never replay password/provider writes. */
export async function readSetupState(signal: AbortSignal): Promise<AuthStateResponse> {
  for (let attempt = 0; attempt < 6; attempt++) {
    signal.throwIfAborted();
    const request = new AbortController();
    const cancel = () => request.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 8_000);
    try {
      const state = await authService.state(request.signal);
      if (typeof state?.setupDone !== 'boolean'
        || (!state.setupDone && state.setupMode !== 'network' && state.setupMode !== 'account')) {
        throw new Error('Invalid setup state');
      }
      signal.throwIfAborted();
      return state;
    } catch (error) {
      signal.throwIfAborted();
      if (attempt === 5) throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
    }
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, 2_000);
      signal.addEventListener('abort', finish, { once: true });
    });
  }
  throw new Error('Setup unavailable');
}
