import { describe, expect, it } from 'vitest';
import { StorageService } from './storage-service.js';
import type { DiskUsage } from '../ports/disk-usage.js';
import type { StorageRepo } from '../ports/storage-repo.js';

function service(options: {
  dirs?: Record<string, { bytes: number; files: number }>;
  files?: Record<string, number>;
  repo?: Partial<ReturnType<StorageRepo['totals']>>;
}) {
  const dirs = options.dirs ?? {};
  const files = options.files ?? {};
  const disk: DiskUsage = {
    directoryBytes: (dir) => dirs[dir] ?? { bytes: 0, files: 0 },
    fileBytes: (...paths) => paths.reduce((sum, path) => sum + (files[path] ?? 0), 0),
    space: () => ({ freeBytes: 50, totalBytes: 100 }),
  };
  const repo: StorageRepo = {
    totals: () => ({
      index: { bytes: 0, count: 0 },
      ...options.repo,
    }),
  };
  return new StorageService({
    repo,
    disk,
    dataDir: '/data',
    filesDir: '/data/files',
    workspace: '/work',
    backupsDir: '/backups',
    modelDirs: ['/data/voice-models'],
  });
}

function bytesOf(report: ReturnType<StorageService['report']>, key: string): number {
  return report.entries.find((entry) => entry.key === key)?.bytes ?? 0;
}

describe('StorageService', () => {
  it('measures the Files folder on disk, exactly as the tab shows it', () => {
    const report = service({
      dirs: { '/data/files': { bytes: 600, files: 3 } },
    }).report();

    expect(bytesOf(report, 'files')).toBe(600);
    expect(report.entries.find((entry) => entry.key === 'files')?.count).toBe(3);
  });

  it('counts what is left of the data directory as other, without the parts already named', () => {
    const report = service({
      dirs: {
        '/data': { bytes: 5000, files: 40 },
        '/data/files': { bytes: 1000, files: 7 },
        '/data/voice-models': { bytes: 2000, files: 2 },
      },
      files: { '/data/pop-agent.db': 500, '/data/pop-agent.db-wal': 200 },
    }).report();

    expect(bytesOf(report, 'database')).toBe(700);
    expect(bytesOf(report, 'models')).toBe(2000);
    expect(bytesOf(report, 'other')).toBe(1300);
  });

  it('gives downloaded weights their own line instead of burying them in other', () => {
    // The first real install measured: 1.7 GB of whisper models against 224 KB
    // of files. Folded into "everything else", the biggest number on the disk
    // would have been the one nobody could act on.
    const report = service({
      dirs: {
        '/data': { bytes: 1_800_000_000, files: 50 },
        '/data/files': { bytes: 224_000, files: 1 },
        '/data/voice-models': { bytes: 1_700_000_000, files: 3 },
      },
    }).report();

    expect(bytesOf(report, 'models')).toBe(1_700_000_000);
    expect(bytesOf(report, 'other')).toBeLessThan(bytesOf(report, 'models'));
    // Named once each: the total must not count the models twice.
    expect(report.totalBytes).toBe(1_800_000_000);
  });

  it('includes the backups even though they live outside the data directory', () => {
    // They are usually the biggest line and the reason a disk fills; where the
    // files sit is not a reason to leave them off the bill.
    const report = service({
      dirs: { '/data': { bytes: 1000, files: 5 }, '/backups': { bytes: 9000, files: 10 } },
    }).report();

    expect(bytesOf(report, 'backups')).toBe(9000);
    expect(report.totalBytes).toBe(10_000);
  });

  it('does not count the index twice, since it is inside the database file', () => {
    const report = service({
      dirs: { '/data': { bytes: 1000, files: 5 } },
      files: { '/data/pop-agent.db': 1000 },
      repo: { index: { bytes: 800, count: 42 } },
    }).report();

    expect(bytesOf(report, 'index')).toBe(800);
    // 1000 of database, and the index is a slice of it -- not another 800.
    expect(report.totalBytes).toBe(1000);
  });

  it('reports the filesystem behind the data directory', () => {
    expect(service({}).report().disk).toEqual({ freeBytes: 50, totalBytes: 100 });
  });
});
