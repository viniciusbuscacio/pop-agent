import { entityId } from '../../domain/ids.js';
import { IntegrationError } from '../../domain/integrations/integration.js';
export interface UiCommand { id: string; kind: 'state' | 'press' | 'dblclick' | 'key' | 'input' | 'scroll' | 'screenshot'; expiresAt: number; controlId?: string | undefined; testid?: string | undefined; index?: number | undefined; value?: string | undefined; key?: string | undefined; deltaX?: number | undefined; deltaY?: number | undefined }
interface Pending { guard: () => void; command: UiCommand; delivered: boolean; finish: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }
interface UiSession { id: string; key: string; name: string; lastSeen: number; pending?: Pending }
/** Ephemeral authenticated browser tabs; never persists screen contents. */
export class UiBridgeService {
  private sessions = new Map<string, UiSession>();
  private sweep(): void {
    for (const s of this.sessions.values()) if (Date.now() - s.lastSeen > 45_000) this.remove(s.id, s.key);
  }
  list(): { id: string; name: string; lastSeen: number }[] {
    this.sweep(); return [...this.sessions.values()].map(({ id, name, lastSeen }) => ({ id, name, lastSeen }));
  }
  register(name: string): { id: string; key: string } {
    this.sweep(); if (this.sessions.size >= 8) throw new IntegrationError(429, 'ui_session_limit');
    const id = entityId('ui'); const key = Array.from({ length: 4 }, () => entityId('key')).join('');
    this.sessions.set(id, { id, key, name, lastSeen: Date.now() }); return { id, key };
  }
  private get(id: string, key?: string): UiSession {
    this.sweep(); const s = this.sessions.get(id);
    if (!s || (key !== undefined && s.key !== key)) throw new IntegrationError(404, 'ui_not_connected');
    return s;
  }
  poll(id: string, key: string): UiCommand | null {
    const s = this.get(id, key); s.lastSeen = Date.now();
    if (!s.pending || s.pending.delivered) return null;
    try { s.pending.guard(); } catch { clearTimeout(s.pending.timer); s.pending.finish({ error: { code: 'ui_access_revoked', message: 'UI access was revoked before delivery.' } }); delete s.pending; return null; }
    s.pending.delivered = true; return s.pending.command;
  }
  acknowledge(id: string, key: string, commandId: string, reply: unknown): void {
    const s = this.get(id, key);
    if (s.pending?.command.id === commandId && s.pending.delivered) {
      clearTimeout(s.pending.timer); s.pending.finish(reply); delete s.pending;
    }
  }
  remove(id: string, key: string): void {
    const s = this.sessions.get(id); if (!s || s.key !== key) return;
    if (s.pending) { clearTimeout(s.pending.timer); s.pending.finish({ error: { code: 'ui_disconnected', message: 'The tab disconnected; action outcome may be unknown.' } }); }
    this.sessions.delete(id);
  }
  async dispatch(id: string, input: Omit<UiCommand, 'id' | 'expiresAt'>, guard: () => void = () => undefined): Promise<unknown> {
    const s = this.get(id); if (s.pending) throw new IntegrationError(409, 'ui_busy');
    const command: UiCommand = { ...input, id: entityId('command'), expiresAt: Date.now() + 8000 };
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.sessions.delete(s.id); delete s.pending; resolve({ error: { code: 'ui_timeout', message: 'The tab did not reply. Do not retry mutations blindly; inspect state first.' } }); }, 8000);
      s.pending = { command, delivered: false, timer, finish: resolve, guard };
    });
  }
}
