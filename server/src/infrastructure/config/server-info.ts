import { statfsSync, statSync, readdirSync, lstatSync } from 'node:fs';
import os from 'node:os';
import type { Versions } from './versions.js';

/**
 * Settings → Server (LOTE 6): a read-only snapshot of the machine Pop Agent lives
 * on. Sources are the `os` module, `statfs` on the data directory's
 * partition, and two sizes measured on disk (pop-agent.db, workspace).
 *
 * Everything is best-effort: a field that fails to resolve degrades to
 * `null`/`'unknown'` rather than failing the whole screen, because the
 * screen's job is to answer "is the box okay?" even when something is off.
 *
 * The return type is inferred and matches `ServerInfoResponse` in shared
 * structurally: infrastructure must not import shared (boundary rule), and
 * the interface layer declares the wire type.
 */

export interface ServerInfoDeps {
  dataDir: string;
  workspace: string;
  versions: Versions;
  /** Captured once at boot; HEAD may advance while this process stays old. */
  commit: string;
}

export function readServerInfo(deps: ServerInfoDeps) {
  const disk = safe(() => {
    const stats = statfsSync(deps.dataDir);
    return { total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize };
  });

  return {
    cpu: {
      model: os.cpus()[0]?.model ?? 'unknown',
      cores: os.cpus().length,
      // Load over 1/5/15 minutes, as the kernel reports it.
      load: os.loadavg(),
    },
    memory: { total: os.totalmem(), used: os.totalmem() - os.freemem() },
    disk: disk ?? { total: null, free: null },
    uptimeSeconds: Math.floor(os.uptime()),
    processUptimeSeconds: Math.floor(process.uptime()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    serverTime: new Date().toISOString(),
    nodeVersion: process.version,
    popAgentVersion: deps.versions.popAgentVersion,
    commit: deps.commit === 'unknown' ? deps.commit : deps.commit.slice(0, 7),
    dbBytes: fileSize(`${deps.dataDir}/pop-agent.db`),
    workspaceBytes: dirSize(deps.workspace),
    dataDir: deps.dataDir,
    workspace: deps.workspace,
  };
}

function fileSize(path: string): number | null {
  return safe(() => statSync(path).size);
}

/**
 * Recursive size with lstat: symlinks are counted as their own tiny entry and
 * never followed -- the workspace symlinks node_modules to the dev repo, and
 * following it would double-count a tree that is not ours.
 */
function dirSize(root: string): number | null {
  return safe(() => {
    let total = 0;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = `${dir}/${entry}`;
        const stats = lstatSync(path);
        if (stats.isSymbolicLink()) continue;
        total += stats.size;
        if (stats.isDirectory()) walk(path);
      }
    };
    walk(root);
    return total;
  });
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
