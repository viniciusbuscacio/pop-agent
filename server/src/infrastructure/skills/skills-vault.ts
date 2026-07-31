import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Skill } from '../../domain/skills/skill.js';
import { SkillsError, type SkillInput, type SkillsRepo } from '../../application/ports/skills-repo.js';
import { DEFAULT_SKILLS } from './default-skills.js';

/**
 * Where skills live on disk (popy.spec §8): one markdown file per skill under
 * `POPY_DATA_DIR/skills/`, each with a small YAML-ish front matter (name,
 * description, whenToUse) and the body below. Popy's own skills are seeded on
 * first boot and marked built-in; the user's are just more files. The Skill
 * Router reads `all()` and picks the relevant few per turn.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

/** The defaults that ship pinned (popy.spec §8), pinned even where the seeded
 * file predates the flag -- no migration, the code is the source. */
const PINNED_DEFAULTS = new Set(
  DEFAULT_SKILLS.filter((skill) => skill.pinned === true).map((skill) => skill.slug),
);

export class SkillsVault implements SkillsRepo {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.seedDefaults();
  }

  all(): Skill[] {
    return readdirSync(this.root)
      .filter((file) => file.endsWith('.md'))
      .map((file) => this.readFile(file.slice(0, -3)))
      .filter((skill): skill is Skill => skill !== undefined)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  get(slug: string): Skill | undefined {
    if (!SLUG.test(slug)) return undefined;
    return this.readFile(slug);
  }

  /** Creates or overwrites a user skill. Built-in slugs cannot be shadowed by a bad name. */
  write(input: SkillInput): Skill {
    if (!SLUG.test(input.slug)) {
      throw new SkillsError('A skill id must be lowercase letters, numbers and dashes.');
    }
    const content = serialize(input);
    writeFileSync(join(this.root, `${input.slug}.md`), content);
    const skill = this.readFile(input.slug);
    if (skill === undefined) throw new SkillsError('The skill could not be saved.');
    return skill;
  }

  delete(slug: string): boolean {
    const skill = this.get(slug);
    if (skill === undefined) return false;
    if (skill.builtin) throw new SkillsError('Built-in skills cannot be deleted.');
    rmSync(join(this.root, `${slug}.md`), { force: true });
    return true;
  }

  private readFile(slug: string): Skill | undefined {
    let raw: string;
    try {
      raw = readFileSync(join(this.root, `${slug}.md`), 'utf8');
    } catch {
      return undefined;
    }
    const parsed = parse(raw);
    const pinned = parsed.pinned || PINNED_DEFAULTS.has(slug);
    return {
      slug,
      name: parsed.name.length > 0 ? parsed.name : slug,
      description: parsed.description,
      whenToUse: parsed.whenToUse,
      body: parsed.body,
      builtin: parsed.builtin,
      ...(pinned ? { pinned: true } : {}),
    };
  }

  /**
   * Seeds the defaults, and upgrades the ones the user never touched. Each
   * seeded file carries a hash of its own content; a file still matching it
   * follows the shipped default (the generated self-map must not freeze at
   * whatever a boot once wrote), while an edited file is the user's to keep.
   */
  private seedDefaults(): void {
    for (const skill of DEFAULT_SKILLS) {
      const path = join(this.root, `${skill.slug}.md`);
      const fresh = serialize({ ...skill, builtin: true, seed: seedHash(skill) });
      let existing: Parsed;
      try {
        existing = parse(readFileSync(path, 'utf8'));
      } catch {
        writeFileSync(path, fresh);
        continue;
      }
      const pristine = existing.seed !== undefined && existing.seed === seedHash(existing);
      if (pristine && existing.seed !== seedHash(skill)) writeFileSync(path, fresh);
    }
  }
}

/** What a default's routed fields hash to; the seed marker of an untouched file. */
export function seedHash(skill: {
  name: string;
  description: string;
  whenToUse: string;
  body: string;
}): string {
  return createHash('sha256')
    .update([skill.name, skill.description, skill.whenToUse, skill.body.trim()].join('\n'))
    .digest('hex')
    .slice(0, 12);
}

interface Parsed {
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  builtin: boolean;
  pinned: boolean;
  /** The seed marker written by seedDefaults; absent on user files and edits. */
  seed?: string;
}

/** Minimal front-matter parse: `--- key: value ---` then the markdown body. */
export function parse(raw: string): Parsed {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (match === null) {
    return { name: '', description: '', whenToUse: '', body: raw.trim(), builtin: false, pinned: false };
  }
  const meta = new Map<string, string>();
  for (const line of (match[1] ?? '').split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv?.[1] !== undefined) meta.set(kv[1], (kv[2] ?? '').replace(/^["']|["']$/g, ''));
  }
  const seed = meta.get('seed');
  return {
    name: meta.get('name') ?? '',
    description: meta.get('description') ?? '',
    whenToUse: meta.get('whenToUse') ?? '',
    body: (match[2] ?? '').trim(),
    builtin: meta.get('builtin') === 'true',
    pinned: meta.get('pinned') === 'true',
    ...(seed === undefined ? {} : { seed }),
  };
}

function serialize(input: {
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  builtin?: boolean;
  pinned?: boolean;
  seed?: string;
}): string {
  const escape = (value: string): string => value.replace(/\r?\n/g, ' ').trim();
  return [
    '---',
    `name: ${escape(input.name)}`,
    `description: ${escape(input.description)}`,
    `whenToUse: ${escape(input.whenToUse)}`,
    ...(input.builtin ? ['builtin: true'] : []),
    ...(input.pinned ? ['pinned: true'] : []),
    ...(input.seed === undefined ? [] : [`seed: ${input.seed}`]),
    '---',
    '',
    input.body.trim(),
    '',
  ].join('\n');
}
