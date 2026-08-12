import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

describe('application viewport containment', () => {
  it('never lets the document root become a horizontal scroller', () => {
    expect(styles).toMatch(/html,\s*body,\s*#root\s*{[^}]*min-width:\s*0;/s);
    expect(styles).toMatch(/html,\s*body,\s*#root\s*{[^}]*overflow-x:\s*hidden;/s);
  });
});
