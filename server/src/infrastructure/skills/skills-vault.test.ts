import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillsError } from '../../application/ports/skills-repo.js';
import { DEFAULT_SKILLS } from './default-skills.js';
import { SkillsVault, parse } from './skills-vault.js';

let root: string;
let vault: SkillsVault;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-skills-'));
  vault = new SkillsVault(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('SkillsVault', () => {
  it('seeds the default skills, including know-thyself', () => {
    const slugs = vault.all().map((skill) => skill.slug);
    expect(slugs).toContain('know-thyself');
    expect(vault.all().length).toBe(DEFAULT_SKILLS.length);
    expect(vault.get('know-thyself')?.builtin).toBe(true);
  });

  it('creates and reads back a user skill', () => {
    vault.write({
      slug: 'my-skill',
      name: 'My skill',
      description: 'does a thing',
      whenToUse: 'when the user asks for the thing',
      body: '# steps\n- one',
    });

    const skill = vault.get('my-skill');
    expect(skill?.name).toBe('My skill');
    expect(skill?.body).toBe('# steps\n- one');
    expect(skill?.builtin).toBe(false);
  });

  it('refuses to delete a built-in skill', () => {
    expect(() => vault.delete('know-thyself')).toThrow(SkillsError);
    expect(vault.get('know-thyself')).toBeDefined();
  });

  it('deletes a user skill', () => {
    vault.write({ slug: 'temp', name: 'Temp', description: '', whenToUse: '', body: 'x' });
    expect(vault.delete('temp')).toBe(true);
    expect(vault.get('temp')).toBeUndefined();
  });

  it('rejects a bad slug', () => {
    expect(() =>
      vault.write({ slug: 'Bad Slug!', name: 'x', description: '', whenToUse: '', body: 'y' }),
    ).toThrow(SkillsError);
  });

  it('keeps a user edit to a default skill across reboot', () => {
    vault.write({
      slug: 'summarize',
      name: 'My summarize',
      description: 'mine',
      whenToUse: 'mine',
      body: 'mine',
    });
    const reopened = new SkillsVault(root);
    expect(reopened.get('summarize')?.name).toBe('My summarize');
  });
});

describe('parse', () => {
  it('reads front matter and body', () => {
    const parsed = parse('---\nname: Test\ndescription: d\nwhenToUse: w\n---\n\n# body');
    expect(parsed).toMatchObject({ name: 'Test', description: 'd', whenToUse: 'w', body: '# body' });
  });
});
