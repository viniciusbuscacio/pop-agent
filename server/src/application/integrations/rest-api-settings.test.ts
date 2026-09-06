import { expect, it } from 'vitest';
import { MemorySettings } from '../../testing/app-fixture.js';
import { RestApiSettingsService } from './rest-api-settings.js';
it('persists switches across service reconstruction and preserves the other module', () => {
  const repo = new MemorySettings();
  const first = new RestApiSettingsService(repo);
  expect(first.get()).toEqual({ serverEnabled: true, clientEnabled: true });
  first.update({ serverEnabled: false });
  const second = new RestApiSettingsService(repo);
  expect(second.get()).toEqual({ serverEnabled: false, clientEnabled: true });
  second.update({ clientEnabled: false });
  expect(first.get()).toEqual({ serverEnabled: false, clientEnabled: false });
});
