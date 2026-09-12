import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publicReadinessErrors } from './check-public-readiness.js';

const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pop-public-readiness-'));
  roots.push(root);
  const repository = resolve(import.meta.dirname, '..');
  for (const path of [
    'VERSION', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'server-install.sh', 'SECURITY.md',
    'SUPPORT.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'docs/RELEASING.md',
    'deploy/server-toolchain-manifest.tsv', 'deploy/README.md', 'deploy/configure-tailscale.sh',
    'docs/specs/Spec-Pop-Installation.md',
    '.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/ISSUE_TEMPLATE/config.yml',
    '.github/dependabot.yml', 'deploy/local-release.Dockerfile', 'deploy/local-release.sh', 'deploy/local-release-container.sh', 'package.json',
    'shared/package.json', 'server/package.json', 'web/package.json', 'cli/package.json',
    'tools/package.json',
  ]) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(repository, path), target, { recursive: true });
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('public repository readiness', () => {
  it('accepts the reviewed repository publication files', () => {
    expect(publicReadinessErrors(resolve(import.meta.dirname, '..'))).toEqual([]);
  });

  it('rejects missing private vulnerability reporting cutover requirements', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'SECURITY.md'),
      readFileSync(join(root, 'SECURITY.md'), 'utf8').replace('Public launch is blocked until', 'The maintainer may later'),
    );
    writeFileSync(
      join(root, 'docs/RELEASING.md'),
      readFileSync(join(root, 'docs/RELEASING.md'), 'utf8').replace('account without repository access', 'maintainer account'),
    );
    expect(publicReadinessErrors(root)).toEqual(expect.arrayContaining([
      'SECURITY.md does not require verifying private reporting',
      'release runbook does not verify private vulnerability reporting',
    ]));
  });

  it('rejects missing guided clone installation and an unpinned local builder image', () => {
    const root = fixture();
    const readme = readFileSync(join(root, 'README.md'), 'utf8').replaceAll(
      'git clone --depth 1 https://github.com/viniciusbuscacio/pop-agent.git',
      'git clone https://example.invalid/not-pop.git',
    );
    writeFileSync(
      join(root, 'README.md'),
      `${readme}\n\`\`\`sh\ncurl \\\n  https://example.invalid/install |\n  sh\n\`\`\`\n`,
    );
    writeFileSync(
      join(root, 'deploy/local-release.Dockerfile'),
      readFileSync(join(root, 'deploy/local-release.Dockerfile'), 'utf8').replace(
        /ubuntu:24\.04@sha256:[a-f0-9]{64}/,
        'ubuntu:latest',
      ),
    );
    expect(publicReadinessErrors(root)).toEqual(expect.arrayContaining([
      'README lacks the public Git clone command',
      'README.md contains a producer-to-shell installer',
      'Local builder image is not pinned to Ubuntu 24.04 by digest',
    ]));
  });
});
