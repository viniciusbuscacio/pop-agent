/** One storage operation at a time, retaining only the latest waiting snapshot
 * per key. Callers sharing a pending key also share its completion promise. */
export function createCoalescedWriter() {
  const pending = new Map<string, { write: () => Promise<void>; promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void }>();
  let running = false;
  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (pending.size) {
        const [key, entry] = pending.entries().next().value!;
        pending.delete(key);
        try { await entry.write(); entry.resolve(); } catch (error) { entry.reject(error); }
      }
    } finally { running = false; }
  }
  return {
    add(key: string, write: () => Promise<void>): Promise<void> {
      const existing = pending.get(key);
      if (existing) { existing.write = write; return existing.promise; }
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
      pending.set(key, { write, promise, resolve, reject });
      // Same-turn event bursts collapse before any serialization or DB open.
      queueMicrotask(() => { void drain(); });
      return promise;
    },
    clear(): void {
      for (const entry of pending.values()) entry.resolve();
      pending.clear();
    },
  };
}
