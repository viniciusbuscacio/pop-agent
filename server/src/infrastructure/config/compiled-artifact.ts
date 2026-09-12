import { fileURLToPath } from 'node:url';

/** A one-shot compiled beside dist/main.js, whether main itself runs from src or dist. */
export function compiledServerArtifact(mainUrl: string, relativePath: string): string {
  if (relativePath.startsWith('/') || relativePath.includes('..')) {
    throw new Error('compiled server artifact path must stay inside dist');
  }
  return fileURLToPath(new URL(`../dist/${relativePath}`, mainUrl));
}
