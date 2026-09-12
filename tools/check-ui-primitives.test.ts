import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uiPrimitiveErrors } from './check-ui-primitives.js';

function fixture(source: string, file = 'page.tsx'): string {
  const root = join(process.env['TMPDIR'] ?? '/tmp', `pop-ui-check-${crypto.randomUUID()}`);
  mkdirSync(join(root, 'web/src/routes'), { recursive: true });
  mkdirSync(join(root, 'web/src/ui'), { recursive: true });
  writeFileSync(join(root, 'web/src/ui/controls.tsx'), 'export {};');
  writeFileSync(join(root, 'web/src/routes', file), source);
  return root;
}

describe('UI primitive architecture check', () => {
  it('rejects inconsistent Settings field and button typography', () => {
    for (const className of ['font-mono', 'text-sm', 'md:font-semibold', 'leading-tight']) {
      const errors = uiPrimitiveErrors(fixture(`<TextArea id="memory" className="${className}" />`, 'settings-page.tsx'));
      expect(errors.join('\n')).toContain('Settings typography must use the shared primitive');
    }
    expect(uiPrimitiveErrors(fixture('<TextArea id="memory" rows={15} className="min-h-[calc(15lh+1rem+2px)] shrink-0" />', 'settings-page.tsx'))).toEqual([]);
  });

  it('rejects native interactive controls outside the design system', () => {
    const errors = uiPrimitiveErrors(fixture('export const Page = () => <input />;'));
    expect(errors.join('\n')).toContain('native <input> is forbidden');
  });

  it('rejects hand-written menu shells and duplicate focus borders', () => {
    const root = fixture(`export const Page = () => <div role="menu" className="focus:border-[var(--accent)]" />;`);
    const errors = uiPrimitiveErrors(root).join('\n');
    expect(errors).toContain('use <Menu>');
    expect(errors).toContain('duplicate focus border is forbidden');
  });

  it('rejects private skins applied to design-system components', () => {
    const root = fixture(`import { SearchField } from '../ui/controls'; export const Page = () => <SearchField id="q" className="w-full border-blue-500" />;`);
    expect(uiPrimitiveErrors(root).join('\n')).toContain('className may contain layout only');
  });

  it('accepts design-system components with layout classes', () => {
    const root = fixture(`import { SearchField, Menu } from '../ui/controls'; export const Page = () => <Menu className="absolute top-full"><SearchField id="q" className="w-full" /></Menu>;`);
    expect(uiPrimitiveErrors(root)).toEqual([]);
  });
});
