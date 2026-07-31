import { sanitize, type RiskLevel } from '../../domain/safety/sanitize.js';
import type { ToolGuard } from './pi-engine.js';

/**
 * The per-turn taint (popy.spec §10), as the guard pi consults around each
 * tool call. A run that reads something suspicious becomes tainted; while
 * tainted, a destructive command has to be confirmed before it runs.
 *
 * "Destructive" is deliberately narrow: the yolo-mode agent runs bash freely,
 * and gating every command would train the user to click Allow blind. What is
 * gated is the handful of shapes that do lasting damage or exfiltrate.
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
  /** Asks the user; absent means no one is watching -- treat as denial. */
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

  async onToolCall(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<{ block: boolean; reason?: string }> {
    if (!this.tainted) return { block: false };

    const command = typeof input['command'] === 'string' ? input['command'] : '';
    if (tool !== 'bash' || !isDestructiveBash(command)) return { block: false };

    // Tainted turn, destructive command: the user decides. No confirm callback
    // means no human is watching this run -- deny rather than proceed silently.
    const allowed =
      this.deps.confirm !== undefined &&
      (await this.deps.confirm({
        action: 'run a destructive command',
        detail: command.slice(0, 500),
      }));

    return allowed
      ? { block: false }
      : {
          block: true,
          reason:
            'Blocked by Popy: this run read untrusted external content, and the ' +
            'user did not confirm this destructive command.',
        };
  }
}
