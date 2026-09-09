/** Only explicitly selected display data belongs in this disposable cache. */
const DB = 'pop-agent-settings-cache';
const LIMIT = 2 * 1024 * 1024;
let generation = 0;
type Schema = 'string' | 'number' | 'boolean' | readonly Schema[] | { [key: string]: Schema };
const windowSchema: Schema = { usedPercent: 'number', windowSeconds: 'number', resetAt: 'number' };
const schemas: Record<string, Schema> = {
  settings: { language: 'string', defaultProvider: 'string', defaultModel: 'string', customInstructions: 'string', voiceModel: 'string', voiceCleanup: 'boolean', voiceCleanupModel: 'string', autoSkillsEnabled: 'boolean', piUpdatePolicy: 'string' },
  memory: { doc: 'string', hasBackup: 'boolean' },
  providers: { providers: [{ id: 'string', name: 'string', authType: 'string', configured: 'boolean', defaultModel: 'string', serviceModel: 'string', allowCustomModel: 'boolean', 'baseURL?': 'string', 'custom?': 'boolean', order: 'number', enabled: 'boolean', 'authErrorAt?': 'string' }] },
  devices: { machines: [{ machineId: 'string', hostname: 'string', platform: 'string', arch: 'string', clientVersion: 'string', enabled: 'boolean' }] },
  about: { popAgentVersion: 'string', nodeVersion: 'string', piVersion: 'string' },
  storage: { totalBytes: 'number', entries: [{ key: 'string', bytes: 'number', 'count?': 'number' }], 'disk?': { freeBytes: 'number', totalBytes: 'number' } },
  'voice-models': { selected: 'string', models: [{ name: 'string', approxMb: 'number', installed: 'boolean' }] },
  backups: { backups: [{ name: 'string', size: 'number', createdAt: 'string', 'encrypted?': 'boolean', 'includeFiles?': 'boolean' }], 'passwordConfigured?': 'boolean', 'restoreAvailable?': 'boolean', 'fileSelectionAvailable?': 'boolean' },
  subscription: { plan: 'string', allowed: 'boolean', limitReached: 'boolean', primary: windowSchema, 'secondary?': windowSchema },
};
function project(value: unknown, schema: Schema): unknown {
  if (typeof schema === 'string') {
    if (typeof value !== schema || (schema === 'number' && !Number.isFinite(value))) throw new Error('Invalid snapshot');
    return value;
  }
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) throw new Error('Invalid snapshot');
    return value.map((item) => project(item, schema[0]!));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid snapshot');
  const result: Record<string, unknown> = {};
  for (const [field, type] of Object.entries(schema)) {
    const key = field.replace(/\?$/, '');
    const item = (value as Record<string, unknown>)[key];
    if (field.endsWith('?') && item === undefined) continue;
    result[key] = project(item, type as Schema);
  }
  return result;
}
/** Explicit projection excludes credentials, future fields and live operation/presence state. */
export function safeSettingsSnapshot(key: string, data: unknown): unknown {
  const schema = schemas[key.startsWith('subscription:') ? 'subscription' : key];
  if (!schema) return undefined;
  try { return project(data, schema); } catch { return undefined; }
}
export interface SettingsSnapshot { version: 1; savedAt: number; data: unknown }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const settingsCache = {
  async read(key: string): Promise<SettingsSnapshot | undefined> {
    const started = generation;
    let db: IDBDatabase | undefined;
    try {
      db = await database();
      return await new Promise((resolve) => {
        const request = db!.transaction('snapshots').objectStore('snapshots').get(key);
        request.onerror = () => resolve(undefined);
        request.onsuccess = () => {
          const value = request.result as SettingsSnapshot | undefined;
          const data = value ? safeSettingsSnapshot(key, value.data) : undefined;
          resolve(started === generation && value?.version === 1 && Number.isFinite(value.savedAt) && data !== undefined ? { ...value, data } : undefined);
        };
      });
    } catch { return undefined; }
    finally { db?.close(); }
  },
  async write(key: string, snapshot: SettingsSnapshot): Promise<void> {
    const data = safeSettingsSnapshot(key, snapshot.data);
    if (data === undefined) return;
    snapshot = { ...snapshot, data };
    const started = generation;
    let db: IDBDatabase | undefined;
    try {
      if (new TextEncoder().encode(JSON.stringify(snapshot)).length > LIMIT / 4) return;
      db = await database();
      if (started !== generation) return;
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      store.put(snapshot, key);
      // Bounded total size; evict the oldest snapshots, never user data on the server.
      const request = store.openCursor();
      const entries: { key: IDBValidKey; size: number; savedAt: number }[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const value = cursor.value as SettingsSnapshot;
          entries.push({ key: cursor.key, savedAt: value.savedAt, size: new TextEncoder().encode(JSON.stringify(value)).length });
          cursor.continue();
        } else {
          let size = entries.reduce((sum, entry) => sum + entry.size, 0);
          for (const entry of entries.sort((a, b) => a.savedAt - b.savedAt)) {
            if (size <= LIMIT) break;
            store.delete(entry.key);
            size -= entry.size;
          }
        }
      };
      await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve(); });
    } catch { /* Storage denial must not break online Settings. */ }
    finally { db?.close(); }
  },
  clear(): void {
    generation += 1;
    try { indexedDB.deleteDatabase(DB); } catch { /* Optional browser storage. */ }
  },
};
