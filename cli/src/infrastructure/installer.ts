import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

export interface NpmInvocation {
  command: string;
  args: string[];
}

/**
 * Selects an npm entrypoint without invoking a shell.
 *
 * Windows cannot execute npm.cmd directly through spawn({ shell: false });
 * Node reports EINVAL before creating the child. npm ships its JavaScript
 * entrypoint beside node.exe, so execute that with the current Node runtime.
 * Unix keeps resolving the ordinary npm executable from PATH.
 */
export function npmInvocation(
  platform: NodeJS.Platform = process.platform,
  nodeExecutable: string = process.execPath,
): NpmInvocation {
  if (platform !== 'win32') return { command: 'npm', args: [] };
  return {
    command: nodeExecutable,
    args: [win32.join(win32.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js')],
  };
}

/**
 * Replaces the globally installed CLI with the tarball served by this Pop
 * Agent instance. Arguments are passed directly to npm rather than through a
 * shell, so a server URL can never become shell syntax.
 */
export function installCli(packageUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const npm = npmInvocation();
    const child = spawn(npm.command, [...npm.args, 'install', '--global', packageUrl], {
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve(code ?? (signal === null ? 1 : 128));
    });
  });
}
