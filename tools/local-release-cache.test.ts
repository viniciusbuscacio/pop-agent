import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { dependencyKey } from './local-release-cache.ts';
it('reuses installed dependencies across product versions but invalidates real inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'pop-release-cache-'));
  try {
    const names = ['', 'server', 'shared', 'web', 'cli'];
    const write = (version: string, dependency = '1.0.0') => {
      for (const name of names) { mkdirSync(join(root, name), { recursive: true }); writeFileSync(join(root, name, 'package.json'), JSON.stringify({ name: name || 'root', version, dependencies: { example: dependency } })); }
      writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version, packages: { ...Object.fromEntries(names.map(name => [name, {version}])), 'node_modules/example': {version: dependency} } }));
    };
    mkdirSync(join(root, 'patches'));
    writeFileSync(join(root, 'patches/example.patch'), 'original');
    write('0.2.77'); const first = dependencyKey(root, 'v22', 'image');
    write('0.2.78'); expect(dependencyKey(root, 'v22', 'image')).toBe(first);
    write('0.2.78', '2.0.0'); expect(dependencyKey(root, 'v22', 'image')).not.toBe(first);
    write('0.2.77'); expect(dependencyKey(root, 'v23', 'image')).not.toBe(first);
    expect(dependencyKey(root, 'v22', 'other-image')).not.toBe(first);
    writeFileSync(join(root, 'patches/example.patch'), 'changed');
    expect(dependencyKey(root, 'v22', 'image')).not.toBe(first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
