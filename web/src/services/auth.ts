import type {
  AuthStateResponse,
  ChangePasswordResponse,
  LoginResponse,
  RecoverResponse,
  SetupResponse,
  SetupAcknowledgeResponse,
  SignOutOthersResponse,
} from '@pop-agent/shared';
import { apiRequest } from './api';
import { session } from './session';

/** Auth calls. Types come from `shared/` -- the frontend never restates them. */
export const authService = {
  state(signal?: AbortSignal): Promise<AuthStateResponse> {
    return apiRequest<AuthStateResponse>('/auth/state', signal === undefined ? {} : { signal });
  },

  setup(password: string): Promise<SetupResponse> {
    return apiRequest<SetupResponse>('/setup', { method: 'POST', body: { password } });
  },

  acknowledgeSetup(): Promise<SetupAcknowledgeResponse> {
    return apiRequest<SetupAcknowledgeResponse>('/setup/acknowledge', { method: 'POST' });
  },

  login(password: string): Promise<LoginResponse> {
    return apiRequest<LoginResponse>('/login', { method: 'POST', body: { password } });
  },

  recover(recoveryKey: string, newPassword: string): Promise<RecoverResponse> {
    return apiRequest<RecoverResponse>('/auth/recover', {
      method: 'POST',
      body: { recoveryKey, newPassword },
    });
  },

  changePassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResponse> {
    return apiRequest<ChangePasswordResponse>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  },

  signOutOthers(): Promise<SignOutOthersResponse> {
    return apiRequest<SignOutOthersResponse>('/auth/sign-out-others', { method: 'POST' });
  },

  signOut(): void {
    session.clear();
  },
};
