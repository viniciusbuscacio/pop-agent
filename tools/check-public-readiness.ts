import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageMetadata {
  license?: unknown;
  repository?: unknown;
  homepage?: unknown;
  bugs?: unknown;
}

const REQUIRED_FILES = [
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  'server-install.sh',
  'SECURITY.md',
  'SUPPORT.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'docs/RELEASING.md',
  'docs/specs/Spec-Pop-Installation.md',
  'deploy/README.md',
  'deploy/configure-tailscale.sh',
  'deploy/server-toolchain-manifest.tsv',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/dependabot.yml',
  'deploy/local-release.Dockerfile',
  'deploy/local-release.sh',
  'deploy/local-release-container.sh',
] as const;

const PACKAGE_FILES = [
  'package.json',
  'shared/package.json',
  'server/package.json',
  'web/package.json',
  'cli/package.json',
  'tools/package.json',
] as const;

function hasProducerToShellPipeline(markdown: string): boolean {
  for (const match of markdown.matchAll(/```(?:sh|bash)\s*\n([\s\S]*?)```/gi)) {
    const command = (match[1] ?? '').replace(/\\\r?\n/g, ' ').replace(/\s+/g, ' ');
    if (/\bcurl\b[^|]*\|\s*(?:sh|bash)\b/i.test(command)) return true;
  }
  return false;
}

export function publicReadinessErrors(root: string): string[] {
  const errors: string[] = [];
  const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8');

  for (const relative of REQUIRED_FILES) {
    if (!existsSync(resolve(root, relative))) errors.push(`missing ${relative}`);
  }
  if (errors.length > 0) return errors;

  const readme = read('README.md');
  const security = read('SECURITY.md');
  const builder = read('deploy/local-release.Dockerfile');
  const localRelease = read('deploy/local-release.sh');
  const containerBuild = read('deploy/local-release-container.sh');
  const releasing = read('docs/RELEASING.md');
  const installer = read('server-install.sh');

  if (!readme.includes('git clone --depth 1 https://github.com/viniciusbuscacio/pop-agent.git')) {
    errors.push('README lacks the public Git clone command');
  }
  if (!readme.includes('./deploy/bootstrap-server.sh --install-apt-packages')) {
    errors.push('README lacks the guided Ubuntu bootstrap command');
  }
  for (const relative of ['README.md', 'deploy/README.md', 'docs/specs/Spec-Pop-Installation.md']) {
    if (hasProducerToShellPipeline(read(relative))) {
      errors.push(`${relative} contains a producer-to-shell installer`);
    }
  }
  if (!/Do \*\*not\*\*\s+expose port 8787\s+directly\./.test(readme)) errors.push('README lacks the loopback exposure warning');
  if (!security.includes('/security/advisories/new')) errors.push('SECURITY.md lacks private vulnerability reporting');
  if (!security.includes('Public launch is blocked until')) errors.push('SECURITY.md does not require verifying private reporting');
  if (!security.includes('Never include passwords')) errors.push('SECURITY.md lacks public-report secret guidance');
  if (!releasing.includes('Public visibility cutover (separate owner action)')) {
    errors.push('release runbook does not separate visibility publication');
  }
  if (!releasing.includes('account without repository access')) {
    errors.push('release runbook does not verify private vulnerability reporting');
  }
  if (!releasing.includes('server_release="$release_root/server/pop-agent-$version-$commit"')) {
    errors.push('release runbook does not stage the nested server release output');
  }
  if (!installer.includes("both a branch and tag exist")) {
    errors.push('installer does not reject branch/tag ambiguity');
  }

  if (!/^FROM ubuntu:24\.04@sha256:[a-f0-9]{64}$/m.test(builder)) errors.push('Local builder image is not pinned to Ubuntu 24.04 by digest');
  if (!localRelease.includes('--cpus=2 --memory=4g')) errors.push('Local builder lacks resource limits');
  if (!containerBuild.includes('--prepare-only --build-from-source')) errors.push('Local builder does not use pinned toolchain preparation');
  if (!containerBuild.includes('npm run gate')) errors.push('Local builder does not enforce the full publication gate');

  const repositoryUrl = 'git+https://github.com/viniciusbuscacio/pop-agent.git';
  const homepageUrl = 'https://github.com/viniciusbuscacio/pop-agent#readme';
  const issuesUrl = 'https://github.com/viniciusbuscacio/pop-agent/issues';
  for (const relative of PACKAGE_FILES) {
    const metadata = JSON.parse(read(relative)) as PackageMetadata;
    if (metadata.license !== 'MIT') errors.push(`${relative} does not declare the MIT license`);
    const repository = metadata.repository as { url?: unknown } | undefined;
    if (repository?.url !== repositoryUrl) errors.push(`${relative} has incorrect repository metadata`);
    if (metadata.homepage !== homepageUrl) errors.push(`${relative} has incorrect homepage metadata`);
    const bugs = metadata.bugs as { url?: unknown } | undefined;
    if (bugs?.url !== issuesUrl) errors.push(`${relative} has incorrect issue metadata`);
  }

  return errors;
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const errors = publicReadinessErrors(root);
  if (errors.length > 0) {
    console.error(`Public readiness check failed:\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('Public repository readiness check passed.');
  }
}
