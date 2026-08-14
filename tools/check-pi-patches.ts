import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Temporary upstream patch contract. Remove this check together with the patch
 * once a published pi release contains b3edf017021f802af9b76ab4d95cb555c5427352.
 */
const sourcePath = join(
  process.cwd(),
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'node_modules',
  '@earendil-works',
  'pi-ai',
  'dist',
  'auth',
  'oauth',
  'github-copilot.js',
);

let source: string;
try {
  source = readFileSync(sourcePath, 'utf8');
} catch {
  throw new Error('The pi dependency is not installed. Run npm install before the gate.');
}

const bounded = source.includes('const COPILOT_POLICY_CONCURRENCY = 4;');
const batches = source.includes(
  'models.slice(index, index + COPILOT_POLICY_CONCURRENCY)',
);
const unbounded = source.includes('Promise.all(models.map');
if (!bounded || !batches || unbounded) {
  throw new Error(
    'The official Copilot concurrency patch is not applied. Run npm install; do not attempt GitHub sign-in with the unpatched dependency.',
  );
}

console.log('pi patch check passed (Copilot policy concurrency = 4)');
