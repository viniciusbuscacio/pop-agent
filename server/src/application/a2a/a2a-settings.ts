import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { allowsIp, DEFAULT_ALLOWED_IPS, validateAllowedIps } from '../../domain/integrations/ip-allowlist.js';
import { IntegrationError } from '../../domain/integrations/integration.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';

export interface A2aSettings {
  serverEnabled: boolean;
  clientEnabled: boolean;
}
export class A2aSettingsService {
  private window = { start: 0, count: 0 };
  constructor(private readonly repo: SettingsRepo, private readonly secrets: SecretsRepo,
    private readonly legacyClientEnabled: () => boolean = () => false) {}
  get(): A2aSettings {
    const saved = this.repo.get<Partial<A2aSettings>>('a2a.settings');
    return { serverEnabled: saved?.serverEnabled ?? false, clientEnabled: saved?.clientEnabled ?? this.legacyClientEnabled() };
  }
  configure(patch: Partial<A2aSettings>): A2aSettings {
    const next = { ...this.get(), ...patch };
    if (next.serverEnabled) this.ensureKey();
    this.repo.set('a2a.settings', next);
    return next;
  }
  key(): string | undefined { return this.secrets.get('a2a.server-key'); }
  ensureKey(): string { return this.key() ?? this.rotateKey(); }
  rotateKey(): string {
    const key = 'popa_' + randomBytes(32).toString('base64url');
    this.secrets.set('a2a.server-key', key);
    return key;
  }
  allowedIps(): string[] { return this.repo.get<string[]>('a2a.allowed-ips') ?? [...DEFAULT_ALLOWED_IPS]; }
  setAllowedIps(entries: string[]): string[] {
    const value = validateAllowedIps(entries);
    this.repo.set('a2a.allowed-ips', value); return value;
  }
  outboundIps(): string[] { return this.repo.get<string[]>('a2a.outbound-ips') ?? []; }
  setOutboundIps(entries: string[]): string[] {
    const value = entries.length === 0 ? [] : validateAllowedIps(entries);
    this.repo.set('a2a.outbound-ips', value); return value;
  }
  authorize(secret: string, address: string | undefined): void {
    if (!this.get().serverEnabled) throw new IntegrationError(503, 'a2a_server_disabled');
    if (!allowsIp(this.allowedIps(), address)) throw new IntegrationError(403, 'ip_not_allowed');
    const current = this.key();
    const hash = (value: string): Buffer => createHash('sha256').update(value).digest();
    if (!current || secret.length > 128 || !timingSafeEqual(hash(current), hash(secret)))
      throw new IntegrationError(401, 'invalid_a2a_key');
  }
  admit(secret: string, address: string | undefined): void {
    this.authorize(secret, address);
    const now = Date.now();
    if (now - this.window.start >= 60_000) this.window = { start: now, count: 0 };
    if (++this.window.count > 120) throw new IntegrationError(429, 'rate_limited');
  }
}
