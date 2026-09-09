/** Device-local, bounded diagnostics. Never persist raw exceptions or URLs. */
const KEY = 'pop-agent-update-log-v1';
const phases = ['registration', 'check', 'installed', 'activated', 'apply', 'reload'] as const;
const outcomes = ['start', 'ready', 'success', 'failed', 'timeout', 'discarded', 'unavailable', 'no-update'] as const;
type Phase = typeof phases[number];
type Outcome = typeof outcomes[number];
interface Entry { at: string; phase: Phase; outcome: Outcome; elapsedMs: number; worker: string; build: string; reason: string }
const states = ['none', 'installing', 'installed', 'activating', 'activated', 'redundant'];
const reasons = ['none', 'registration-not-ready', 'worker-discarded', 'timeout', 'SecurityError', 'NetworkError', 'InvalidStateError', 'TypeError', 'AbortError', 'unknown'];
let entries: Entry[] | undefined;
function read(): Entry[] {
  if (entries) return entries;
  entries = [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(stored)) for (const row of stored.slice(-100)) {
      if (!row || typeof row !== 'object') continue;
      const item = row as Entry;
      if (!phases.includes(item.phase) || !outcomes.includes(item.outcome) || !states.includes(item.worker) || !reasons.includes(item.reason)) continue;
      if (typeof item.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(item.at)) continue;
      if (typeof item.build !== 'string' || !/^(unknown|index-[\w-]+\.js)$/.test(item.build)) continue;
      if (!Number.isFinite(item.elapsedMs) || item.elapsedMs < 0) continue;
      entries.push({ at: item.at, phase: item.phase, outcome: item.outcome, elapsedMs: item.elapsedMs, worker: item.worker, build: item.build, reason: item.reason });
    }
  } catch { /* Storage denial cannot prevent updating. */ }
  return entries;
}
export function updateFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  if (error.message === 'Update registration is not ready') return 'registration-not-ready';
  if (error.message === 'Update worker was discarded') return 'worker-discarded';
  if (error.message === 'Update check timed out' || error.message === 'Update phase timed out') return 'timeout';
  return reasons.includes(error.name) ? error.name : 'unknown';
}
export function logUpdate(phase: Phase, outcome: Outcome, started = Date.now(), worker?: ServiceWorker | null, error?: unknown): void {
  const build = typeof document === 'undefined' ? 'unknown'
    : [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map(script => script.src.match(/\/(index-[\w-]+\.js)$/)?.[1]).find(Boolean) ?? 'unknown';
  const rows = read();
  rows.push({ at: new Date().toISOString(), phase, outcome, elapsedMs: Math.max(0, Date.now() - started), worker: worker?.state ?? 'none', build, reason: error === undefined ? 'none' : updateFailureReason(error) });
  entries = rows.slice(-100);
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* Keep the memory log. */ }
}
export function updateDiagnostics(): string {
  return JSON.stringify({ format: 'pop-agent-update-log-v1', entries: read() }, null, 2);
}
