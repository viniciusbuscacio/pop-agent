/** Finite, keyed reads. Navigation has its own lane so a slow background read
 * cannot hold the screen hostage. No timers restart completed/failed work. */
export function createSyncQueue(deadlineMs = 16_000) {
  type Job = { key: string; foreground: boolean; run: (signal: AbortSignal) => Promise<void>; resolve: () => void; promise: Promise<void> };
  const waiting: Job[] = [];
  const jobs = new Map<string, Job>();
  const active = new Map<Job, AbortController>();
  const listeners = new Set<() => void>();
  let errors: string[] = [];
  let state = { busy: false, errors };
  let generation = 0;
  const publish = () => {
    state = { busy: jobs.size > 0, errors };
    for (const listener of listeners) listener();
  };
  const execute = (job: Job) => {
    const started = generation;
    const controller = new AbortController();
    let failed = false;
    active.set(job, controller);
    let timer: ReturnType<typeof setTimeout>;
    void Promise.race([
      Promise.resolve().then(() => job.run(controller.signal)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new Error('Synchronization timed out'));
      }, deadlineMs); }),
    ]).catch(() => {
      failed = true;
      if (generation === started) errors = [...new Set([...errors, job.key])];
    }).finally(() => {
      clearTimeout(timer);
      if (generation !== started) return;
      if (!failed) errors = errors.filter(key => key !== job.key);
      active.delete(job); jobs.delete(job.key); job.resolve();
      pump(); publish();
    });
  };
  const pump = () => {
    const index = active.size === 0 ? 0 : active.size < 2 ? waiting.findIndex(job => job.foreground) : -1;
    if (index < 0) return;
    const [job] = waiting.splice(index, 1);
    if (job) execute(job);
  };
  return {
    getState: () => state,
    generation: () => generation,
    clearErrors() { errors = []; publish(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    add(key: string, run: Job['run'], foreground = false): Promise<void> {
      const existing = jobs.get(key);
      if (existing) {
        if (foreground) this.promote(key);
        return existing.promise;
      }
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      const job = { key, foreground, run, resolve, promise };
      jobs.set(key, job);
      waiting.push(job);
      if (foreground) this.promote(key);
      pump(); publish();
      return promise;
    },
    promote(key: string) {
      const index = waiting.findIndex(job => job.key === key);
      if (index < 0) return;
      const [job] = waiting.splice(index, 1);
      if (!job) return;
      job.foreground = true;
      if (active.size < 2) execute(job);
      else waiting.unshift(job);
    },
    stop() {
      generation++;
      for (const controller of active.values()) controller.abort();
      for (const job of jobs.values()) job.resolve();
      active.clear(); waiting.length = 0; jobs.clear(); errors = []; publish();
    },
  };
}

export const syncQueue = createSyncQueue();
