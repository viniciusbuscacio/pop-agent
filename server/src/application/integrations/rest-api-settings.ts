import { DEFAULT_ALLOWED_IPS, validateAllowedIps } from '../../domain/integrations/ip-allowlist.js';
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
    // Fresh installations require an explicit owner opt-in; saved switches are preserved.
    return { serverEnabled: saved?.serverEnabled ?? false, clientEnabled: saved?.clientEnabled ?? false };
  }
  allowedIps(): string[] { return this.repo.get<string[]>('rest-api.allowed-ips') ?? [...DEFAULT_ALLOWED_IPS]; }
  setAllowedIps(entries: string[]): string[] { const value = validateAllowedIps(entries); this.repo.set('rest-api.allowed-ips', value); return value; }
  update(patch: Partial<RestApiSettings>): RestApiSettings {
    const value = { ...this.get(), ...patch };
    this.repo.set('rest-api', value);
    return value;
  }
}
