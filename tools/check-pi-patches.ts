import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Temporary Copilot OAuth contract; remove only when upstream has equivalent behavior.
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

if (source.includes('enableAllGitHubCopilotModels') ||
    source.includes('/policy') ||
    !source.includes('async function optionalCopilotModelIds(') ||
    !source.includes('credential.availableModelIds')) {
  throw new Error('The Copilot login patch is not applied. Run npm install before using OAuth.');
}

console.log('pi patch check passed (read-only Copilot catalog, isolated transient failures)');
