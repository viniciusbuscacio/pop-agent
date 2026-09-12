import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supervisePiActivation, type PiActivationPlan } from './pi-activation.js';

let root: string | undefined;
afterEach(() => { if (root !== undefined) rmSync(root, { recursive: true, force: true }); });

function plan(): PiActivationPlan {
  root = mkdtempSync(join(tmpdir(), 'pop-pi-activate-'));
  const runtimeRoot = join(root, 'pi-runtime');
  const sessionsDir = join(root, 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, 'chat.jsonl'), 'before\n');
  return {
    targetVersion: '0.85.0', integrity: 'sha512-ok', previousVersion: '0.84.1',
    runtimeRoot, statePath: join(runtimeRoot, 'candidate-state.json'),
    activePath: join(runtimeRoot, 'active.json'), bootPath: join(runtimeRoot, 'boot.json'),
    sessionsDir, serviceName: 'pop-test', healthUrl: 'http://health', timeoutMs: 1_000,
  };
}

function stampBoot(path: string, version: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ version }));
}

describe('pi activation supervisor', () => {
  it('accepts only after restart health and the target boot proof', async () => {
    const p = plan();
    const command = vi.fn((_command: string, args: string[]) => {
      if (args.includes('restart')) stampBoot(p.bootPath, p.targetVersion);
    });
    await supervisePiActivation(p, {
      command, healthy: () => Promise.resolve(true), sleep: () => Promise.resolve(),
      now: () => '2026-08-15T00:00:00.000Z', stamp: () => 1,
    });
    expect(JSON.parse(readFileSync(p.activePath, 'utf8'))).toMatchObject({ version: '0.85.0', integrity: 'sha512-ok' });
    expect(JSON.parse(readFileSync(p.statePath, 'utf8'))).toMatchObject({ phase: 'active', version: '0.85.0' });
    expect(command).toHaveBeenCalledWith('sudo', ['-n', 'systemctl', 'restart', 'pop-test']);
  });

  it('restores the previous pointer and session snapshot when target startup fails', async () => {
    const p = plan();
    const previous = { version: '0.83.0', integrity: 'sha512-old', activatedAt: 'before' };
    p.previousVersion = previous.version;
    mkdirSync(p.runtimeRoot, { recursive: true });
    writeFileSync(p.activePath, JSON.stringify(previous));
    const command = vi.fn((_command: string, args: string[]) => {
      if (args.includes('restart')) writeFileSync(join(p.sessionsDir, 'chat.jsonl'), 'candidate write\n');
      if (args.includes('start')) stampBoot(p.bootPath, p.previousVersion);
    });
    await supervisePiActivation(p, {
      command,
      healthy: () => Promise.resolve(existsSync(p.bootPath)),
      sleep: () => Promise.resolve(), now: () => '2026-08-15T00:00:00.000Z', stamp: () => 2,
    });
    expect(JSON.parse(readFileSync(p.activePath, 'utf8'))).toEqual(previous);
    expect(readFileSync(join(p.sessionsDir, 'chat.jsonl'), 'utf8')).toBe('before\n');
    expect(JSON.parse(readFileSync(p.statePath, 'utf8'))).toMatchObject({ phase: 'rolled-back', version: '0.85.0' });
    expect(command).toHaveBeenCalledWith('sudo', ['-n', 'systemctl', 'stop', 'pop-test']);
    expect(command).toHaveBeenCalledWith('sudo', ['-n', 'systemctl', 'start', 'pop-test']);
  });
});
