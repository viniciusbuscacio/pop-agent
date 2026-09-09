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
import { pendingUiRequests } from './api';

/** Yield between reads so input/navigation effects can start their requests. */
function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, 150);
    if (signal?.aborted) done();
    else signal?.addEventListener('abort', done, { once: true });
  });
}

/** Warm every server-backed Settings destination on entry, without mounting
 * hidden forms, starting operations or waiting for the slowest menu. */
export async function preloadSettings(signal?: AbortSignal): Promise<void> {
  if (!session.token()) return;
  const generation = session.generation();
  const current = () => !signal?.aborted && session.generation() === generation && !!session.token();
  const queue: [string, () => Promise<unknown>][] = [
    ['providers', () => providersService.list()],
    ['settings', () => settingsService.read()],
    ['memory', () => settingsService.readMemory()],
    ['devices', () => localAccessService.machines()],
    ['voice-models', () => voiceService.models()],
    ['model-catalog', () => chatsService.models()],
    ['about', () => settingsService.about()],
    ['passkeys', () => passkeyService.supported() ? passkeyService.list() : Promise.resolve({ credentials: [] })],
    ['backups', () => backupsService.list()],
    ['storage', () => settingsService.storage()],
    ['server-info', () => serverService.info()],
    ['update-status', () => settingsService.updateStatus(false)],
  ];
  for (const [key, loader] of queue) {
    do {
      await pause(signal);
      if (!current()) return;
    } while (document.hidden || pendingUiRequests() > 0);
    const state = settingsResources.state(key);
    // A destination may already have loaded this resource while we yielded.
    if (!state.fresh || Date.now() - (state.savedAt ?? 0) > 30_000) {
      await settingsResources.load(key, loader);
    }
    if (key === 'providers' && current() && settingsResources.state(key).fresh) {
      const response = settingsResources.state(key).data as ProvidersResponse;
      if (response.providers.some((provider) => provider.id === 'openai-codex' && provider.configured)) {
        queue.push(['subscription:openai-codex', () => providersService.subscriptionUsage('openai-codex')]);
      }
    }
  }
}
