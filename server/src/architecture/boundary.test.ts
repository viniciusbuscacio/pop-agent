import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Clean-architecture boundary test (popy.spec §3), ported from aw's
 * boundary_test.go. Two rules:
 *
 * 1. Dependency rule — a layer may import only the layers listed for it.
 * 2. Inner-layer purity — domain, application and shared may use Node
 *    built-ins but never third-party packages.
 *
 * Test files (*.test.ts) are exempt: they are not production dependencies.
 */

const serverSrc = fileURLToPath(new URL('..', import.meta.url));
const sharedSrc = fileURLToPath(new URL('../../../shared/src', import.meta.url));

type Layer =
  | 'domain'
  | 'application'
  | 'infrastructure'
  | 'interface'
  | 'architecture'
  | 'testing'
  | 'shared'
  | 'main';

const allowedImports: Record<Layer, Layer[]> = {
  domain: [],
  application: ['domain'],
  infrastructure: ['application', 'domain'],
  interface: ['application', 'domain', 'shared'],
  architecture: [],
  // Test scaffolding: it wires the real stack the way main.ts does, so it may
  // reach anywhere. Nothing may reach *it* -- no production layer lists
  // `testing`, so an accidental import from src fails this test.
  testing: ['domain', 'application', 'infrastructure', 'interface', 'shared'],
  shared: [],
  main: ['domain', 'application', 'infrastructure', 'interface', 'shared'],
};

const pureLayers: ReadonlySet<Layer> = new Set(['domain', 'application', 'shared']);

// aw's shrinking-allowlist spirit: empty for now; grow only with a TODO.
const allowedExternalForPureLayers: ReadonlySet<string> = new Set([]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function layerForServerFile(file: string): Layer {
  const rel = relative(serverSrc, file).split(sep);
  if (rel.length === 1) return 'main';
  return rel[0] as Layer;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const re = /^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const m of source.matchAll(re)) {
    const spec = m[1] ?? m[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

function classify(file: string, spec: string): { kind: 'builtin' | 'external' } | { kind: 'layer'; layer: Layer } {
  if (spec.startsWith('node:')) return { kind: 'builtin' };
  if (spec === '@popy/shared' || spec.startsWith('@popy/shared/')) {
    return { kind: 'layer', layer: 'shared' };
  }
  if (spec.startsWith('.')) {
    const fromDir = posix.dirname(relative(serverSrc, file).split(sep).join('/'));
    const target = posix.normalize(posix.join(fromDir, spec));
    if (target.startsWith('..')) return { kind: 'external' }; // escapes server/src
    const first = target.split('/')[0]!;
    return { kind: 'layer', layer: (first.includes('.') ? 'main' : first) as Layer };
  }
  return { kind: 'external' };
}

describe('clean architecture boundaries', () => {
  it('layers only import what the dependency rule allows', () => {
    const violations: string[] = [];
    for (const file of walk(serverSrc)) {
      const from = layerForServerFile(file);
      for (const spec of importsOf(file)) {
        const target = classify(file, spec);
        if (target.kind !== 'layer' || target.layer === from) continue;
        if (!allowedImports[from]?.includes(target.layer)) {
          violations.push(`${from} must not import ${target.layer}: ${relative(serverSrc, file)} imports ${spec}`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('inner layers (domain, application, shared) have no third-party imports', () => {
    const violations: string[] = [];
    const files = [
      ...walk(serverSrc).filter((f) => pureLayers.has(layerForServerFile(f))),
      ...walk(sharedSrc),
    ];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        // Relative imports stay inside the package and node: builtins are
        // allowed; everything else must be a popy workspace or allowlisted.
        if (spec.startsWith('.') || spec.startsWith('node:')) continue;
        if (spec === '@popy/shared' || spec.startsWith('@popy/')) continue;
        if (allowedExternalForPureLayers.has(spec)) continue;
        violations.push(`pure layer file imports third-party package: ${file} imports ${spec}`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
