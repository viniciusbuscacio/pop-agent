import { sanitize, type RiskLevel } from '../../domain/safety/sanitize.js';
import type { ToolGuard } from './pi-engine.js';

/**
 * The per-turn taint (popy.spec §10). A run that reads something suspicious
 * from the outside world becomes tainted. YOLO mode (the owner's call, 31/07)
 * removed the confirmation card, but "no dialog" is not "no brake": in a
 * tainted turn a small set of genuinely dangerous commands -- ones that send
 * data off the box, read a secret, or destroy something irreversibly -- are
 * refused automatically, and the model is told why so it can carry on without
 * them. A clean turn is never in anyone's way, so ordinary YOLO is untouched.
 *
 * This is the deterministic floor against indirect prompt injection (a web
 * page telling Popy to leak `secret.key` or wipe a directory): the human is
 * never asked, but the page cannot make the leak happen either.
 */

/** Commands that delete, escalate, or destroy irreversibly. */
const DESTRUCTIVE = [
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, // rm -rf, rm -fr
  /\b(sudo|doas)\b/i,
  /\bmkfs|\bdd\s+if=|\b(shutdown|reboot|halt)\b/i,
  /\bchmod\s+-R|\bchown\s+-R/i,
  /\bcurl\b[^|]*\|\s*(ba)?sh|\bwget\b[^|]*\|\s*(ba)?sh/i, // pipe-to-shell
  /:\s*\(\s*\)\s*\{/, // fork bomb
  />\s*\/(?!home\/\w+\/popy-workspace|tmp)/, // redirect outside workspace/tmp
];

/**
 * Commands that send data off the box or read one of Popy's secrets. This is
 * the exfiltration surface, kept apart from DESTRUCTIVE because it is the half
 * an injected web page reaches for first (labs 1, 6, 7 of the Microsoft
 * AI-Red-Teaming playground: "make the model reveal passwords.txt").
 */
const EXFIL_OR_SECRET = [
  // curl/wget uploading a local file (POST body, form, or --upload).
  /\bcurl\b[^|&;]*(-T\b|--upload-file\b|(-d|--data|--data-binary|--data-raw|--data-urlencode)\s+@|(-F|--form)\s+\S*@)/i,
  /\bwget\b[^|&;]*--post-file\b/i,
  // scp/rsync out, or any pipe into a network client.
  /\b(scp|rsync)\b/i,
  /\|\s*(curl|wget|nc|ncat|netcat)\b/i,
  /\b(nc|ncat|netcat)\b\s+\S/i, // netcat with an argument (a host/port)
  // Reading, copying, or encoding one of the named secrets.
  /\b(cat|less|more|head|tail|xxd|od|strings|hexdump|base64|nl|tac|cp|mv|grep|awk|sed|dd|scp|rsync)\b[^|]*(secret\.key|pi-auth\.json|\.env\b|id_rsa\b|id_ed25519\b|authorized_keys\b|\.ssh\/)/i,
];

/** True when a bash command matches one of the destructive shapes above. */
export function isDestructiveBash(command: string): boolean {
  return DESTRUCTIVE.some((pattern) => pattern.test(command));
}

/** True when a bash command would send data out or read a secret. */
export function isExfilOrSecretRead(command: string): boolean {
  return EXFIL_OR_SECRET.some((pattern) => pattern.test(command));
}

/** The commands a tainted turn refuses to run. */
export function isBlockedUnderTaint(command: string): boolean {
  return isDestructiveBash(command) || isExfilOrSecretRead(command);
}

export interface TaintGuardDeps {
  /** Kept for the plumbing; unused under YOLO mode -- nothing asks. */
  confirm?: (request: { action: string; detail: string }) => Promise<boolean>;
  /** Told when a tool's output first tainted the run (for the server log). */
  onTaint?: (info: { risk: RiskLevel; warnings: string[] }) => void;
}

const BLOCK_REASON =
  'This turn read untrusted external content, so this command is blocked as a ' +
  'prompt-injection safeguard (popy.spec §10): a tainted turn cannot send data ' +
  'off the box, read a secret, or destroy files. If the user asked for this ' +
  'themselves, run it in a new turn that has not read outside content.';

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
   * YOLO mode without the dialog (popy.spec §10): a clean turn runs anything,
   * a tainted turn refuses the exfil/secret/destruction set and says so. The
   * refusal is logged either way, so the trail survives.
   */
  onToolCall(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<{ block: boolean; reason?: string }> {
    if (!this.tainted || tool !== 'bash') return Promise.resolve({ block: false });

    const command = typeof input['command'] === 'string' ? input['command'] : '';
    if (!isBlockedUnderTaint(command)) return Promise.resolve({ block: false });

    this.deps.onTaint?.({
      risk: 'high',
      warnings: [`blocked a dangerous command in a tainted turn: ${command.slice(0, 200)}`],
    });
    return Promise.resolve({ block: true, reason: BLOCK_REASON });
  }
}
