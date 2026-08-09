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
  root = mkdtempSync(join(tmpdir(), 'pop-skills-'));
  vault = new SkillsVault(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('SkillsVault', () => {
  it('seeds the default skills, including pop-agent-manual', () => {
    const slugs = vault.all().map((skill) => skill.slug);
    expect(slugs).toContain('pop-agent-manual');
    expect(vault.all().length).toBe(DEFAULT_SKILLS.length);
    expect(vault.get('pop-agent-manual')?.source).toBe('builtin');
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
    expect(skill?.source).toBe('user');
  });

  it('refuses to delete a built-in skill', () => {
    expect(() => vault.delete('pop-agent-manual')).toThrow(SkillsError);
    expect(vault.get('pop-agent-manual')).toBeDefined();
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

  it('pins pop-agent-manual even when the seeded file predates the flag', () => {
    // A v0.2 install: the file exists with neither `pinned` nor `seed`.
    writeFileSync(
      join(root, 'pop-agent-manual.md'),
      '---\nname: About Pop Agent\ndescription: d\nwhenToUse: w\nbuiltin: true\n---\n\nold body\n',
    );
    const reopened = new SkillsVault(root);
    expect(reopened.get('pop-agent-manual')?.pinned).toBe(true);
    expect(reopened.get('pop-agent-manual')?.source).toBe('builtin'); // `builtin: true` still reads
  });

  it('upgrades a default the user never touched when the shipped content changes', () => {
    const old = { name: 'Old', description: 'od', whenToUse: 'ow', body: 'old body' };
    writeFileSync(
      join(root, 'note-taking.md'),
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
    expect(reopened.get('note-taking')?.name).toBe('Note taking');
  });

  it('stamps a pre-seed-era file that still matches the shipped default', () => {
    // v0.2 wrote defaults with no seed marker; strip it to simulate that.
    const path = join(root, 'note-taking.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^seed: .*\n/m, ''));
    expect(parse(readFileSync(path, 'utf8')).seed).toBeUndefined();

    new SkillsVault(root);
    expect(parse(readFileSync(path, 'utf8')).seed).toBeDefined();
  });

  it('accepts a pending skill without promoting it out of the collector reach', () => {
    vault.write({
      slug: 'learned',
      name: 'Learned',
      description: 'd',
      whenToUse: 'w',
      body: 'b',
      source: 'auto',
      pending: true,
    });
    expect(vault.get('learned')?.pending).toBe(true);

    const approved = vault.approve('learned');
    // Saying yes is not editing: it stays `auto`, so the collector still owns it.
    expect(approved?.pending).toBeUndefined();
    expect(approved?.source).toBe('auto');
    expect(new SkillsVault(root).get('learned')?.pending).toBeUndefined();
  });

  it('promotes an auto skill to user when the user actually edits it', () => {
    vault.write({
      slug: 'learned',
      name: 'Learned',
      description: 'd',
      whenToUse: 'w',
      body: 'b',
      source: 'auto',
    });
    vault.write({ slug: 'learned', name: 'Mine now', description: 'd', whenToUse: 'w', body: 'b2' });
    expect(vault.get('learned')?.source).toBe('user');
  });

  it('leaves a skill that was never pending alone', () => {
    const before = vault.get('note-taking');
    expect(vault.approve('note-taking')).toEqual(before);
    expect(vault.approve('nope')).toBeUndefined();
  });

  it('keeps a user edit to a default skill across reboot', () => {
    vault.write({
      slug: 'note-taking',
      name: 'My note-taking',
      description: 'mine',
      whenToUse: 'mine',
      body: 'mine',
    });
    const reopened = new SkillsVault(root);
    expect(reopened.get('note-taking')?.name).toBe('My note-taking');
  });
});


  describe('Agent Skills folders (pop-agent.spec §8)', () => {
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
      expect(skill?.source).toBe('user');
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

describe('SkillsVault archiving', () => {
  function auto(slug: string): void {
    vault.write({
      slug,
      name: slug,
      description: `${slug} description`,
      whenToUse: slug,
      body: `${slug} body`,
      source: 'auto',
    });
  }

  it('takes a skill out of the vault without destroying it', () => {
    auto('retired');
    expect(vault.archive('retired')).toBe(true);

    expect(vault.get('retired')).toBeUndefined();
    expect(vault.all().map((skill) => skill.slug)).not.toContain('retired');
    expect(existsSync(join(root, '_archive', 'retired', 'SKILL.md'))).toBe(true);
  });

  it('lists what it retired, with the body intact', () => {
    auto('retired');
    vault.archive('retired');

    expect(vault.archived().map((skill) => skill.slug)).toEqual(['retired']);
    expect(vault.archived()[0]?.body).toBe('retired body');
  });

  it('brings one back into the router', () => {
    auto('retired');
    vault.archive('retired');

    expect(vault.restore('retired')?.slug).toBe('retired');
    expect(vault.get('retired')?.body).toBe('retired body');
    expect(vault.archived()).toEqual([]);
    // Back where an auto skill lives, not as a loose file at the root.
    expect(existsSync(join(root, 'auto', 'retired', 'SKILL.md'))).toBe(true);
  });

  it('keeps an archived skill out of the scanner, not just out of the list', () => {
    auto('retired');
    vault.archive('retired');
    // A fresh vault over the same folder must reach the same conclusion: the
    // archive is a reserved name, not a runtime filter.
    expect(new SkillsVault(root).get('retired')).toBeUndefined();
  });

  it('archives a flat user skill into the same shape', () => {
    vault.write({ slug: 'mine', name: 'Mine', description: 'd', whenToUse: 'w', body: 'Body.' });
    expect(vault.archive('mine')).toBe(true);
    expect(existsSync(join(root, '_archive', 'mine', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'mine.md'))).toBe(false);
  });

  it('refuses a built-in, which the next boot would seed straight back', () => {
    expect(() => vault.archive('pop-agent-manual')).toThrow(SkillsError);
  });

  it('answers false for a skill that is not there', () => {
    expect(vault.archive('ghost')).toBe(false);
    expect(vault.restore('ghost')).toBeUndefined();
  });
});

describe('SkillsVault stale built-in sweep', () => {
  it('deletes a removed built-in the user never edited', () => {
    writeFileSync(
      join(root, 'summarize.md'),
      [
        '---',
        'name: Summarize',
        'description: Condense text',
        'whenToUse: when summarizing',
        'source: builtin',
        `seed: ${seedHash({ name: 'Summarize', description: 'Condense text', whenToUse: 'when summarizing', body: '# Summarizing\n- short' })}`,
        '---',
        '',
        '# Summarizing',
        '- short',
        '',
      ].join('\n'),
    );

    new SkillsVault(root);

    expect(existsSync(join(root, 'summarize.md'))).toBe(false);
    expect(vault.get('summarize')).toBeUndefined();
  });

  it('promotes a removed built-in the user edited to user source', () => {
    writeFileSync(
      join(root, 'writing-clear.md'),
      [
        '---',
        'name: My writing',
        'description: Mine',
        'whenToUse: mine',
        'source: builtin',
        `seed: ${seedHash({ name: 'Clear writing', description: 'Rewrite text', whenToUse: 'when writing', body: '# Clear writing\n- lead' })}`,
        '---',
        '',
        '# My version',
        '- keep this',
        '',
      ].join('\n'),
    );

    new SkillsVault(root);

    const skill = new SkillsVault(root).get('writing-clear');
    expect(skill?.source).toBe('user');
    expect(skill?.body).toContain('My version');
    expect(parse(readFileSync(join(root, 'writing-clear.md'), 'utf8')).seed).toBeUndefined();
  });

  it('leaves a built-in still in the roster alone', () => {
    const before = readFileSync(join(root, 'shell-safety.md'), 'utf8');
    new SkillsVault(root);
    expect(readFileSync(join(root, 'shell-safety.md'), 'utf8')).toBe(before);
    expect(vault.get('shell-safety')?.source).toBe('builtin');
  });
});

describe('SkillsVault enabled', () => {
  it('persists disabled across a vault reopen', () => {
    expect(vault.setEnabled('shell-safety', false)).toBe(true);
    expect(vault.get('shell-safety')?.enabled).toBe(false);
    expect(readFileSync(join(root, 'shell-safety.md'), 'utf8')).toContain('enabled: false');

    const reopened = new SkillsVault(root);
    expect(reopened.get('shell-safety')?.enabled).toBe(false);

    expect(reopened.setEnabled('shell-safety', true)).toBe(true);
    expect(reopened.get('shell-safety')?.enabled).toBeUndefined();
    expect(readFileSync(join(root, 'shell-safety.md'), 'utf8')).not.toContain('enabled:');
  });

  it('can disable a built-in without deleting it', () => {
    expect(vault.setEnabled('pop-agent-manual', false)).toBe(true);
    expect(vault.get('pop-agent-manual')?.source).toBe('builtin');
    expect(vault.get('pop-agent-manual')?.enabled).toBe(false);
  });

  it('answers false for an unknown slug', () => {
    expect(vault.setEnabled('ghost', false)).toBe(false);
  });
});
