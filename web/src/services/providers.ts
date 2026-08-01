import type {
  OAuthStartResponse,
  OAuthStateResponse,
  ProviderCreditsResponse,
  ProvidersResponse,
  TestProviderResponse,
  TranscribeResponse,
} from '@popy/shared';
import { apiRequest } from './api';

/**
 * The providers API (popy.spec §15). Everything is per-provider-id; the key
 * is write-only end to end -- it goes in through PUT and no route ever hands
 * it back.
 */
export const providersService = {
  list(): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>('/providers');
  },

  /** Write-only: the key goes in and no route ever hands it back. */
  setKey(providerId: string, apiKey: string): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/${providerId}/key`, {
      method: 'PUT',
      body: { apiKey },
    });
  },

  clearKey(providerId: string): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/${providerId}/key`, { method: 'DELETE' });
  },

  /** With a key: test the pasted one. Without: test whatever is stored. */
  test(providerId: string, apiKey?: string): Promise<TestProviderResponse> {
    return apiRequest<TestProviderResponse>(`/providers/${providerId}/test`, {
      method: 'POST',
      body: apiKey === undefined ? {} : { apiKey },
    });
  },

  /**
   * The provider's balance, when it publishes one (LOTE 6). Rejects on ANY
   * failure -- the card catches and hides the row, never the other way round.
   */
  credits(providerId: string): Promise<ProviderCreditsResponse> {
    return apiRequest<ProviderCreditsResponse>(`/providers/${providerId}/credits`);
  },

  /** The provider's default model; '' resets to the built-in one. */
  setDefaultModel(providerId: string, model: string): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/${providerId}/default-model`, {
      method: 'PUT',
      body: { model },
    });
  },

  /** The custom provider is pure data: an endpoint and a model. */
  setCustomConfig(baseURL: string, defaultModel: string): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>('/providers/custom/config', {
      method: 'PUT',
      body: { baseURL, defaultModel },
    });
  },

  /**
   * Subscription sign-in (popy.spec §15, fase 1.5): the flow runs on the
   * server; the card starts it, polls its transcript and answers its one
   * question. No token material ever reaches the browser.
   */
  oauthStart(providerId: string): Promise<OAuthStartResponse> {
    return apiRequest<OAuthStartResponse>(`/providers/${providerId}/oauth/start`, {
      method: 'POST',
    });
  },

  oauthState(providerId: string): Promise<OAuthStateResponse> {
    return apiRequest<OAuthStateResponse>(`/providers/${providerId}/oauth/state`);
  },

  oauthInput(providerId: string, value: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`/providers/${providerId}/oauth/input`, {
      method: 'POST',
      body: { value },
    });
  },

  oauthCancel(providerId: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>(`/providers/${providerId}/oauth/cancel`, {
      method: 'POST',
    });
  },

  /** Disconnect: the server drops the stored subscription credential. */
  oauthLogout(providerId: string): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/${providerId}/oauth/logout`, {
      method: 'POST',
    });
  },

  /** A recording in, its words out (aw's voice flow, through the provider). */
  transcribe(dataUri: string): Promise<TranscribeResponse> {
    return apiRequest<TranscribeResponse>('/transcribe', { method: 'POST', body: { dataUri } });
  },
};
