import { describe, expect, it } from 'vitest';
import { readVersions } from './versions.js';

describe('versions', () => {
  it('reports the running node, the popy version and the pinned pi version', () => {
    const versions = readVersions();

    expect(versions.nodeVersion).toBe(process.version);
    expect(versions.popyVersion).toMatch(/^\d+\.\d+\.\d+/);
    // Read from the dependency string, so it must be a bare pinned version.
    expect(versions.piVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
