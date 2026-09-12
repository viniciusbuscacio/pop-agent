import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createServerOnboarding,
  JsonServerOnboardingRepo,
  rotateServerOnboardingCode,
} from './onboarding-state-file.js';

describe('server onboarding state file', () => {
  it('stores only owner-readable digests and rotates a still-pending code', () => {
    const root = mkdtempSync(join(tmpdir(), 'pop-onboarding-state-'));
    const path = join(root, 'server-onboarding.json');
    const repo = new JsonServerOnboardingRepo(path);
    const first = createServerOnboarding(repo, 1_700_000_000_000);

    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain(first.code);
    expect(raw).not.toContain(first.code.replaceAll('-', ''));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(repo.read()).toMatchObject({ phase: 'pairing', failedAttempts: 0 });

    const next = rotateServerOnboardingCode(repo, 1_700_000_100_000);
    expect(next?.code).not.toBe(first.code);
    expect(repo.read()?.tokenDigest).toBeUndefined();

    repo.write({ ...repo.read()!, phase: 'secure', secureUrl: 'https://pop.example.ts.net' });
    expect(rotateServerOnboardingCode(repo, 1_700_000_200_000)).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });
});
