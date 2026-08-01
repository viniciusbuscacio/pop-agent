import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillsError } from '../../application/ports/skills-repo.js';
import { DEFAULT_SKILLS } from './default-skills.js';
import { SkillsVault, parse, seedHash } from './skills-vault.js';

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

  it('round-trips a pinned user skill', () => {
    vault.write({
      slug: 'my-identity',
      name: 'Mine',
      description: 'd',
      whenToUse: 'w',
      body: 'x',
      pinned: true,
    });
    expect(vault.get('my-identity')?.pinned).toBe(true);
  });

  it('pins know-thyself even when the seeded file predates the flag', () => {
    // A v0.2 install: the file exists with neither `pinned` nor `seed`.
    writeFileSync(
      join(root, 'know-thyself.md'),
      '---\nname: About Popy\ndescription: d\nwhenToUse: w\nbuiltin: true\n---\n\nold body\n',
    );
    const reopened = new SkillsVault(root);
    expect(reopened.get('know-thyself')?.pinned).toBe(true);
  });

  it('upgrades a default the user never touched when the shipped content changes', () => {
    const old = { name: 'Old', description: 'od', whenToUse: 'ow', body: 'old body' };
    writeFileSync(
      join(root, 'summarize.md'),
      [
        '---',
        `name: ${old.name}`,
        `description: ${old.description}`,
        `whenToUse: ${old.whenToUse}`,
        'builtin: true',
        `seed: ${seedHash(old)}`,
        '---',
        '',
        old.body,
        '',
      ].join('\n'),
    );
    const reopened = new SkillsVault(root);
    expect(reopened.get('summarize')?.name).toBe('Summarize');
  });

  it('stamps a pre-seed-era file that still matches the shipped default', () => {
    // v0.2 wrote defaults with no seed marker; strip it to simulate that.
    const path = join(root, 'summarize.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^seed: .*\n/m, ''));
    expect(parse(readFileSync(path, 'utf8')).seed).toBeUndefined();

    new SkillsVault(root);
    expect(parse(readFileSync(path, 'utf8')).seed).toBeDefined();
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


  describe('Agent Skills folders (popy.spec §8)', () => {
    it('discovers a directory holding SKILL.md, recursively', () => {
      mkdirSync(join(root, 'pack', 'deep-skill'), { recursive: true });
      writeFileSync(
        join(root, 'pack', 'deep-skill', 'SKILL.md'),
        '---\nname: deep-skill\ndescription: Found two levels down. Use when nesting.\n---\n\n# Deep\nBody here.\n',
      );

      const skill = vault.get('deep-skill');
      expect(skill?.slug).toBe('deep-skill');
      expect(skill?.whenToUse).toContain('Found two levels down'); // description is the routing fallback
      expect(skill?.body).toBe('# Deep\nBody here.');
      expect(skill?.builtin).toBe(false);
      expect(vault.all().map((entry) => entry.slug)).toContain('deep-skill');
    });

    it('does not descend into a skill directory (its folders are assets)', () => {
      mkdirSync(join(root, 'outer', 'assets'), { recursive: true });
      writeFileSync(join(root, 'outer', 'SKILL.md'), '---\ndescription: Outer.\n---\nOuter body.');
      writeFileSync(join(root, 'outer', 'assets', 'SKILL.md'), '---\ndescription: Inner.\n---\nInner body.');

      const slugs = vault.all().map((entry) => entry.slug);
      expect(slugs).toContain('outer');
      expect(slugs).not.toContain('assets');
    });

    it('skips a folder skill without a description (the standard refuses it)', () => {
      mkdirSync(join(root, 'nodesc'));
      writeFileSync(join(root, 'nodesc', 'SKILL.md'), '---\nname: nodesc\n---\nBody.');
      expect(vault.get('nodesc')).toBeUndefined();
    });

    it('lets a flat .md win on a slug collision', () => {
      vault.write({
        slug: 'clash',
        name: 'Flat',
        description: 'flat wins',
        whenToUse: 'flat',
        body: 'flat body',
      });
      mkdirSync(join(root, 'clash'));
      writeFileSync(join(root, 'clash', 'SKILL.md'), '---\ndescription: folder loses.\n---\nFolder body.');
      expect(vault.get('clash')?.body).toBe('flat body');
    });

    it('deletes a folder skill by removing its directory', () => {
      mkdirSync(join(root, 'doomed', 'scripts'), { recursive: true });
      writeFileSync(join(root, 'doomed', 'SKILL.md'), '---\ndescription: Bye.\n---\nBody.');
      writeFileSync(join(root, 'doomed', 'scripts', 'x.sh'), 'echo x');
      expect(vault.delete('doomed')).toBe(true);
      expect(vault.get('doomed')).toBeUndefined();
      expect(existsSync(join(root, 'doomed'))).toBe(false);
    });
  });

describe('parse', () => {
  it('reads front matter and body', () => {
    const parsed = parse('---\nname: Test\ndescription: d\nwhenToUse: w\n---\n\n# body');
    expect(parsed).toMatchObject({ name: 'Test', description: 'd', whenToUse: 'w', body: '# body' });
  });
});
