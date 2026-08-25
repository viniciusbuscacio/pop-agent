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
    'deploy/server-toolchain-manifest.tsv', 'deploy/README.md',
    'docs/specs/Spec-Pop-Installation.md',
    '.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/ISSUE_TEMPLATE/config.yml',
    '.github/dependabot.yml', '.github/workflows/ci.yml', 'package.json',
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

  it('rejects a mutable installer and unpinned GitHub Action', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'README.md'),
      `${readFileSync(join(root, 'README.md'), 'utf8').replace('version=v0.2.41', 'version=main')}\n\`\`\`sh\ncurl \\\n  https://example.invalid/install |\n  sh\n\`\`\`\n`,
    );
    writeFileSync(
      join(root, '.github/workflows/ci.yml'),
      readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8').replace(
        /actions\/checkout@[0-9a-f]{40}/,
        'actions/checkout@v4',
      ),
    );
    expect(publicReadinessErrors(root)).toEqual(expect.arrayContaining([
      'README installer is not pinned to v0.2.41',
      'README.md contains a producer-to-shell installer',
      expect.stringContaining('CI action is not pinned to a full commit'),
    ]));
  });
});
