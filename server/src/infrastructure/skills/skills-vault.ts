import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Skill, SkillSource } from '../../domain/skills/skill.js';
import {
  SkillsError,
  type SkillArchiveRepo,
  type SkillInput,
  type SkillsRepo,
} from '../../application/ports/skills-repo.js';
import { DEFAULT_SKILLS } from './default-skills.js';

/**
 * Where skills live on disk (pop-agent.spec §8): one markdown file per skill under
 * `POP_AGENT_DATA_DIR/skills/`, each with a small YAML-ish front matter (name,
 * description, whenToUse) and the body below. Pop Agent's own skills are seeded on
 * first boot and marked built-in; the user's are just more files. The Skill
 * Router reads `all()` and picks the relevant few per turn.
 *
 * Since §8 (01/08) the vault ALSO discovers the Agent Skills standard
 * (agentskills.io): any directory containing a `SKILL.md`, found recursively
 * (a directory that IS a skill is not descended into -- its inner folders are
 * assets). Slug = directory name; `whenToUse` falls back to the description,
 * since the standard's front matter has only name/description. Flat .md
 * skills keep working unchanged and win on a slug collision.
 *
 * Auto-skills (07/08) land under `skills/auto/<slug>/SKILL.md` and are found by
 * that same recursion -- the folder is the standard shape, so nothing new had
 * to be taught to the scanner. `source` comes from the front matter when it
 * says so and from the path otherwise, which is what makes promotion cheap:
 * editing an auto skill stamps `source: user` on the file it already lives in,
 * and the collector stops looking at it without anything moving on disk.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

/** The subfolder the distiller writes into; also the path-based `source` hint. */
export const AUTO_DIR = 'auto';

/**
 * Where the collector puts what it retires (pop-agent.spec §8). A reserved name, so
 * the scanner walks past it: a skill in here is out of the router but still on
 * disk, which is the whole point -- the policy is a cap with archiving, never a
 * delete. A seasonal procedure (the once-a-year tax routine) would be destroyed
 * by any rule that deletes, and no use counter can tell it apart from a skill
 * that simply never earned its place.
 */
export const ARCHIVE_DIR = '_archive';

/** The defaults that ship pinned (pop-agent.spec §8), pinned even where the seeded
 * file predates the flag -- no migration, the code is the source. */
const PINNED_DEFAULTS = new Set(
  DEFAULT_SKILLS.filter((skill) => skill.pinned === true).map((skill) => skill.slug),
);

export class SkillsVault implements SkillsRepo, SkillArchiveRepo {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.seedDefaults();
    this.sweepStaleBuiltins();
  }

  all(): Skill[] {
    const flat = readdirSync(this.root)
      .filter((file) => file.endsWith('.md'))
      .map((file) => this.readFile(file.slice(0, -3)))
      .filter((skill): skill is Skill => skill !== undefined);
    const taken = new Set(flat.map((skill) => skill.slug));
    const foldered = this.discoverFolderSkills()
      .filter(({ slug }) => !taken.has(slug))
      .map(({ slug, path }) => this.readFolderSkill(slug, path))
      .filter((skill): skill is Skill => skill !== undefined);
    return [...flat, ...foldered].sort((left, right) => left.name.localeCompare(right.name));
  }

  get(slug: string): Skill | undefined {
    if (!SLUG.test(slug)) return undefined;
    const flat = this.readFile(slug);
    if (flat !== undefined) return flat;
    const found = this.discoverFolderSkills().find((entry) => entry.slug === slug);
    return found === undefined ? undefined : this.readFolderSkill(found.slug, found.path);
  }

  /**
   * Creates or overwrites a skill. An existing skill is rewritten where it
   * already lives, so editing an auto skill promotes it in place rather than
   * leaving a folder copy behind a new flat file. A new `auto` skill goes to
   * `auto/<slug>/SKILL.md`; anything else stays a flat file at the root.
   */
  write(input: SkillInput): Skill {
    if (!SLUG.test(input.slug)) {
      throw new SkillsError('A skill id must be lowercase letters, numbers and dashes.');
    }
    // An edit that says nothing about `source` inherits the skill's own -- a
    // built-in stays built-in when the user tweaks it (§8: editable, never
    // deletable) -- except for an auto skill, where the edit IS the promotion:
    // the user touched it, so the garbage collector stops looking at it.
    const current = this.get(input.slug);
    const source: SkillSource =
      input.source ??
      (current === undefined ? 'user' : current.source === 'auto' ? 'user' : current.source);
    const enabled =
      input.enabled === true
        ? undefined
        : input.enabled === false
          ? false
          : current?.enabled === false
            ? false
            : undefined;
    let seed: string | undefined;
    if (current !== undefined) {
      const flatPath = join(this.root, `${input.slug}.md`);
      const folder = this.discoverFolderSkills().find((entry) => entry.slug === input.slug);
      const path = existsSync(flatPath) ? flatPath : folder?.path;
      if (path !== undefined) {
        try {
          seed = parse(readFileSync(path, 'utf8')).seed;
        } catch {
          seed = undefined;
        }
      }
    }
    const content = serialize({
      ...input,
      source,
      ...(enabled === false ? { enabled: false } : {}),
      ...(seed === undefined ? {} : { seed }),
    });

    const existingFolder = this.discoverFolderSkills().find((entry) => entry.slug === input.slug);
    const flatPath = join(this.root, `${input.slug}.md`);
    if (existsSync(flatPath) || existingFolder === undefined) {
      if (source === 'auto' && !existsSync(flatPath)) {
        const dir = join(this.root, AUTO_DIR, input.slug);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'SKILL.md'), content);
      } else {
        writeFileSync(flatPath, content);
      }
    } else {
      writeFileSync(existingFolder.path, content);
    }

    const skill = this.get(input.slug);
    if (skill === undefined) throw new SkillsError('The skill could not be saved.');
    return skill;
  }

  /**
   * Accepts a pending skill (pop-agent.spec §8). `source` is passed back explicitly
   * so the auto -> user promotion in `write` does not fire: the user said yes,
   * which is not the same as having edited it, and an auto skill that was
   * merely approved is still the collector's to manage.
   */
  approve(slug: string): Skill | undefined {
    const skill = this.get(slug);
    if (skill === undefined || skill.pending !== true) return skill;
    return this.write({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      body: skill.body,
      source: skill.source,
      ...(skill.pinned === true ? { pinned: true } : {}),
      pending: false,
    });
  }

  delete(slug: string): boolean {
    const skill = this.get(slug);
    if (skill === undefined) return false;
    if (skill.source === 'builtin') throw new SkillsError('Built-in skills cannot be deleted.');
    const found = this.discoverFolderSkills().find((entry) => entry.slug === slug);
    if (found !== undefined) {
      rmSync(dirname(found.path), { recursive: true, force: true });
      return true;
    }
    rmSync(join(this.root, `${slug}.md`), { force: true });
    return true;
  }

  /** Rewrites front matter so a skill may or may not route and pin (§8). */
  setEnabled(slug: string, enabled: boolean): boolean {
    const skill = this.get(slug);
    if (skill === undefined) return false;
    this.write({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      body: skill.body,
      source: skill.source,
      ...(skill.pinned === true ? { pinned: true } : {}),
      ...(skill.pending === true ? { pending: true } : {}),
      enabled,
    });
    return true;
  }

  /**
   * Moves a skill out of the router without destroying it (pop-agent.spec §8): the
   * collector's only verb. It lands in `_archive/<slug>/SKILL.md` whatever
   * shape it had, because the archive is a resting place and not a working
   * layout -- and coming back out is then one rule, not two.
   *
   * Built-ins are refused for the same reason they cannot be deleted: they
   * belong to the app, and the next boot would seed them straight back.
   */
  archive(slug: string): boolean {
    const skill = this.get(slug);
    if (skill === undefined) return false;
    if (skill.source === 'builtin') throw new SkillsError('Built-in skills cannot be archived.');

    const target = join(this.root, ARCHIVE_DIR, slug);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });

    const folder = this.discoverFolderSkills().find((entry) => entry.slug === slug);
    if (folder !== undefined) {
      renameSync(dirname(folder.path), target);
      return true;
    }
    mkdirSync(target, { recursive: true });
    renameSync(join(this.root, `${slug}.md`), join(target, 'SKILL.md'));
    return true;
  }

  /** What the collector has retired, newest names last; the screen offers these back. */
  archived(): Skill[] {
    const root = join(this.root, ARCHIVE_DIR);
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SLUG.test(entry.name))
      .map((entry) => this.readFolderSkill(entry.name, join(root, entry.name, 'SKILL.md')))
      .filter((skill): skill is Skill => skill !== undefined)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Back into the vault, and back into the router. An archived skill returns to
   * the shape its source implies -- an auto skill to `auto/<slug>/`, anything
   * else to a flat file -- which is exactly what `write` already decides, so
   * the restore is a read plus a write rather than a second set of path rules.
   */
  restore(slug: string): Skill | undefined {
    const stored = this.archived().find((skill) => skill.slug === slug);
    if (stored === undefined) return undefined;
    const restored = this.write({
      slug: stored.slug,
      name: stored.name,
      description: stored.description,
      whenToUse: stored.whenToUse,
      body: stored.body,
      source: stored.source,
      ...(stored.pinned === true ? { pinned: true } : {}),
      ...(stored.pending === true ? { pending: true } : {}),
    });
    rmSync(join(this.root, ARCHIVE_DIR, slug), { recursive: true, force: true });
    return restored;
  }

  /**
   * Recursive Agent Skills discovery: every directory holding a SKILL.md is
   * one skill; a found skill directory is not descended into. Hidden
   * directories are skipped, and so is the archive: what the collector retired
   * is on disk but out of the vault, which is the difference between archiving
   * and doing nothing.
   */
  private discoverFolderSkills(dir: string = this.root): { slug: string; path: string }[] {
    const found: { slug: string; path: string }[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === ARCHIVE_DIR) continue;
      const child = join(dir, entry.name);
      const skillFile = join(child, 'SKILL.md');
      if (existsSync(skillFile)) {
        if (SLUG.test(entry.name)) found.push({ slug: entry.name, path: skillFile });
        continue;
      }
      found.push(...this.discoverFolderSkills(child));
    }
    return found;
  }

  private readFolderSkill(slug: string, path: string): Skill | undefined {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
    const parsed = parse(raw);
    if (parsed.description.length === 0) return undefined; // the standard: no description, no skill
    // The front matter wins; the path only answers for files that never said.
    // That is what lets a promoted auto skill keep living under auto/.
    const source = parsed.source ?? (this.isUnderAuto(path) ? 'auto' : 'user');
    return {
      slug,
      name: parsed.name.length > 0 ? parsed.name : slug,
      description: parsed.description,
      whenToUse: parsed.whenToUse.length > 0 ? parsed.whenToUse : parsed.description,
      body: parsed.body,
      source,
      ...(parsed.pinned ? { pinned: true } : {}),
      ...(parsed.pending ? { pending: true } : {}),
      ...(parsed.enabled === false ? { enabled: false } : {}),
    };
  }

  /** True for a path inside `skills/auto/`, the distiller's drop box. */
  private isUnderAuto(path: string): boolean {
    const parts = relative(this.root, path).split(sep);
    return parts[0] === AUTO_DIR;
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
      source: parsed.source ?? 'user',
      ...(pinned ? { pinned: true } : {}),
      ...(parsed.pending ? { pending: true } : {}),
      ...(parsed.enabled === false ? { enabled: false } : {}),
    };
  }

  /**
   * Seeds the defaults, and upgrades the ones the user never touched. Each
   * seeded file carries a hash of its own content; a file still matching it
   * follows the shipped default (the generated self-map must not freeze at
   * whatever a boot once wrote), while an edited file is the user's to keep.
   * A file from before the seed marker existed that is still identical to
   * the shipped default gets stamped, so it upgrades from here on.
   */
  private seedDefaults(): void {
    for (const skill of DEFAULT_SKILLS) {
      const path = join(this.root, `${skill.slug}.md`);
      const fresh = serialize({ ...skill, source: 'builtin', seed: seedHash(skill) });
      let existing: Parsed;
      try {
        existing = parse(readFileSync(path, 'utf8'));
      } catch {
        writeFileSync(path, fresh);
        continue;
      }
      const matchesShipped = seedHash(existing) === seedHash(skill);
      if (existing.seed === undefined) {
        if (matchesShipped) writeFileSync(path, fresh);
        continue;
      }
      const pristine = existing.seed === seedHash(existing);
      if (pristine && !matchesShipped) writeFileSync(path, fresh);
    }
  }

  /**
   * Drops built-ins removed from the shipped roster (pop-agent.spec §8). A file
   * the user never touched is deleted; one they edited is promoted to `user`
   * so their words are never destroyed.
   */
  private sweepStaleBuiltins(): void {
    const roster = new Set(DEFAULT_SKILLS.map((skill) => skill.slug));
    for (const file of readdirSync(this.root).filter((entry) => entry.endsWith('.md'))) {
      const slug = file.slice(0, -3);
      if (roster.has(slug)) continue;

      const path = join(this.root, file);
      let parsed: Parsed;
      try {
        parsed = parse(readFileSync(path, 'utf8'));
      } catch {
        continue;
      }
      if (parsed.source !== 'builtin') continue;

      const pristine = parsed.seed !== undefined && parsed.seed === seedHash(parsed);
      if (pristine) {
        rmSync(path, { force: true });
        continue;
      }

      writeFileSync(
        path,
        serialize({
          name: parsed.name.length > 0 ? parsed.name : slug,
          description: parsed.description,
          whenToUse: parsed.whenToUse,
          body: parsed.body,
          source: 'user',
          ...(parsed.pinned ? { pinned: true } : {}),
          ...(parsed.pending ? { pending: true } : {}),
        }),
      );
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
  /** Absent when the file never said; the caller decides from the path. */
  source?: SkillSource;
  pinned: boolean;
  pending: boolean;
  /** Absent means enabled; only `false` is stored on disk (§8). */
  enabled?: boolean;
  /** The seed marker written by seedDefaults; absent on user files and edits. */
  seed?: string;
}

const SOURCES = new Set<string>(['builtin', 'auto', 'user']);

/** Minimal front-matter parse: `--- key: value ---` then the markdown body. */
export function parse(raw: string): Parsed {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (match === null) {
    return { name: '', description: '', whenToUse: '', body: raw.trim(), pinned: false, pending: false };
  }
  const meta = new Map<string, string>();
  for (const line of (match[1] ?? '').split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv?.[1] !== undefined) meta.set(kv[1], (kv[2] ?? '').replace(/^["']|["']$/g, ''));
  }
  const seed = meta.get('seed');
  // `builtin: true` is what every file written before 07/08 says; reading it as
  // a source keeps those files working without a migration pass over the vault.
  const declared = meta.get('source');
  const source =
    declared !== undefined && SOURCES.has(declared)
      ? (declared as SkillSource)
      : meta.get('builtin') === 'true'
        ? 'builtin'
        : undefined;
  return {
    name: meta.get('name') ?? '',
    description: meta.get('description') ?? '',
    whenToUse: meta.get('whenToUse') ?? '',
    body: (match[2] ?? '').trim(),
    ...(source === undefined ? {} : { source }),
    pinned: meta.get('pinned') === 'true',
    pending: meta.get('pending') === 'true',
    ...(meta.get('enabled') === 'false' ? { enabled: false as const } : {}),
    ...(seed === undefined ? {} : { seed }),
  };
}

function serialize(input: {
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  source?: SkillSource;
  pinned?: boolean;
  pending?: boolean;
  enabled?: boolean;
  seed?: string;
}): string {
  const escape = (value: string): string => value.replace(/\r?\n/g, ' ').trim();
  return [
    '---',
    `name: ${escape(input.name)}`,
    `description: ${escape(input.description)}`,
    `whenToUse: ${escape(input.whenToUse)}`,
    // Written whenever it is known, including `user` -- which looks redundant
    // until you remember where a promoted auto skill lives. It stays in
    // `auto/<slug>/`, and `readFolderSkill` falls back to the PATH when the
    // front matter says nothing. Omitting `source: user` as "the default" meant
    // the promotion was written and then read straight back as `auto`, so
    // editing an auto skill never actually took it away from the collector.
    ...(input.source === undefined ? [] : [`source: ${input.source}`]),
    ...(input.pinned ? ['pinned: true'] : []),
    ...(input.pending ? ['pending: true'] : []),
    ...(input.enabled === false ? ['enabled: false'] : []),
    ...(input.seed === undefined ? [] : [`seed: ${input.seed}`]),
    '---',
    '',
    input.body.trim(),
    '',
  ].join('\n');
}
