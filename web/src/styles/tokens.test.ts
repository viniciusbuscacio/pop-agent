import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function themeBlock(selector: RegExp): string {
  const match = styles.match(selector);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

function tokenNames(block: string): string[] {
  return [...block.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1] ?? '').sort();
}

const dark = themeBlock(/:root,\s*:root\[data-theme='dark'\]\s*\{([^}]*)\}/s);
const light = themeBlock(/:root\[data-theme='light'\]\s*\{([^}]*)\}/s);

describe('theme tokens', () => {
  it('defines the same semantic tokens in both themes', () => {
    expect(tokenNames(light)).toEqual(tokenNames(dark));
  });

  it('keeps the light canvas distinct from its raised surfaces', () => {
    expect(light).toMatch(/--bg:\s*#f7f5f2;/);
    expect(light).toMatch(/--panel-bg:\s*#ffffff;/);
    expect(light).toMatch(/--shadow-panel:\s*[^;]+;/);
  });
});
