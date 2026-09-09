import { settingsCache } from './settings-cache';

export interface ResourceState {
  data?: unknown;
  savedAt?: number;
  received?: number;
  loading: boolean;
  fresh: boolean;
  error: boolean;
}
interface Entry { state: ResourceState; listeners: Set<() => void>; revision: number; pending?: Promise<void> | undefined }
const entries = new Map<string, Entry>();
let generation = 0;
function entry(key: string): Entry {
  let result = entries.get(key);
  if (!result) { result = { state: { loading: false, fresh: false, error: false }, listeners: new Set(), revision: 0 }; entries.set(key, result); }
  return result;
}
function publish(item: Entry, state: ResourceState): void {
  item.state = state;
  for (const listener of item.listeners) listener();
}

export const settingsResources = {
  state(key: string): ResourceState { return entry(key).state; },
  subscribe(key: string, listener: () => void): () => void {
    const item = entry(key); item.listeners.add(listener);
    return () => { item.listeners.delete(listener); };
  },
  accept(key: string, data: unknown): void {
    const item = entry(key);
    item.revision += 1;
    item.pending = undefined;
    const savedAt = Date.now();
    publish(item, { data, savedAt, received: item.revision, loading: false, fresh: true, error: false });
    void settingsCache.write(key, { version: 1, savedAt, data });
  },
  load(key: string, loader: () => Promise<unknown>, force = false): Promise<void> {
    const item = entry(key);
    if (item.pending && !force) return item.pending;
    const revision = ++item.revision;
    const started = generation;
    const current = () => generation === started && item.revision === revision;
    publish(item, { ...item.state, loading: true });
    void settingsCache.read(key).then((cached) => {
      if (cached && current() && item.state.data === undefined) {
        publish(item, { ...item.state, data: cached.data, savedAt: cached.savedAt });
      }
    });
    item.pending = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const data = await Promise.race([
          Promise.resolve().then(loader),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Settings request timed out')), 15_000); }),
        ]);
        if (current()) this.accept(key, data);
      } catch {
        if (current()) publish(item, { ...item.state, loading: false, fresh: false, error: true });
      } finally {
        clearTimeout(timer);
        if (current()) item.pending = undefined;
      }
    })();
    return item.pending;
  },
  clear(): void {
    generation += 1;
    for (const item of entries.values()) {
      item.revision += 1; item.pending = undefined;
      publish(item, { loading: false, fresh: false, error: false });
    }
    settingsCache.clear();
  },
};
