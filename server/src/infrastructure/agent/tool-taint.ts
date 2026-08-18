import { sanitize, type RiskLevel } from '../../domain/safety/sanitize.js';
import type { ToolGuard } from './pi-engine.js';

/**
 * The per-turn taint (docs/specs/Spec-Pop-General.md §10). A run that reads something suspicious
 * from the outside world becomes tainted. YOLO mode (the owner's call, 31/07)
 * removed the confirmation card, but "no dialog" is not "no brake": in a
 * tainted turn a small set of genuinely dangerous commands -- ones that send
 * data off the box, read a secret, or destroy something irreversibly -- are
 * refused automatically, and the model is told why so it can carry on without
 * them. A clean turn is never in anyone's way, so ordinary YOLO is untouched.
 *
 * This is the deterministic floor against indirect prompt injection (a web
 * page telling Pop Agent to leak `secret.key` or wipe a directory): the human is
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
  // Clobbering a system path. Anchored so it only fires on a real output
  // redirect ("> /etc/x", "1> /usr/x") into a known system dir -- not on the
  // harmless `2>/dev/null`, `2>&1`, or a JS arrow-plus-regex like `n=>/re/`.
  /(^|\s)\d?>>?\s*\/(etc|usr|s?bin|boot|lib(64)?|sys|proc|var|root|opt)\b/i,
];

/**
 * Commands that send data off the box or read one of Pop Agent's secrets. This is
 * the exfiltration surface, kept apart from DESTRUCTIVE because it is the half
 * an injected web page reaches for first (labs 1, 6, 7 of the Microsoft
 * AI-Red-Teaming playground: "make the model reveal passwords.txt").
 */
/**
 * The verbs that read a file out. Shared: how you read a secret does not
 * depend on whose machine it is.
 */
const READERS =
  '(cat|less|more|head|tail|xxd|od|strings|hexdump|base64|nl|tac|cp|mv|grep|awk|sed|dd|scp|rsync)';

/**
 * The files worth protecting, per machine (docs/cli.md, "Guarding two
 * machines").
 *
 * The list used to be one, written for the server. Pointed at a laptop it was
 * a lock on the right door of the wrong house: `secret.key` and
 * `pi-auth.json` are not there, while everything a work machine actually
 * keeps -- cloud credentials, a GitHub token, the keychain -- was absent
 * (Vinicius, 04/08). The rule does not change; the list travels with the
 * machine.
 */
const SECRETS: Record<GuardedMachine, string> = {
  server: '(secret\\.key|pi-auth\\.json|\\.env\\b|id_rsa\\b|id_ed25519\\b|authorized_keys\\b|\\.ssh\\/)',
  local:
    '(id_rsa\\b|id_ed25519\\b|authorized_keys\\b|\\.ssh\\/|\\.aws\\/|\\.config\\/gh\\/|\\.npmrc\\b|\\.git-credentials\\b|\\.kube\\/|\\.netrc\\b|Library\\/Keychains|\\.docker\\/config\\.json)',
};

/** Which machine a command is bound for; the tool name decides. */
export type GuardedMachine = 'server' | 'local';

const EXFIL_OR_SECRET = [
  // curl/wget uploading a local file (POST body, form, or --upload).
  /\bcurl\b[^|&;]*(-T\b|--upload-file\b|(-d|--data|--data-binary|--data-raw|--data-urlencode)\s+@|(-F|--form)\s+\S*@)/i,
  /\bwget\b[^|&;]*--post-file\b/i,
  // scp/rsync out, or any pipe into a network client.
  /\b(scp|rsync)\b/i,
  /\|\s*(curl|wget|nc|ncat|netcat)\b/i,
  /\b(nc|ncat|netcat)\b\s+\S/i, // netcat with an argument (a host/port)
];

/** Reading, copying or encoding one of THAT machine's secrets. */
function readsSecretOf(machine: GuardedMachine): RegExp {
  return new RegExp(`\\b${READERS}\\b[^|]*${SECRETS[machine]}`, 'i');
}

/** True when a bash command matches one of the destructive shapes above. */
export function isDestructiveBash(command: string): boolean {
  return DESTRUCTIVE.some((pattern) => pattern.test(command));
}

/** True when a bash command would send data out or read that machine's secrets. */
export function isExfilOrSecretRead(command: string, machine: GuardedMachine = 'server'): boolean {
  if (EXFIL_OR_SECRET.some((pattern) => pattern.test(command))) return true;
  return readsSecretOf(machine).test(command);
}

/**
 * The commands a tainted turn refuses to run. Destruction and exfiltration are
 * refused on BOTH machines: the attacker in this model is a page the agent
 * read, and that page is no more welcome to run `sudo` on the laptop.
 */
export function isBlockedUnderTaint(command: string, machine: GuardedMachine = 'server'): boolean {
  return isDestructiveBash(command) || isExfilOrSecretRead(command, machine);
}

/**
 * Tools a tainted turn refuses outright, whatever their arguments. Writing a
 * skill creates standing future context; mutating A2A calls send data or
 * commands to another agent. Nothing in their arguments can make those actions
 * safe after prompt-injection content was consumed, so tool identity decides.
 */
const REFUSED_UNDER_TAINT = new Set([
  'skill_write',
  'a2a_send_message',
  'a2a_continue_task',
  'a2a_cancel_task',
]);

/** Which machine a tool runs on. Local tools carry the prefix; nothing else. */
export function machineOfTool(tool: string): GuardedMachine | undefined {
  if (tool === 'bash') return 'server';
  if (tool === 'local_bash') return 'local';
  return undefined;
}

export interface TaintGuardDeps {
  /** Kept for the plumbing; unused under YOLO mode -- nothing asks. */
  confirm?: (request: { action: string; detail: string }) => Promise<boolean>;
  /** Told when a tool's output first tainted the run (for the server log). */
  onTaint?: (info: { risk: RiskLevel; warnings: string[] }) => void;
}

const BLOCK_REASON =
  'This turn read untrusted external content, so this command is blocked as a ' +
  'prompt-injection safeguard (docs/specs/Spec-Pop-General.md §10): a tainted turn cannot send data ' +
  'off the box, read a secret, or destroy files. If the user asked for this ' +
  'themselves, run it in a new turn that has not read outside content.';

const SKILL_BLOCK_REASON =
  'This turn read untrusted external content, so writing a skill is blocked as a ' +
  'prompt-injection safeguard (docs/specs/Spec-Pop-General.md §8, §10): a skill written now would come ' +
  'back on its own in future conversations. If the user asked for this themselves, ' +
  'write it in a new turn that has not read outside content.';

const A2A_BLOCK_REASON =
  'This turn read untrusted external content, so mutating a remote A2A task is blocked as a ' +
  'prompt-injection safeguard (docs/specs/Spec-Pop-A2A.md): a tainted turn cannot send data or ' +
  'commands to another agent. If the user asked for this themselves, run it in a new turn that ' +
  'has not read outside content.';

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
   * YOLO mode without the dialog (docs/specs/Spec-Pop-General.md §10): a clean turn runs anything,
   * a tainted turn refuses the exfil/secret/destruction set and says so. The
   * refusal is logged either way, so the trail survives.
   */
  onToolCall(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<{ block: boolean; reason?: string }> {
    if (!this.tainted) return Promise.resolve({ block: false });

    if (REFUSED_UNDER_TAINT.has(tool)) {
      this.deps.onTaint?.({
        risk: 'high',
        warnings: [`blocked ${tool} in a tainted turn`],
      });
      return Promise.resolve({
        block: true,
        reason: tool === 'skill_write' ? SKILL_BLOCK_REASON : A2A_BLOCK_REASON,
      });
    }

    const machine = machineOfTool(tool);
    if (machine === undefined) return Promise.resolve({ block: false });

    const command = typeof input['command'] === 'string' ? input['command'] : '';
    if (!isBlockedUnderTaint(command, machine)) return Promise.resolve({ block: false });

    this.deps.onTaint?.({
      risk: 'high',
      warnings: [`blocked a dangerous command in a tainted turn: ${command.slice(0, 200)}`],
    });
    return Promise.resolve({ block: true, reason: BLOCK_REASON });
  }
}
