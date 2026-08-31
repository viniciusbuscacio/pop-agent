import type {
  CreateCustomProviderResponse,
  CreateConfiguredCustomProviderRequest,
  OAuthStartResponse,
  OAuthStateResponse,
  ProviderCreditsResponse,
  ProviderSubscriptionUsageResponse,
  ProviderConfigurationRequest,
  ProvidersResponse,
  TestProviderResponse,
  TranscribeResponse,
  UpdateCustomProviderRequest,
} from '@pop-agent/shared';
import { apiRequest } from './api';

/**
 * What the user pastes is often the full endpoint; what the server stores is
 * the base. Same rule as the backend (trailing slashes and a trailing
 * `/chat/completions` stripped), duplicated here so the card can show
 * "requests go to" live while typing.
 */
export function normalizeBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/+$/, '');
}

/**
 * The providers API (docs/specs/Spec-Pop-General.md §15). Everything is per-provider-id; the key
 * is write-only end to end -- it goes in through PUT and no route ever hands
 * it back.
 */
export const providersService = {
  list(): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>('/providers');
  },

  /**
   * The priority list, whole (docs/specs/Spec-Pop-General.md §15, fase 2). Sent complete rather
   * than as a move, so the server never has to merge two half-edits.
   */
  setOrder(ids: string[]): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>('/providers/order', {
      method: 'PUT',
      body: { ids },
    });
  },

  /** The per-provider on/off switch. Off means out of the chain entirely. */
  setEnabled(providerId: string, enabled: boolean): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/${providerId}/enabled`, {
      method: 'PUT',
      body: { enabled },
    });
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

  /** OAuth subscription allowance; no account identity is returned. */
  subscriptionUsage(providerId: string): Promise<ProviderSubscriptionUsageResponse> {
    return apiRequest<ProviderSubscriptionUsageResponse>(
      `/providers/${providerId}/subscription-usage`,
    );
  },

  /** The provider's default model; '' resets to the built-in one. */
  setDefaultModel(providerId: string, model: string): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/${providerId}/default-model`, {
      method: 'PUT',
      body: { model },
    });
  },

  /**
   * The provider's Service Model -- what Pop Agent uses on it for its own work
   * (docs/specs/Spec-Pop-General.md §15). '' puts it back to following the chat model.
   */
  setServiceModel(providerId: string, model: string): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/${providerId}/service-model`, {
      method: 'PUT',
      body: { model },
    });
  },

  /**
   * Unlimited custom providers (docs/specs/Spec-Pop-General.md §15): create empty (the id anchors
   * the card and the key), edit in place, delete with everything that was its.
   */
  createCustom(name?: string): Promise<CreateCustomProviderResponse> {
    return apiRequest<CreateCustomProviderResponse>('/providers/custom', {
      method: 'POST',
      body: name === undefined ? {} : { name },
    });
  },

  updateCustom(id: string, patch: UpdateCustomProviderRequest): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/custom/${id}`, {
      method: 'PATCH',
      body: patch,
    });
  },

  saveConfiguration(id: string, configuration: ProviderConfigurationRequest): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/${id}/configuration`, {
      method: 'PUT',
      body: configuration,
    });
  },

  createConfiguredCustom(
    configuration: CreateConfiguredCustomProviderRequest,
  ): Promise<CreateCustomProviderResponse> {
    return apiRequest<CreateCustomProviderResponse>('/providers/custom/configuration', {
      method: 'POST',
      body: configuration,
    });
  },

  deleteCustom(id: string): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>(`/providers/custom/${id}`, { method: 'DELETE' });
  },

  /**
   * Subscription sign-in (docs/specs/Spec-Pop-General.md §15, fase 1.5): the flow runs on the
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
