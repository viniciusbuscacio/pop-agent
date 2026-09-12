import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AutoSkillPublication,
  AutoSkillPublicationRepo,
} from '../../application/ports/auto-skill-publication-repo.js';
import { SkillsVault } from './skills-vault.js';

class MemoryJournal implements AutoSkillPublicationRepo {
  rows: AutoSkillPublication[] = [];
  prepare(operation: AutoSkillPublication): void { this.rows.push(operation); }
  commit(id: string, at: string): void {
    this.rows = this.rows.map((row) => row.id === id ? { ...row, state: 'committed', committedAt: at } : row);
  }
  delete(id: string): void { this.rows = this.rows.filter((row) => row.id !== id); }
  open(): AutoSkillPublication[] { return this.rows.map((row) => ({ ...row })); }
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'pop-reviewed-skills-'));
  roots.push(path);
  return path;
}

describe('recoverable reviewed Auto-Skill publication', () => {
  it('keeps a prepared file invisible until the journal commits', () => {
    const journal = new MemoryJournal();
    const vault = new SkillsVault(root(), journal);
    const staged = vault.publishReviewed({
      slug: 'safe-procedure',
      name: 'Safe procedure',
      description: 'Perform a safe procedure',
      whenToUse: 'When the safe procedure is needed',
      body: 'Check inputs, then perform the operation.',
      source: 'auto',
    }, { reviewHash: 'sha256:reviewed', action: 'new', at: '2026-08-12T00:00:00.000Z' });

    expect(vault.get('safe-procedure')).toBeUndefined();
    expect(vault.all().map((skill) => skill.slug)).not.toContain('safe-procedure');
    vault.commitReviewed(staged.operationId, '2026-08-12T00:00:01.000Z');
    expect(vault.get('safe-procedure')?.source).toBe('auto');
    expect(journal.rows).toEqual([]);
  });

  it('restores the durable previous version after a crash before commit', () => {
    const path = root();
    const journal = new MemoryJournal();
    const initial = new SkillsVault(path, journal);
    initial.write({
      slug: 'learned', name: 'Learned', description: 'Old description', whenToUse: 'Old use',
      body: 'Old body.', source: 'auto',
    });
    initial.publishReviewed({
      slug: 'learned', name: 'Learned better', description: 'New description', whenToUse: 'New use',
      body: 'New body.', source: 'auto',
    }, { reviewHash: 'sha256:reviewed', action: 'revision', at: '2026-08-12T00:00:00.000Z' });

    const recovered = new SkillsVault(path, journal);
    expect(recovered.get('learned')?.body).toBe('Old body.');
    expect(journal.rows).toEqual([]);
  });
});
