import type {
  OnboardingPairResponse,
  OnboardingPublicStateResponse,
  OnboardingStateResponse,
} from '@pop-agent/shared';
import { apiRequest } from './api';

const TOKEN_KEY = 'pop-agent:onboarding-token';
let memoryToken: string | undefined;

export const onboardingSession = {
  read(): string | undefined {
    try {
      const value = sessionStorage.getItem(TOKEN_KEY);
      return value === null || value.length === 0 ? memoryToken : value;
    } catch {
      return memoryToken;
    }
  },
  write(token: string): void {
    memoryToken = token;
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Page memory still carries the consumed one-time exchange.
    }
  },
  clear(): void {
    memoryToken = undefined;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // It was not writable, so page memory was the only copy.
    }
  },
};

export const onboardingService = {
  publicState(): Promise<OnboardingPublicStateResponse> {
    return apiRequest<OnboardingPublicStateResponse>('/onboarding/public');
  },

  pair(code: string): Promise<OnboardingPairResponse> {
    return apiRequest<OnboardingPairResponse>('/onboarding/pair', {
      method: 'POST',
      body: { code },
    });
  },

  state(token: string): Promise<OnboardingStateResponse> {
    return apiRequest<OnboardingStateResponse>('/onboarding/state', { onboardingToken: token });
  },

  connect(token: string): Promise<OnboardingStateResponse> {
    return apiRequest<OnboardingStateResponse>('/onboarding/tailscale/connect', {
      method: 'POST',
      onboardingToken: token,
    });
  },

  enableHttps(
    token: string,
    accepted: boolean,
    hostname?: string,
  ): Promise<OnboardingStateResponse> {
    return apiRequest<OnboardingStateResponse>('/onboarding/tailscale/https', {
      method: 'POST',
      onboardingToken: token,
      body: {
        acceptCertificateTransparency: accepted,
        ...(hostname === undefined || hostname.length === 0 ? {} : { hostname }),
      },
    });
  },
};
