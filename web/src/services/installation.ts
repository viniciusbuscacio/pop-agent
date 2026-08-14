import type {
  DesktopSetupReleaseResponse,
  DesktopSetupTicketResponse,
} from '@pop-agent/shared';
import { apiRequest } from './api';

export function desktopSetupRelease(): Promise<DesktopSetupReleaseResponse> {
  return apiRequest('/desktop/setup/release');
}

export function desktopSetupTicket(): Promise<DesktopSetupTicketResponse> {
  return apiRequest('/desktop/setup/ticket', { method: 'POST' });
}
