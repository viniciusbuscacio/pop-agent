import { expect, it } from 'vitest';
import { MemorySettings } from '../../testing/app-fixture.js';
import { RestApiSettingsService } from './rest-api-settings.js';
it('starts disabled and preserves explicit switches across service reconstruction', () => {
  const repo = new MemorySettings();
  const first = new RestApiSettingsService(repo);
  expect(first.get()).toEqual({ serverEnabled: false, clientEnabled: false });
  first.update({ serverEnabled: true });
  const second = new RestApiSettingsService(repo);
  expect(second.get()).toEqual({ serverEnabled: true, clientEnabled: false });
  second.update({ clientEnabled: true });
  expect(first.get()).toEqual({ serverEnabled: true, clientEnabled: true });
  second.update({ serverEnabled: false });
  expect(first.get()).toEqual({ serverEnabled: false, clientEnabled: true });
});
it('keeps previously saved enabled modules enabled', () => {
  const repo = new MemorySettings();
  repo.set('rest-api', { serverEnabled: true, clientEnabled: true });
  expect(new RestApiSettingsService(repo).get()).toEqual({ serverEnabled: true, clientEnabled: true });
});
