import { describe, expect, it } from 'vitest';
import { compiledServerArtifact } from './compiled-artifact.js';

describe('compiledServerArtifact', () => {
  it('resolves the same external program from tsx source and compiled main', () => {
    const expected = '/srv/pop/server/dist/infrastructure/update/pi-activation.js';
    expect(compiledServerArtifact(
      'file:///srv/pop/server/src/main.ts',
      'infrastructure/update/pi-activation.js',
    )).toBe(expected);
    expect(compiledServerArtifact(
      'file:///srv/pop/server/dist/main.js',
      'infrastructure/update/pi-activation.js',
    )).toBe(expected);
  });
});
