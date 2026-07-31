import type { ProvidersResponse, TestProviderResponse } from '@popy/shared';
import { apiRequest } from './api';

export const providersService = {
  list(): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>('/providers');
  },

  /** Write-only: the key goes in and no route ever hands it back. */
  setKey(apiKey: string): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>('/providers/openrouter/key', {
      method: 'PUT',
      body: { apiKey },
    });
  },

  clearKey(): Promise<ProvidersResponse> {
    return apiRequest<ProvidersResponse>('/providers/openrouter/key', { method: 'DELETE' });
  },

  /** With a key: test the pasted one. Without: test whatever is stored. */
  test(apiKey?: string): Promise<TestProviderResponse> {
    return apiRequest<TestProviderResponse>('/providers/openrouter/test', {
      method: 'POST',
      body: apiKey === undefined ? {} : { apiKey },
    });
  },
};
