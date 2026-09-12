import { fstatSync, writeSync } from 'node:fs';

/** Structured events only. Never accept raw errors, command arguments or output. */
export function installEvent(event: string, fields: Record<string, string | number> = {}): void {
  if (process.env['POP_AGENT_INSTALL_LOG_ACTIVE'] !== '1') return;
  if (!/^[a-z][a-z0-9-]*$/.test(event)) return;
  const safeFields = Object.entries(fields).filter(([key, value]) =>
    /^[a-z][a-z0-9_]*$/.test(key) && /^[A-Za-z0-9._-]{1,128}$/.test(String(value)),
  );
  try {
    const file = fstatSync(3);
    if (!file.isFile() || file.uid !== process.getuid?.() || (file.mode & 0o077) !== 0) return;
    writeSync(3, `${new Date().toISOString()} event=${event}${safeFields.map(([key, value]) => ` ${key}=${value}`).join('')}\n`);
  } catch {
    // A diagnostic write must not replace the installer's actual result.
  }
}
