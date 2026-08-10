import type { SkillCandidate } from './distillation.js';

/** How independently the background skill distiller may act. */
export type AutoSkillMode = 'disabled' | 'medium' | 'full';

export interface AutoSkillApprovalContext {
  candidate: SkillCandidate;
  /** True when a tool brought any source material into the conversation window. */
  hasExternalContent: boolean;
  /** Replacing an existing auto-skill deserves more care than adding a new one. */
  revision: boolean;
}

/**
 * The baseline safety barrier is deliberately outside this policy: taint refusal,
 * secret scrubbing, candidate validation and the ban on rewriting user/builtin
 * skills apply in every enabled mode. This function decides only whether a
 * candidate that cleared that barrier may skip the approval inbox.
 */
export function autoApproveSkill(mode: AutoSkillMode, context: AutoSkillApprovalContext): boolean {
  if (mode === 'disabled') return false;
  if (mode === 'full') return true;

  // Medium is provenance-first. A detector cannot prove that arbitrary material
  // from a page, repository, File or MCP is harmless, even when it contains no
  // recognizable injection phrase. Keep those candidates reviewable.
  if (context.hasExternalContent || context.revision) return false;

  return !hasOperationalImpact(context.candidate);
}

/**
 * A deliberately conservative deterministic screen for medium mode. False
 * positives wait for approval; false negatives would become persistent prompt
 * text. Full mode remains available to an owner who wants every baseline-safe
 * candidate activated automatically.
 */
export function hasOperationalImpact(candidate: SkillCandidate): boolean {
  const text = [
    candidate.name,
    candidate.description,
    candidate.whenToUse,
    candidate.body,
  ].join('\n').toLowerCase();

  return OPERATIONAL_PATTERNS.some((pattern) => pattern.test(text));
}

const OPERATIONAL_PATTERNS: readonly RegExp[] = [
  /```|`[^`]+`/,
  /(?:^|\s)(?:sudo|su|rm|mv|cp|chmod|chown|curl|wget|ssh|scp|rsync|systemctl|docker|kubectl|npm|pnpm|yarn|git|sql)(?:\s|$)/m,
  /(?:password|passphrase|credential|secret|token|api[ -]?key|private[ -]?key|certificate|oauth|authentication|authorization)/,
  /(?:delete|remove|erase|purge|drop|truncate|overwrite|format|factory reset|rollback|restart|reboot|deploy|publish|upload|download|install|uninstall|execute|run command)/,
  /(?:database|server|firewall|router|network|endpoint|webhook|http request|shell|terminal|filesystem|environment variable|\.env)/,
  /(?:pop agent|self-change|source code|settings|security|permission|provider|mcp)/,
  /(?:https?:\/\/|\b[a-z][a-z0-9+.-]*:\/\/)/,
  /(?:\/etc\/|\/var\/|~\/|\.ssh\/|\.git\/)/,
];
