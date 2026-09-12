import { spawn } from 'node:child_process';
import type { ServiceControl } from '../../application/ports/service-control.js';

/**
 * Settings → Server danger zone (LOTE 6): restart/stop of the systemd unit
 * Pop Agent runs as.
 *
 * The command is scheduled, not run inline: the HTTP answer must leave the
 * process before systemd kills it, or the client sees a dropped connection
 * instead of a confirmation. The child is detached and unref'd so it
 * survives its parent for the fraction of a second it needs to fire.
 *
 * `sudo -n` never prompts: either the operator granted passwordless
 * systemctl for this unit (the documented setup) or the call fails quietly
 * into the journal, which is where a failed restart belongs.
 */

/** Let the response flush before the process dies. */
const DELAY_MS = 750;

export function createSystemdControl(
  serviceName: string,
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
  },
): ServiceControl {
  const run = (action: 'restart' | 'stop'): void => {
    schedule(() => {
      const child = spawn('sudo', ['-n', 'systemctl', action, serviceName], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }, DELAY_MS);
  };

  return {
    restart: () => run('restart'),
    stop: () => run('stop'),
  };
}

/**
 * The control a disposable instance wires (POP_AGENT_SERVICE_CONTROL=fake): the
 * danger zone can be clicked end-to-end and nothing on the host is touched.
 * A validation run must never be able to restart the real service.
 */
export function createFakeServiceControl(log: (line: string) => void = console.warn): ServiceControl {
  return {
    restart: () => log('pop service-control(fake): restart requested'),
    stop: () => log('pop service-control(fake): stop requested'),
  };
}
