import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { importMacosTray } from './macos-tray-artifacts.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pop-macos-tray-')); roots.push(root);
  const artifacts: Record<string, { file: string; size: number; sha256: string }> = {};
  for (const arch of ['arm64', 'amd64']) {
    const bytes = Buffer.alloc(64); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
    const file = `pop-local-access-1.2.3-darwin-${arch}`;
    writeFileSync(join(root, file), bytes);
    artifacts[`darwin-${arch}`] = { file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const manifest = { version: '1.2.3', commit: 'release-commit', artifacts };
  const save = () => writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest)); save();
  return { root, manifest, save };
}
it('imports both architectures while preserving the Windows entry', () => {
  const { root } = fixture(); const output = join(root, 'output'); mkdirSync(output);
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ version: '1.2.3', artifacts: { 'windows-amd64': { file: 'windows.exe' } } }));
  importMacosTray(root, output, '1.2.3', 'release-commit');
  const packed = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  expect(Object.keys(packed.artifacts)).toEqual(['windows-amd64', 'darwin-arm64', 'darwin-amd64']);
  expect(readFileSync(join(output, 'pop-local-access-1.2.3-darwin-arm64'))).toEqual(readFileSync(join(root, 'pop-local-access-1.2.3-darwin-arm64')));
});
it('rejects another version or commit', () => {
  const { root } = fixture();
  expect(() => importMacosTray(root, undefined, '1.2.4', 'release-commit')).toThrow('commit/version');
  expect(() => importMacosTray(root, undefined, '1.2.3', 'other-commit')).toThrow('commit/version');
});
it('rejects a missing architecture and unsafe filenames', () => {
  const { root, manifest, save } = fixture();
  manifest.artifacts['darwin-arm64']!.file = '../escape'; save();
  expect(() => importMacosTray(root, undefined, '1.2.3', 'release-commit')).toThrow('Missing macOS tray');
  delete manifest.artifacts['darwin-arm64']; save();
  expect(() => importMacosTray(root, undefined, '1.2.3', 'release-commit')).toThrow('Missing macOS tray');
});
it('rejects corrupted bytes and wrong Mach-O architecture', () => {
  const { root } = fixture(); const file = join(root, 'pop-local-access-1.2.3-darwin-arm64');
  const bytes = readFileSync(file); bytes[20] = 1; writeFileSync(file, bytes);
  expect(() => importMacosTray(root, undefined, '1.2.3', 'release-commit')).toThrow('integrity');
  bytes.writeUInt32LE(0x01000007, 4); writeFileSync(file, bytes);
  expect(() => importMacosTray(root, undefined, '1.2.3', 'release-commit')).toThrow('Invalid macOS executable');
});
