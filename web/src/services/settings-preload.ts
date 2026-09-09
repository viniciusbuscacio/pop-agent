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
import { syncQueue } from './sync-queue';

export const settingsLoaders: Record<string, () => Promise<unknown>> = {
  providers: () => providersService.list(),
  settings: () => settingsService.read(),
  memory: () => settingsService.readMemory(),
  devices: () => localAccessService.machines(),
  'voice-models': () => voiceService.models(),
  'model-catalog': () => chatsService.models(),
  about: () => settingsService.about(),
  passkeys: () => passkeyService.supported() ? passkeyService.list() : Promise.resolve({ credentials: [] }),
  backups: () => backupsService.list(),
  storage: () => settingsService.storage(),
  'server-info': () => serverService.info(),
  'update-status': () => settingsService.updateStatus(false),
};

/** Shared by boot, events and visible Settings controls. */
export function syncSetting(key: string, foreground = false, loader = settingsLoaders[key]): Promise<void> {
  if (!loader) return Promise.resolve();
  const generation = session.generation();
  const queueGeneration = syncQueue.generation();
  void settingsResources.hydrate(key);
  return syncQueue.add(`settings:${key}`, async (signal) => {
    if (signal.aborted || session.generation() !== generation) return;
    await settingsResources.load(key, loader);
    if (settingsResources.state(key).error) throw new Error('Settings synchronization failed');
  }, foreground).then(() => {
    // An event during an in-flight read invalidates that response. Follow the
    // actual change once, not a periodic timer or an automatic error retry.
    const state = settingsResources.state(key);
    if (syncQueue.generation() === queueGeneration && session.generation() === generation && !state.fresh && !state.error && !syncQueue.getState().errors.includes(`settings:${key}`)) {
      return syncSetting(key, foreground, loader);
    }
  });
}

export function ensureSetting(key: string, loader: () => Promise<unknown>): void {
  settingsLoaders[key] = loader;
  void settingsResources.hydrate(key);
  if (!settingsResources.state(key).fresh) void syncSetting(key, true, loader);
  else syncQueue.promote(`settings:${key}`);
}
