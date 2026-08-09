/**
 * Generates the derived half of the pop-agent-codebase skill (pop-agent.spec §8):
 * the repo map and the UI map, read from the code so they cannot drift from
 * it. Hand-written architecture docs lie within weeks; this one is emitted by
 * `npm run selfmap` and the gate fails on drift (`npm run selfmap:check`).
 *
 * Deliberately dependency-free and deterministic: same tree, same bytes.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'server', 'src', 'infrastructure', 'skills', 'self-map.generated.ts');

/** What each server/src layer is for; counts come from the tree itself. */
const LAYER_NOTES: Record<string, string> = {
  domain: 'entities, value objects and pure services -- the innermost layer',
  application: 'use cases and ports/ (interfaces the outer layers implement)',
  infrastructure: 'adapters: SQLite, the pi engine, vaults on disk, embeddings',
  interface: 'HTTP routes (Hono) and SSE -- the outer edge',
  architecture: 'the boundary test that enforces the dependency rule',
  testing: 'shared test harness helpers',
};

function sourceFileCount(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory()) count += sourceFileCount(join(dir, entry.name));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) count += 1;
  }
  return count;
}

function dependencyVersions(): string {
  const dep = (file: string, name: string): string => {
    const pkg = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? '?';
  };
  return [
    `pi ${dep('server/package.json', '@earendil-works/pi-coding-agent')}`,
    `hono ${dep('server/package.json', 'hono')}`,
    `better-sqlite3 ${dep('server/package.json', 'better-sqlite3')}`,
    `react ${dep('web/package.json', 'react')}`,
  ].join(', ');
}

function layerLines(): string[] {
  const src = join(root, 'server', 'src');
  return readdirSync(src, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const note = LAYER_NOTES[name] ?? 'see pop-agent.spec';
      const count = sourceFileCount(join(src, name));
      const size = count === 1 ? '1 module' : `${String(count)} modules`;
      return `- \`${name}/\` -- ${note} (${size})`;
    });
}

function routeLines(): string[] {
  const app = readFileSync(join(root, 'web', 'src', 'App.tsx'), 'utf8');
  const paths: string[] = [];
  for (const match of app.matchAll(/path="([^"]+)"/g)) {
    const path = match[1] ?? '';
    if (path === '*' || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths.map((path) => (path.startsWith('/') ? path : `/${path}`));
}

function settingsSections(): string[] {
  const i18n = readFileSync(join(root, 'web', 'src', 'i18n', 'en.ts'), 'utf8');
  const sections: string[] = [];
  for (const match of i18n.matchAll(/'settings\.section\.\w+':\s*'([^']+)'/g)) {
    const label = match[1] ?? '';
    if (!sections.includes(label)) sections.push(label);
  }
  return sections;
}

function selfMap(): string {
  const workspaces = (
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { workspaces?: string[] }
  ).workspaces ?? [];
  return [
    '## Repo map (generated -- npm run selfmap)',
    '',
    `Monorepo, npm workspaces: ${workspaces.join(', ')}. \`shared\` is the wire`,
    'contract (pure DTOs); `server` and `web` both import it.',
    `Key dependencies: ${dependencyVersions()}.`,
    '',
    'server/src, clean architecture -- dependencies point inward only:',
    ...layerLines(),
    '',
    '## UI map (generated)',
    '',
    `PWA routes: ${routeLines().join(', ')}.`,
    `Settings sections: ${settingsSections().join(', ')}.`,
    'Deep links: /settings?section=<name> opens a section directly.',
  ].join('\n');
}

function render(): string {
  const lines = selfMap().split('\n');
  return [
    '/** The derived self-map (pop-agent.spec §8). Regenerate with `npm run selfmap`. */',
    'export const SELF_MAP = [',
    ...lines.map((line) => `  ${JSON.stringify(line)},`),
    "].join('\\n');",
    '',
  ].join('\n');
}

const fresh = render();
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outPath, 'utf8');
  } catch {
    // missing counts as drift
  }
  if (current !== fresh) {
    console.error('self-map drift: run `npm run selfmap` and commit the result.');
    process.exit(1);
  }
} else {
  writeFileSync(outPath, fresh);
  console.log(`wrote ${outPath}`);
}
