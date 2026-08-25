import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface Fixture {
  root: string;
  source: string;
  firstCommit: string;
  branchCommit: string;
  destination: string;
  dataDir: string;
  workspace: string;
  handoffLog: string;
  ghLog: string;
  env: NodeJS.ProcessEnv;
}

const script = resolve(import.meta.dirname, '../server-install.sh');
const sourceAcquisitionDocs = [
  resolve(import.meta.dirname, '../deploy/README.md'),
  resolve(import.meta.dirname, '../docs/specs/Spec-Pop-Installation.md'),
  resolve(import.meta.dirname, '../docs/specs/Spec-Pop-Security.md'),
  resolve(import.meta.dirname, '../docs/specs/Spec-Pop-Deployment-and-Operations.md'),
];
const publicInstallDocs = sourceAcquisitionDocs.slice(0, 2);
const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const roots: string[] = [];
const scrubbedVariables = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function executable(path: string, content: string): void {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o755);
}

function git(cwd: string, args: string[]): string {
  return execFileSync(realGit, args, { cwd, encoding: 'utf8' }).trim();
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'pop-server-install-test-'));
  roots.push(root);
  const source = join(root, 'source');
  const fakeBin = join(root, 'fake-bin');
  const handoffLog = join(root, 'handoff.log');
  const handoffFail = join(root, 'handoff-fail');
  mkdirSync(join(source, 'deploy'), { recursive: true });
  mkdirSync(fakeBin);
  writeFileSync(join(source, 'VERSION'), '1.2.3\n');
  writeFileSync(join(source, 'package.json'), '{"name":"pop-agent","version":"1.2.3"}\n');
  writeFileSync(join(source, 'package-lock.json'), '{"name":"pop-agent","version":"1.2.3"}\n');
  writeFileSync(join(source, 'deploy/server-toolchain-manifest.tsv'), 'fixture manifest\n');
  executable(join(source, 'deploy/bootstrap-server.sh'), `#!/bin/sh
{
  printf 'args:'
  printf ' <%s>' "$@"
  printf '\\n'
  for variable in ${scrubbedVariables.join(' ')}; do
    eval "present=\\\${$variable+x}"
    [ -z "$present" ] || printf 'env: <%s>\\n' "$variable"
  done
} > '${handoffLog}'
if [ -f '${handoffFail}' ]; then exit "$(cat '${handoffFail}')"; fi
exit 0
`);
  execFileSync(realGit, ['init', '--quiet', '--initial-branch=main'], { cwd: source });
  execFileSync(realGit, ['config', 'user.name', 'Installer Test'], { cwd: source });
  execFileSync(realGit, ['config', 'user.email', 'installer@example.invalid'], { cwd: source });
  execFileSync(realGit, ['add', '.'], { cwd: source });
  execFileSync(realGit, ['commit', '--quiet', '-m', 'first fixture'], { cwd: source });
  const firstCommit = git(source, ['rev-parse', 'HEAD']);
  execFileSync(realGit, ['tag', 'fixture-tag'], { cwd: source });
  writeFileSync(join(source, 'later'), 'branch state at clone time\n');
  execFileSync(realGit, ['add', '.'], { cwd: source });
  execFileSync(realGit, ['commit', '--quiet', '-m', 'branch fixture'], { cwd: source });
  const branchCommit = git(source, ['rev-parse', 'HEAD']);

  executable(join(fakeBin, 'id'), '#!/bin/sh\ncase "$1" in -u) printf "%s\\n" "${FAKE_UID:-1000}";; -un) printf "installer-test\\n";; *) exit 2;; esac\n');
  executable(join(fakeBin, 'uname'), '#!/bin/sh\ncase "$1" in -s) printf "%s\\n" "${FAKE_UNAME_S:-Linux}";; -m) printf "%s\\n" "${FAKE_UNAME_M:-x86_64}";; *) exit 2;; esac\n');
  executable(join(fakeBin, 'git'), `#!/bin/sh
REAL_GIT='${realGit}'
public=0
is_clone=0
is_checkout=0
destination=
checkout_repo=
previous=
for argument in "$@"; do
  [ "$previous" = -C ] && checkout_repo=$argument
  case $argument in clone) is_clone=1 ;; checkout) is_checkout=1 ;; https://github.com/*) public=1 ;; esac
  destination=$argument
  previous=$argument
done
if [ "$is_clone" -eq 1 ]; then
  if [ "$public" -eq 1 ]; then
    [ "\${FAKE_PUBLIC_CLONE_FAIL:-0}" -eq 0 ] || exit 1
    if [ "\${FAKE_PUBLIC_REQUIRE_CLEAN_ENV:-0}" -eq 1 ]; then
      [ -z "\${GIT_ASKPASS+x}" ] || exit 31
      [ -z "\${SSH_AUTH_SOCK+x}" ] || exit 32
      [ -z "\${GIT_CONFIG_COUNT+x}" ] || exit 33
      [ "\${GIT_CONFIG_NOSYSTEM:-}" = 1 ] || exit 34
      [ "\${GIT_TERMINAL_PROMPT:-}" = 0 ] || exit 35
      [ "\${GCM_INTERACTIVE:-}" = Never ] || exit 36
    fi
    "$REAL_GIT" clone --quiet --no-checkout -- "$SERVER_INSTALL_TEST_SOURCE" "$destination" || exit
    exit 0
  fi
else
  [ -z "\${GIT_CONFIG_GLOBAL+x}" ] || exit 41
  [ -z "\${GIT_CONFIG_SYSTEM+x}" ] || exit 42
  [ -z "\${XDG_CONFIG_HOME+x}" ] || exit 43
  [ -z "\${GIT_CONFIG_COUNT+x}" ] || exit 44
  [ -z "\${GIT_CONFIG_PARAMETERS+x}" ] || exit 45
fi
if [ "$is_checkout" -eq 1 ] && [ -n "$checkout_repo" ]; then
  "$REAL_GIT" "$@" || exit
  mode=$(cat "$checkout_repo/.git/fake-clone-mode" 2>/dev/null || true)
  case $mode in
    incomplete) rm -f "$checkout_repo/deploy/bootstrap-server.sh" ;;
    escaping-symlink)
      rm -f "$checkout_repo/deploy/bootstrap-server.sh"
      ln -s '${join(root, 'outside-bootstrap.sh')}' "$checkout_repo/deploy/bootstrap-server.sh"
      ;;
    manifest-symlink)
      rm -f "$checkout_repo/deploy/server-toolchain-manifest.tsv"
      ln -s '${join(root, 'outside-manifest.tsv')}' "$checkout_repo/deploy/server-toolchain-manifest.tsv"
      ;;
  esac
  exit 0
fi
exec "$REAL_GIT" "$@"
`);
  executable(join(fakeBin, 'gh'), `#!/bin/sh
printf 'args:' >> "$SERVER_INSTALL_TEST_GH_LOG"
printf ' <%s>' "$@" >> "$SERVER_INSTALL_TEST_GH_LOG"
printf '\\n' >> "$SERVER_INSTALL_TEST_GH_LOG"
case $1 in
  auth) [ "\${FAKE_GH_AUTH:-ok}" = ok ] ;;
  api)
    [ "\${FAKE_API_FAIL:-0}" -eq 0 ] || exit 1
    for argument in "$@"; do
      case $argument in repos/*/commits/*) commit=\${argument##*/} ;; esac
    done
    if [ "\${FAKE_API_MISMATCH:-0}" -eq 1 ]; then
      printf '%040d\\n' 0
    else
      printf '%s\\n' "$commit"
    fi
    ;;
  repo)
    [ "$2" = clone ] || exit 2
    git clone --quiet --no-checkout -- "$SERVER_INSTALL_TEST_SOURCE" "$4" || exit
    case \${FAKE_CLONE_MODE:-complete} in
      dirty) printf 'dirty\\n' > "$4/untracked" ;;
      incomplete|escaping-symlink|manifest-symlink)
        printf '%s\n' "\${FAKE_CLONE_MODE}" > "$4/.git/fake-clone-mode"
        ;;
    esac
    if [ "\${FAKE_ADVANCE_AFTER_CLONE:-0}" -eq 1 ]; then
      printf 'advanced after clone\\n' > "$SERVER_INSTALL_TEST_SOURCE/advanced-after-clone"
      git -C "$SERVER_INSTALL_TEST_SOURCE" add advanced-after-clone
      git -C "$SERVER_INSTALL_TEST_SOURCE" commit --quiet -m 'advance mutable branch'
    fi
    ;;
  *) exit 2 ;;
esac
`);

  const ghLog = join(root, 'gh.log');
  const externalBootstrap = join(root, 'outside-bootstrap.sh');
  executable(externalBootstrap, '#!/bin/sh\nexit 0\n');
  const externalManifest = join(root, 'outside-manifest.tsv');
  writeFileSync(externalManifest, 'outside manifest\n');
  return {
    root,
    source,
    firstCommit,
    branchCommit,
    destination: join(root, 'installed/pop-agent'),
    dataDir: join(root, 'data'),
    workspace: join(root, 'workspace'),
    handoffLog,
    ghLog,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      HOME: join(root, 'home'),
      LANG: 'C.UTF-8',
      SERVER_INSTALL_TEST_SOURCE: source,
      SERVER_INSTALL_TEST_HANDOFF_LOG: handoffLog,
      SERVER_INSTALL_TEST_GH_LOG: ghLog,
      SERVER_INSTALL_TEST_EXTERNAL_BOOTSTRAP: externalBootstrap,
      SERVER_INSTALL_TEST_EXTERNAL_MANIFEST: externalManifest,
    },
  };
}

function installerArgs(input: Fixture, extra: string[] = []): string[] {
  return [
    '--destination', input.destination,
    '--data-dir', input.dataDir,
    '--workspace', input.workspace,
    ...extra,
  ];
}

function run(input: Fixture, extra: string[] = [], env: NodeJS.ProcessEnv = input.env) {
  return spawnSync(script, installerArgs(input, extra), { encoding: 'utf8', env });
}

function runAsDownloadedFile(input: Fixture, extra: string[] = [], env: NodeJS.ProcessEnv = input.env) {
  return spawnSync('sh', [script, ...installerArgs(input, extra)], { encoding: 'utf8', env });
}

describe('GitHub fresh-server installer', () => {
  it('presents publication-ready public and optional authenticated acquisition help', () => {
    const result = spawnSync('sh', [script, '--help'], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Public repositories require only Git');
    expect(result.stdout).toContain('authenticated GitHub CLI session is optional');
    expect(result.stdout).toContain('Neither path accepts a token argument');
    expect(result.stdout).not.toMatch(/current[- ]private|future[- ]public/i);
  });

  it('keeps public installation docs pinned, fail-closed, and free of transitional wording', () => {
    const version = readFileSync(resolve(import.meta.dirname, '../VERSION'), 'utf8').trim();
    const transitionalWording = /current[- ]private|future[- ]public|repository becomes public|once the repository is public/i;

    for (const path of sourceAcquisitionDocs) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(transitionalWording);
    }
    for (const path of publicInstallDocs) {
      const documentation = readFileSync(path, 'utf8');
      expect(documentation, path).toContain(`/v${version}/server-install.sh`);
      expect(documentation, path).toContain(`&& sh "$file" --ref v${version}`);
      expect(documentation, path).toContain('mktemp "${TMPDIR:-/tmp}/pop-server-install.XXXXXX"');
      expect(documentation, path).not.toMatch(/curl[^\n|]*\|\s*(?:sh|bash)/);
    }
  });

  it('runs from a downloaded file with options and forwards the documented defaults', () => {
    const input = createFixture();
    const result = runAsDownloadedFile(input, ['--prepare-only']);
    expect(result.status, result.stderr).toBe(0);
    expect(git(input.destination, ['rev-parse', 'HEAD'])).toBe(input.branchCommit);
    expect(readFileSync(input.handoffLog, 'utf8')).toBe(
      `args: <--checkout> <${input.destination}> <--data-dir> <${input.dataDir}>`
      + ` <--workspace> <${input.workspace}> <--port> <8787>`
      + ' <--install-apt-packages> <--prepare-only>\n',
    );
  });

  it('uses authenticated gh API and clone, then forwards explicit handoff arguments', () => {
    const input = createFixture();
    const result = run(input, [
      '--repo', 'operator/private-pop',
      '--ref', 'fixture-tag',
      '--port', '9123',
      '--prepare-only',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(git(input.destination, ['rev-parse', 'HEAD'])).toBe(input.firstCommit);
    expect(git(input.destination, ['status', '--porcelain=v1'])).toBe('');

    const ghLog = readFileSync(input.ghLog, 'utf8');
    expect(ghLog).toContain('<auth> <status> <--hostname> <github.com>');
    expect(ghLog).toContain('<repo> <clone> <operator/private-pop>');
    expect(ghLog).toContain(`<repos/operator/private-pop/commits/${input.firstCommit}>`);
    expect(readFileSync(input.handoffLog, 'utf8')).toContain('<--port> <9123> <--install-apt-packages> <--prepare-only>');
  });

  it('pins the clone snapshot when a mutable branch advances and supports explicit commits', () => {
    const branch = createFixture();
    const branchResult = run(branch, ['--ref', 'main'], { ...branch.env, FAKE_ADVANCE_AFTER_CLONE: '1' });
    expect(branchResult.status, branchResult.stderr).toBe(0);
    expect(git(branch.destination, ['rev-parse', 'HEAD'])).toBe(branch.branchCommit);
    expect(git(branch.source, ['rev-parse', 'HEAD'])).not.toBe(branch.branchCommit);

    const commit = createFixture();
    const commitResult = run(commit, ['--ref', commit.firstCommit]);
    expect(commitResult.status, commitResult.stderr).toBe(0);
    expect(git(commit.destination, ['rev-parse', 'HEAD'])).toBe(commit.firstCommit);
  });

  it('rejects a ref shared by a branch and tag instead of shadowing the tag', () => {
    const input = createFixture();
    execFileSync(realGit, ['branch', 'v1.2.3', input.branchCommit], { cwd: input.source });
    execFileSync(realGit, ['tag', 'v1.2.3', input.firstCommit], { cwd: input.source });

    const result = run(input, ['--ref', 'v1.2.3']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ref 'v1.2.3' is ambiguous: both a branch and tag exist");
    expect(existsSync(input.destination)).toBe(false);
  });

  it('uses isolated non-interactive public HTTPS Git when gh is absent or unauthenticated', () => {
    const absent = createFixture();
    const noGhBin = join(absent.root, 'no-gh-bin');
    mkdirSync(noGhBin);
    symlinkSync(join(absent.root, 'fake-bin/git'), join(noGhBin, 'git'));
    const absentResult = run(absent, ['--ref', 'fixture-tag'], {
      ...absent.env,
      PATH: `${noGhBin}:/usr/bin:/bin`,
    });
    expect(absentResult.status, absentResult.stderr).toBe(0);
    expect(git(absent.destination, ['rev-parse', 'HEAD'])).toBe(absent.firstCommit);
    expect(absentResult.stdout).toContain('over public HTTPS Git');

    const unauthenticated = createFixture();
    const injectedGlobal = join(unauthenticated.root, 'injected-global-gitconfig');
    const injectedXdg = join(unauthenticated.root, 'injected-xdg');
    mkdirSync(join(injectedXdg, 'git'), { recursive: true });
    writeFileSync(injectedGlobal, '[http]\n\tsslVerify = false\n');
    writeFileSync(join(injectedXdg, 'git/config'), '[url "file:///credential-source/"]\n\tinsteadOf = https://github.com/\n');
    const unauthenticatedResult = run(unauthenticated, [], {
      ...unauthenticated.env,
      FAKE_GH_AUTH: 'denied',
      FAKE_PUBLIC_REQUIRE_CLEAN_ENV: '1',
      GIT_ASKPASS: '/credential/askpass',
      SSH_AUTH_SOCK: '/credential/agent.sock',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: 'credential-helper',
      GIT_CONFIG_GLOBAL: injectedGlobal,
      GIT_CONFIG_SYSTEM: injectedGlobal,
      XDG_CONFIG_HOME: injectedXdg,
    });
    expect(unauthenticatedResult.status, unauthenticatedResult.stderr).toBe(0);
    expect(git(unauthenticated.destination, ['rev-parse', 'HEAD'])).toBe(unauthenticated.branchCommit);
  });

  it('makes a public HTTPS access failure actionable for private repositories', () => {
    const input = createFixture();
    const result = run(input, [], {
      ...input.env,
      FAKE_GH_AUTH: 'denied',
      FAKE_PUBLIC_CLONE_FAIL: '1',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('verify repository access');
    expect(result.stderr).toContain("install GitHub CLI, run 'gh auth login', and retry");
    expect(existsSync(input.destination)).toBe(false);
  });

  it('disables apt forwarding only when explicitly requested', () => {
    const input = createFixture();
    const result = run(input, ['--no-install-apt-packages', '--prepare-only']);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(input.handoffLog, 'utf8')).not.toContain('--install-apt-packages');
    expect(readFileSync(input.handoffLog, 'utf8')).toContain('<--prepare-only>');
  });

  it('scrubs token, askpass, and SSH-agent environment variables before handoff', () => {
    const input = createFixture();
    const credentialEnvironment = Object.fromEntries(scrubbedVariables.map((name) => [name, `secret-${name}`]));
    const result = run(input, [], { ...input.env, ...credentialEnvironment });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(input.handoffLog, 'utf8')).not.toContain('env:');
  });

  it('preserves checkout and prints the exact bootstrap retry after downstream failure', () => {
    const input = createFixture();
    writeFileSync(join(input.root, 'handoff-fail'), '23\n');
    const result = run(input, ['--prepare-only']);
    expect(result.status).toBe(23);
    expect(existsSync(input.destination)).toBe(true);
    expect(git(input.destination, ['rev-parse', 'HEAD'])).toBe(input.branchCommit);
    expect(readdirSync(dirname(input.destination)).filter((name) => name.startsWith('.staging-'))).toEqual([]);
    const expectedRetry = `  env -i HOME='${input.env.HOME}' USER='installer-test' LOGNAME='installer-test'`
      + " PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' LANG='C.UTF-8'"
      + ` '${input.destination}/deploy/bootstrap-server.sh'`
      + ` '--checkout' '${input.destination}' '--data-dir' '${input.dataDir}'`
      + ` '--workspace' '${input.workspace}' '--port' '8787'`
      + " '--install-apt-packages' '--prepare-only'";
    expect(result.stderr).toContain('the verified checkout was preserved');
    expect(result.stderr).toContain('acquisition command refuses the existing destination');
    expect(result.stderr).toContain(expectedRetry);

    const rerun = run(input);
    expect(rerun.status).not.toBe(0);
    expect(rerun.stderr).toContain('acquisition command refuses to overwrite or reuse it');
  });

  it('refuses root, unsupported platforms, missing Git, and API mismatch', () => {
    const root = createFixture();
    expect(run(root, [], { ...root.env, FAKE_UID: '0' }).stderr).toContain('refusing to run as root');

    const platform = createFixture();
    expect(run(platform, [], { ...platform.env, FAKE_UNAME_S: 'Darwin' }).stderr)
      .toContain('only Ubuntu/Debian Linux is supported');

    const missingGit = createFixture();
    const emptyBin = join(missingGit.root, 'empty-bin');
    mkdirSync(emptyBin);
    executable(join(emptyBin, 'id'), '#!/bin/sh\nprintf "1000\\n"\n');
    executable(join(emptyBin, 'uname'), '#!/bin/sh\n[ "$1" = -s ] && printf "Linux\\n" || printf "x86_64\\n"\n');
    expect(run(missingGit, [], { ...missingGit.env, PATH: emptyBin }).stderr)
      .toContain('required command not found: git');

    const mismatch = createFixture();
    const mismatchResult = run(mismatch, [], { ...mismatch.env, FAKE_API_MISMATCH: '1' });
    expect(mismatchResult.status).not.toBe(0);
    expect(mismatchResult.stderr).toContain('API returned a different commit');
  });

  it('refuses unsafe, overlapping, existing, and insecure destination parents', () => {
    const unsafe = createFixture();
    unsafe.destination = `${unsafe.root}/parent/../pop-agent`;
    expect(run(unsafe).stderr).toContain('unsafe path');

    const overlapping = createFixture();
    overlapping.dataDir = join(overlapping.destination, 'data');
    expect(run(overlapping).stderr).toContain('outside the replaceable checkout');

    const linkedParent = createFixture();
    mkdirSync(linkedParent.dataDir);
    const alias = join(linkedParent.root, 'data-alias');
    symlinkSync(linkedParent.dataDir, alias);
    linkedParent.destination = join(alias, 'pop-agent');
    expect(run(linkedParent).stderr).toContain('outside the replaceable checkout');

    const existing = createFixture();
    mkdirSync(existing.destination, { recursive: true });
    expect(run(existing).stderr).toContain('acquisition command refuses to overwrite or reuse it');

    const writable = createFixture();
    mkdirSync(dirname(writable.destination), { recursive: true });
    chmodSync(dirname(writable.destination), 0o770);
    expect(run(writable).stderr).toContain('must not be group- or world-writable');

    const unsafeAncestor = createFixture();
    const writableAncestor = join(unsafeAncestor.root, 'writable-ancestor');
    const secureParent = join(writableAncestor, 'secure-parent');
    mkdirSync(secureParent, { recursive: true });
    chmodSync(writableAncestor, 0o770);
    chmodSync(secureParent, 0o700);
    unsafeAncestor.destination = join(secureParent, 'pop-agent');
    expect(run(unsafeAncestor).stderr).toContain('destination ancestors must not be group- or world-writable');

    const wrongOwner = createFixture();
    expect(run(wrongOwner, [], { ...wrongOwner.env, FAKE_UID: '1234' }).stderr)
      .toContain('must be owned by invoking uid 1234');
  });

  it('rejects dirty, incomplete, and escaping-symlink checkouts before activation', () => {
    const dirty = createFixture();
    const dirtyResult = run(dirty, [], { ...dirty.env, FAKE_CLONE_MODE: 'dirty' });
    expect(dirtyResult.status).not.toBe(0);
    expect(dirtyResult.stderr).toContain('acquired checkout is not clean');
    expect(existsSync(dirty.destination)).toBe(false);

    const incomplete = createFixture();
    const incompleteResult = run(incomplete, [], { ...incomplete.env, FAKE_CLONE_MODE: 'incomplete' });
    expect(incompleteResult.status).not.toBe(0);
    expect(incompleteResult.stderr).toContain('required file must be regular and not a symlink');
    expect(existsSync(incomplete.destination)).toBe(false);

    const escaping = createFixture();
    const escapingResult = run(escaping, [], { ...escaping.env, FAKE_CLONE_MODE: 'escaping-symlink' });
    expect(escapingResult.status).not.toBe(0);
    expect(escapingResult.stderr).toContain('required file must be regular and not a symlink');
    expect(existsSync(escaping.destination)).toBe(false);

    const manifest = createFixture();
    const manifestResult = run(manifest, [], { ...manifest.env, FAKE_CLONE_MODE: 'manifest-symlink' });
    expect(manifestResult.status).not.toBe(0);
    expect(manifestResult.stderr).toContain('server-toolchain-manifest.tsv');
    expect(manifestResult.stderr).toContain('must be regular and not a symlink');
    expect(existsSync(manifest.destination)).toBe(false);
  });
});
