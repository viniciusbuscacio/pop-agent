import { spawn } from 'node:child_process';

/**
 * Replaces the globally installed CLI with the tarball served by this Pop
 * Agent instance. Arguments are passed directly to npm rather than through a
 * shell, so a server URL can never become shell syntax.
 */
export function installCli(packageUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '--global', packageUrl], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve(code ?? (signal === null ? 1 : 128));
    });
  });
}
