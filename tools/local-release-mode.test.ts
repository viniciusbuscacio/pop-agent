import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const launcher = readFileSync(resolve(root, 'deploy/local-release.sh'), 'utf8');
const container = readFileSync(resolve(root, 'deploy/local-release-container.sh'), 'utf8');

describe('local release native target mode', () => {
  it('keeps complete releases strict by default', () => {
    expect(launcher).toContain('windows_first=0');
    expect(container).toContain('node tools/macos-tray-artifacts.ts check "$POP_AGENT_MACOS_TRAY_DIR"');
    expect(container.indexOf('node tools/macos-tray-artifacts.ts check')).toBeLessThan(
      container.indexOf('npm run gate'),
    );
  });

  it('requires an explicit Windows-first mode and omits the macOS import directory', () => {
    expect(launcher).toContain('build-windows) mode=build; windows_first=1');
    expect(launcher).toContain('-e POP_AGENT_WINDOWS_FIRST_RELEASE="$windows_first"');
    expect(container).toContain('if [[ ${POP_AGENT_WINDOWS_FIRST_RELEASE:-0} = 1 ]]');
    expect(container).toContain('unset POP_AGENT_MACOS_TRAY_DIR');
    expect(container).toContain('A later macOS release requires a new version.');
  });
});
