import { settingsResources } from './settings-resources';
import { settingsService } from './settings';
import { providersService } from './providers';
import { chatsService } from './chats';
import { localAccessService } from './local-access';
import { backupsService } from './backups';
import { voiceService } from './voice';
import { serverService } from './server';
import { passkeyService } from './passkey';
import { session } from './session';
import type { ProvidersResponse } from '@pop-agent/shared';

/** Warm every server-backed Settings destination on entry, without mounting
 * hidden forms, starting operations or waiting for the slowest menu. */
export async function preloadSettings(): Promise<void> {
  if (!session.token()) return;
  const generation = session.generation();
  const providers = settingsResources.load('providers', () => providersService.list()).then(async () => {
    if (session.generation() !== generation || !settingsResources.state('providers').fresh) return;
    const response = settingsResources.state('providers').data as ProvidersResponse;
    // Only this provider currently exposes a subscription allowance endpoint.
    if (response.providers.some((provider) => provider.id === 'openai-codex' && provider.configured)) {
      await settingsResources.load('subscription:openai-codex', () => providersService.subscriptionUsage('openai-codex'));
    }
  });
  await Promise.all([
    providers,
    settingsResources.load('settings', () => settingsService.read()),
    settingsResources.load('memory', () => settingsService.readMemory()),
    settingsResources.load('storage', () => settingsService.storage()),
    settingsResources.load('backups', () => backupsService.list()),
    settingsResources.load('devices', () => localAccessService.machines()),
    settingsResources.load('voice-models', () => voiceService.models()),
    settingsResources.load('model-catalog', () => chatsService.models()),
    settingsResources.load('server-info', () => serverService.info()),
    settingsResources.load('update-status', () => settingsService.updateStatus(false)),
    settingsResources.load('about', () => settingsService.about()),
    settingsResources.load('passkeys', () => passkeyService.supported() ? passkeyService.list() : Promise.resolve({ credentials: [] })),
  ]);
}
