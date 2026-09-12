import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { apiRequest } from './api';

/**
 * Passkey / Face ID from the browser side (docs/specs/Spec-Pop-General.md §9). Registration needs a
 * session; login is public and hands back a session token the app then holds,
 * exactly like the password login.
 */

export const passkeyService = {
  supported(): boolean {
    return typeof window !== 'undefined' && window.PublicKeyCredential !== undefined;
  },

  /** Registers this device's authenticator. Throws if the user cancels. */
  async register(label: string): Promise<void> {
    const options = await apiRequest<PublicKeyCredentialCreationOptionsJSON>(
      '/auth/webauthn/register/options',
      { method: 'POST' },
    );
    const response = await startRegistration({ optionsJSON: options });
    await apiRequest('/auth/webauthn/register/verify', {
      method: 'POST',
      body: { response, meta: { label } },
    });
  },

  /** Unlocks with a passkey; returns the session token for the store to hold. */
  async login(): Promise<string> {
    const options = await apiRequest<PublicKeyCredentialRequestOptionsJSON>(
      '/auth/webauthn/login/options',
      { method: 'POST' },
    );
    const response = await startAuthentication({ optionsJSON: options });
    const { token } = await apiRequest<{ token: string }>('/auth/webauthn/login/verify', {
      method: 'POST',
      body: { response },
    });
    return token;
  },

  list(): Promise<{ credentials: { id: string; label: string }[] }> {
    return apiRequest('/auth/webauthn/credentials');
  },

  remove(id: string): Promise<void> {
    return apiRequest<void>(`/auth/webauthn/credentials/${id}`, { method: 'DELETE' });
  },
};
