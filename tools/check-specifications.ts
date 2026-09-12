import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specsDir = join(root, 'docs', 'specs');
const generalPath = join(specsDir, 'Spec-Pop-General.md');
const legacyPath = join(root, 'pop-agent.spec');

const failures: string[] = [];
if (existsSync(legacyPath)) failures.push('pop-agent.spec must not return; the normative specification is modular.');
if (!existsSync(generalPath)) failures.push('missing docs/specs/Spec-Pop-General.md');

const files = readdirSync(specsDir)
  .filter((name) => name.endsWith('.md'))
  .sort((a, b) => a.localeCompare(b));
const normative = files.filter((name) => name.startsWith('Spec-Pop-'));
const general = existsSync(generalPath) ? readFileSync(generalPath, 'utf8') : '';

for (const name of normative) {
  const path = join(specsDir, name);
  const content = readFileSync(path, 'utf8');
  if (!/^\*\*Status:\*\* normative(?: entry point)?$/m.test(content)) {
    failures.push(`${name}: missing normative status`);
  }
  if (name !== 'Spec-Pop-General.md' && !general.includes(`](${name})`)) {
    failures.push(`${name}: not linked from Spec-Pop-General.md`);
  }
}

for (const name of files) {
  const path = join(specsDir, name);
  const content = readFileSync(path, 'utf8');
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = match[1];
    if (target === undefined || /^[a-z]+:/i.test(target)) continue;
    const resolved = resolve(dirname(path), target);
    try {
      statSync(resolved);
    } catch {
      failures.push(`${name}: broken link ${target}`);
    }
  }
}

for (const entryPoint of ['AGENTS.md', 'README.md', 'server/src/infrastructure/skills/default-skills.ts']) {
  const content = readFileSync(join(root, entryPoint), 'utf8');
  if (!content.includes('docs/specs/Spec-Pop-General.md')) {
    failures.push(`${entryPoint}: does not point to the normative specification index`);
  }
}

if (failures.length > 0) {
  console.error(`Specification check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(`Specification check passed (${String(normative.length)} normative documents, ${String(files.length)} total).`);
