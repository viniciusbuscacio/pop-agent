/**
 * Builds the tarball the server hands out through `/cli-latest.tgz` and the
 * immutable `/cli-X.Y.Z.tgz` release URLs (docs/cli.md, Distribution).
 *
 * The rule, stated generally so it survives the CLI growing into `shared`:
 * **every `@pop-agent/*` import is bundled into `dist/`, and the public
 * dependencies stay external.** `npm pack` alone cannot produce an
 * installable tarball, and the failure is not subtle:
 *
 *     npm error 404 '@pop-agent/shared@*' is not in this registry
 *
 * A workspace dependency has no meaning outside the monorepo. Inlining the
 * three string constants the CLI uses today would also work, and would have
 * to be redone the moment anything larger moves into `shared` -- the
 * StreamEvent reducer is already a candidate. Bundling costs the same today
 * and nothing later.
 *
 * What stays external is what a user can actually install: `pi-tui` (which
 * brings `marked`) and `ws`. They are real packages on the public registry,
 * they carry prebuilt binaries per platform, and bundling them would both
 * defeat that and hide which versions are in play.
 *
 * ESM with a `createRequire` banner, not plain ESM and not CJS: a dependency
 * reaches for `require` at runtime, which plain ESM does not have, and the
 * CLI's own code uses `import.meta`, which CJS does not have.
 *
 * The shebang is fixed up AFTER the build rather than written into the
 * banner. esbuild hoists the entry file's own shebang above whatever the
 * banner says, so putting one there produces two -- and Node reads the second
 * as source, which fails with `SyntaxError: Invalid or unexpected token` on a
 * file that looks perfectly fine. Normalising once here holds whether or not
 * the entry keeps its shebang.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { prepareCliPackDirectory, publishCliArchive } from './cli-pack-files.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, 'cli');
/** Where the staged package is assembled, and where the .tgz lands. */
const out = join(cli, 'pack');

interface PackageJson {
  version: string;
  dependencies?: Record<string, string>;
}

const read = (path: string): PackageJson => JSON.parse(readFileSync(path, 'utf8')) as PackageJson;

async function main(): Promise<void> {
  const cliPkg = read(join(cli, 'package.json'));
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();

  // This invocation packs the checkout's product version. Previously packed
  // CLI releases remain immutable and available while package.json selects
  // this release for the manifest and latest alias.
  const external = ['@earendil-works/pi-tui', 'ws'];
  const dependencies = Object.fromEntries(
    external.map((name) => {
      const range = cliPkg.dependencies?.[name];
      if (range === undefined) throw new Error(`cli/package.json does not depend on ${name}`);
      return [name, range];
    }),
  );

  prepareCliPackDirectory(out);
  mkdirSync(join(out, 'dist'), { recursive: true });

  const result = await build({
    entryPoints: [join(cli, 'src', 'main.ts')],
    outfile: join(out, 'dist', 'main.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external,
    banner: {
      js: [
        "import { createRequire as __popAgentRequire } from 'node:module';",
        'const require = __popAgentRequire(import.meta.url);',
      ].join('\n'),
    },
    metafile: true,
    logLevel: 'warning',
  });

  // Loud on purpose: a workspace dependency that survives into the tarball is
  // the exact failure this script exists to prevent, and it would only show
  // up on someone else's machine at install time.
  const leaked = Object.keys(result.metafile.inputs).filter((input) =>
    input.includes('node_modules/@pop-agent/'),
  );
  if (leaked.length > 0) throw new Error(`@pop-agent/* left unbundled: ${leaked.join(', ')}`);

  // Exactly one shebang, on the first line, whatever esbuild left behind.
  const bundlePath = join(out, 'dist', 'main.js');
  const body = readFileSync(bundlePath, 'utf8').replace(/^(?:#![^\n]*\n)+/, '');
  writeFileSync(bundlePath, `#!/usr/bin/env node\n${body}`);

  writeFileSync(
    join(out, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pop-agent',
        version,
        description: 'The Pop Agent terminal client',
        license: 'MIT',
        type: 'module',
        engines: { node: '>=22.19.0' },
        bin: { pop: './dist/main.js' },
        files: ['dist'],
        dependencies,
      },
      undefined,
      2,
    )}\n`,
  );

  execFileSync('npm', ['pack', '--pack-destination', out], { cwd: out, stdio: 'inherit' });

  // npm names it pop-agent-X.Y.Z.tgz. Publish it under an immutable URL
  // without replacing historical releases, even when packaging is rerun.
  const served = publishCliArchive(out, version);

  const launcherSource = readFileSync(join(root, 'launcher', 'main.go'), 'utf8');
  const launcherVersion = /const launcherVersion = "([^"]+)"/.exec(launcherSource)?.[1];
  if (launcherVersion === undefined) throw new Error('launcher version constant was not found');
  const launcherOut = join(out, 'launcher');
  mkdirSync(launcherOut, { recursive: true });
  const launcherArtifacts: Record<string, { file: string; size: number; sha256: string }> = {};
  for (const target of [
    ['darwin', 'arm64'],
    ['darwin', 'amd64'],
    ['linux', 'arm64'],
    ['linux', 'amd64'],
    ['windows', 'arm64'],
    ['windows', 'amd64'],
  ] as const) {
    const [os, arch] = target;
    const suffix = os === 'windows' ? '.exe' : '';
    const file = `pop-launcher-${launcherVersion}-${os}-${arch}${suffix}`;
    const path = join(launcherOut, file);
    execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', path, '.'], {
      cwd: join(root, 'launcher'),
      env: { ...process.env, CGO_ENABLED: '0', GOOS: os, GOARCH: arch },
      stdio: 'inherit',
    });
    const bytes = readFileSync(path);
    launcherArtifacts[`${os}-${arch}`] = {
      file,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  writeFileSync(
    join(launcherOut, 'manifest.json'),
    `${JSON.stringify({ version: launcherVersion, artifacts: launcherArtifacts }, undefined, 2)}\n`,
  );

  const localAccessOut = join(out, 'local-access');
  mkdirSync(localAccessOut, { recursive: true });
  const localAccessArtifacts: Record<string, { file: string; size: number; sha256: string }> = {};
  const trayTargets: [string, string][] = [['windows', 'amd64']];
  if (process.platform === 'darwin') trayTargets.push(['darwin', process.arch === 'arm64' ? 'arm64' : 'amd64']);
  for (const [os, arch] of trayTargets) {
    const suffix = os === 'windows' ? '.exe' : '';
    const file = `pop-local-access-${version}-${os}-${arch}${suffix}`;
    const path = join(localAccessOut, file);
    execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', path, '.'], {
      cwd: join(root, 'local-access', 'tray'),
      env: { ...process.env, CGO_ENABLED: os === 'windows' ? '0' : '1', GOOS: os, GOARCH: arch },
      stdio: 'inherit',
    });
    const bytes = readFileSync(path);
    localAccessArtifacts[`${os}-${arch}`] = {
      file,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  writeFileSync(
    join(localAccessOut, 'manifest.json'),
    `${JSON.stringify({ version, artifacts: localAccessArtifacts }, undefined, 2)}\n`,
  );

  process.stdout.write(`packed ${served}, Pop launcher ${launcherVersion}, and Pop Local Access ${version}\n`);
}

await main();
