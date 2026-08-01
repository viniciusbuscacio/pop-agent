import { describe, expect, it } from 'vitest';
import { shouldFailOver } from './failover.js';

describe('a provider that says nothing', () => {
  it('fails over on the silence deadline, but never on the user s Stop', () => {
    expect(shouldFailOver({ code: 'attempt_timeout' })).toBe(true);
    expect(shouldFailOver({ code: 'aborted' })).toBe(false);
  });
});

describe('shouldFailOver', () => {
  it.each([401, 402, 403, 404, 408, 429])('fails over on a %i refusal', (status) => {
    expect(shouldFailOver({ code: 'provider_error', status })).toBe(true);
  });

  it.each([500, 502, 503, 529, 599])('fails over on a %i outage', (status) => {
    expect(shouldFailOver({ code: 'provider_error', status })).toBe(true);
  });

  it('fails over on transport failures and on a provider with no credentials', () => {
    expect(shouldFailOver({ code: 'network_error' })).toBe(true);
    expect(shouldFailOver({ code: 'provider_not_configured' })).toBe(true);
  });

  it('never fails over on a 400: the request is wrong everywhere', () => {
    expect(shouldFailOver({ code: 'provider_error', status: 400 })).toBe(false);
  });

  it('never fails over on the user s own Stop', () => {
    expect(shouldFailOver({ code: 'aborted' })).toBe(false);
    // Not even when an aborted transport dressed it in a status.
    expect(shouldFailOver({ code: 'aborted', status: 500 })).toBe(false);
  });

  it('never fails over on a tainted turn: the risk must not re-run elsewhere', () => {
    expect(shouldFailOver({ code: 'turn_tainted' })).toBe(false);
  });

  it('stays put on an error nobody could classify', () => {
    expect(shouldFailOver({ code: 'provider_error' })).toBe(false);
    expect(shouldFailOver({ code: 'operation_error' })).toBe(false);
    expect(shouldFailOver({ code: 'model_not_available' })).toBe(false);
  });
});
