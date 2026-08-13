import { describe, expect, it } from 'vitest';
import { npmExecutable } from './installer.js';

describe('CLI installer executable', () => {
  it('uses the cmd launcher on Windows', () => {
    expect(npmExecutable('win32')).toBe('npm.cmd');
  });

  it('uses the executable name on Unix platforms', () => {
    expect(npmExecutable('linux')).toBe('npm');
    expect(npmExecutable('darwin')).toBe('npm');
  });
});
