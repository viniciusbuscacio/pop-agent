import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Product version labels do not change installed dependencies. */
export function dependencyKey(root: string, node: string, image: string): string {
  const hash = createHash('sha256').update(node).update(image);
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as { version?: string; packages?: Record<string, {version?: string}> };
  delete lock.version;
  for (const name of ['', 'server', 'shared', 'web', 'cli']) if (lock.packages?.[name]) delete lock.packages[name].version;
  hash.update(JSON.stringify(lock));
  for (const name of ['', 'server', 'shared', 'web', 'cli']) {
    const pkg = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')) as {version?: string};
    delete pkg.version; hash.update(name).update(JSON.stringify(pkg));
  }
  for (const name of readdirSync(join(root, 'patches')).sort()) hash.update(name).update(readFileSync(join(root, 'patches', name)));
  return hash.digest('hex');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(dependencyKey(resolve(import.meta.dirname, '..'), process.version, process.env['POP_AGENT_BUILDER_IMAGE'] ?? ''));
}
