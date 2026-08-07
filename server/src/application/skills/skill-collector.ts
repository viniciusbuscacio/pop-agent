import type { MaintenanceJob } from '../ports/maintenance-job.js';
import type { SkillUsageRepo } from '../ports/skill-usage-repo.js';
import type { SkillArchiveRepo, SkillsRepo } from '../ports/skills-repo.js';

/**
 * The archiving collector (popy.spec §8, auto-skill fase c). The distiller
 * writes; this is the only thing that takes away, and it does not delete.
 *
 * **A cap, not an expiry.** The rule is "at most N auto-skills", and when there
 * are more the least-earned ones are archived. The obvious alternative -- retire
 * anything unused for ninety days -- destroys exactly the skill that justifies
 * having a memory of procedures at all: the annual one. The tax routine written
 * last March is unused for eleven months and then is the most valuable thing in
 * the vault. A cap only ever fires when the vault is genuinely crowded, and it
 * fires on the worst entries rather than the oldest.
 *
 * **Least earned** is `use_count` first, `last_used_at` as the tie-break: a
 * skill routed twice a year is not the same as one never routed, and only the
 * pair tells them apart. A skill the router has never touched has no usage row
 * at all, which sorts to the front -- correctly, it has never earned anything.
 *
 * **Only `auto` skills.** A `user` skill is the user's, and an auto skill that
 * was edited became `user` by that act (§8): the promotion is what takes it out
 * of this job's reach forever. Built-ins are the app's. So the collector can
 * only ever retire something Popy itself wrote and the user never touched.
 *
 * **Pending skills are left alone.** One waiting for approval has had no chance
 * to be used, so by this job's own metric it always looks like the worst skill
 * in the vault. Archiving the queue the user has not read yet would be the
 * collector eating the distiller's output before anyone saw it.
 */

/** How many auto-skills may live in the router at once. */
export const AUTO_SKILL_CAP = 50;

/** Once an hour: the cap is a ceiling, not a deadline. */
const EVERY_MS = 60 * 60_000;

export interface SkillCollectorDeps {
  skills: SkillsRepo;
  archive: SkillArchiveRepo;
  usage?: SkillUsageRepo;
  /** Overridable so a test does not have to write fifty skills. */
  cap?: number;
  onJournal?: (line: string) => void;
}

export class SkillCollector implements MaintenanceJob {
  readonly name = 'skill-collector';
  readonly everyMs = EVERY_MS;

  constructor(private readonly deps: SkillCollectorDeps) {}

  run(): void {
    const cap = this.deps.cap ?? AUTO_SKILL_CAP;
    const managed = this.deps.skills
      .all()
      .filter((skill) => skill.source === 'auto' && skill.pending !== true);
    if (managed.length <= cap) return;

    const usage = new Map((this.deps.usage?.all() ?? []).map((entry) => [entry.slug, entry]));
    const ranked = [...managed].sort((left, right) => {
      const leftUse = usage.get(left.slug);
      const rightUse = usage.get(right.slug);
      const byCount = (leftUse?.useCount ?? 0) - (rightUse?.useCount ?? 0);
      if (byCount !== 0) return byCount;
      return (leftUse?.lastUsedAt ?? '').localeCompare(rightUse?.lastUsedAt ?? '');
    });

    const retired: string[] = [];
    for (const skill of ranked.slice(0, managed.length - cap)) {
      try {
        if (this.deps.archive.archive(skill.slug)) retired.push(skill.slug);
      } catch (error) {
        // Housekeeping never takes the scheduler with it, and one skill that
        // will not move is not a reason to leave the rest over the cap.
        this.deps.onJournal?.(
          `popy collector: ${skill.slug} could not be archived (${
            error instanceof Error ? error.message : 'unknown'
          })`,
        );
      }
    }

    if (retired.length > 0) {
      this.deps.onJournal?.(
        `popy collector: archived ${String(retired.length)} of ${String(managed.length)} auto-skills (cap ${String(cap)}): ${retired.join(' ')}`,
      );
    }
  }
}
