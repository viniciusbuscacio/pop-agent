import type { SettingsRepo } from '../ports/settings-repo.js';
export interface RestApiSettings {
  serverEnabled: boolean;
  clientEnabled: boolean;
}
/** Module switches preserve credentials and individual client states. */
export class RestApiSettingsService {
  constructor(private readonly repo: SettingsRepo) {}
  get(): RestApiSettings {
    const saved = this.repo.get<Partial<RestApiSettings>>('rest-api');
    // Preserve existing installations' behavior when no switch has been saved.
    return { serverEnabled: saved?.serverEnabled ?? true, clientEnabled: saved?.clientEnabled ?? true };
  }
  update(patch: Partial<RestApiSettings>): RestApiSettings {
    const value = { ...this.get(), ...patch };
    this.repo.set('rest-api', value);
    return value;
  }
}
