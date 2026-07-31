import { sanitize, type RiskLevel } from '../../domain/safety/sanitize.js';
import type { ToolGuard } from './pi-engine.js';

/**
 * The per-turn taint (popy.spec §10), as the guard pi consults around each
 * tool call. A run that reads something suspicious becomes tainted -- and,
 * since YOLO mode (the owner's call, 31/07), that is all it does: nothing is
 * blocked and the user is never asked. The taint still reaches the server log,
 * so a destructive command that ran on untrusted input is greppable after the
 * fact; it just was not stopped before it.
 */

/** Commands that delete, escalate, or send data off the box. */
const DESTRUCTIVE = [
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, // rm -rf, rm -fr
  /\b(sudo|doas)\b/i,
  /\bmkfs|\bdd\s+if=|\b(shutdown|reboot|halt)\b/i,
  /\bchmod\s+-R|\bchown\s+-R/i,
  /\bcurl\b[^|]*\|\s*(ba)?sh|\bwget\b[^|]*\|\s*(ba)?sh/i, // pipe-to-shell
  /\b(scp|rsync|curl\s+-[a-z]*T|curl\s+--upload)\b/i, // sending files out
  /:\s*\(\s*\)\s*\{/, // fork bomb
  />\s*\/(?!home\/\w+\/popy-workspace|tmp)/, // redirect outside workspace/tmp
];

/** True when a bash command matches one of the destructive shapes above. */
export function isDestructiveBash(command: string): boolean {
  return DESTRUCTIVE.some((pattern) => pattern.test(command));
}

export interface TaintGuardDeps {
  /** Kept for the plumbing; unused under YOLO mode -- nothing asks. */
  confirm?: (request: { action: string; detail: string }) => Promise<boolean>;
  /** Told when a tool's output first tainted the run (for the server log). */
  onTaint?: (info: { risk: RiskLevel; warnings: string[] }) => void;
}

export class TaintGuard implements ToolGuard {
  private tainted = false;

  constructor(private readonly deps: TaintGuardDeps) {}

  onToolResult(text: string): void {
    if (this.tainted || text.length === 0) return;
    const verdict = sanitize(text);
    if (verdict.riskLevel !== 'low') {
      this.tainted = true;
      this.deps.onTaint?.({ risk: verdict.riskLevel, warnings: verdict.warnings });
    }
  }

  /**
   * YOLO mode (the owner's call, 31/07): nothing is ever blocked and nothing
   * is ever asked. The taint is still tracked, so a run that swallowed
   * untrusted content still says so in the log -- it just does not stop.
   */
  onToolCall(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<{ block: boolean; reason?: string }> {
    if (this.tainted && tool === 'bash') {
      const command = typeof input['command'] === 'string' ? input['command'] : '';
      if (isDestructiveBash(command)) {
        this.deps.onTaint?.({
          risk: 'high',
          warnings: [`yolo: ran a destructive command in a tainted turn: ${command.slice(0, 200)}`],
        });
      }
    }
    return Promise.resolve({ block: false });
  }
}
