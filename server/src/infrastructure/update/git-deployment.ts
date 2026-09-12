import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import type {
  DeploymentInspector,
  DeploymentRecord,
  DeploymentRequester,
  DeploymentStateStore,
  DeploymentSupervisor,
} from '../../application/ports/deployment.js';

export function gitCommit(repoRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

export class GitDeploymentInspector implements DeploymentInspector {
  constructor(private readonly repoRoot: string) {}

  headCommit(): string {
    return gitCommit(this.repoRoot);
  }

  isClean(): boolean {
    try {
      return (
        execFileSync('git', ['status', '--porcelain'], {
          cwd: this.repoRoot,
          stdio: ['ignore', 'pipe', 'ignore'],
          encoding: 'utf8',
        }).trim().length === 0
      );
    } catch {
      return false;
    }
  }

  isPrepared(commit: string): boolean {
    try {
      const tree = execFileSync('git', ['rev-parse', `${commit}^{tree}`], {
        cwd: this.repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const receiptPath = execFileSync(
        'git',
        ['rev-parse', '--git-path', 'pop-agent-gate-receipt.json'],
        { cwd: this.repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      const absoluteReceipt = receiptPath.startsWith('/')
        ? receiptPath
        : join(this.repoRoot, receiptPath);
      const parsed = JSON.parse(readFileSync(absoluteReceipt, 'utf8')) as {
        version?: number;
        tree?: string;
        node?: string;
        completedAt?: string;
      };
      const completed = Date.parse(parsed.completedAt ?? '');
      return (
        parsed.version === 1 &&
        parsed.tree === tree &&
        parsed.node === process.version &&
        Number.isFinite(completed) &&
        Date.now() - completed <= 24 * 60 * 60 * 1000
      );
    } catch {
      return false;
    }
  }
}

export class JsonDeploymentStateStore implements DeploymentStateStore {
  constructor(readonly path: string) {}

  read(): DeploymentRecord | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      return validRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  write(record: DeploymentRecord): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

export class DetachedDeploymentSupervisor implements DeploymentSupervisor {
  constructor(
    private readonly deps: {
      repoRoot: string;
      statePath: string;
      scriptPath: string;
      serviceName: string;
      healthUrl: string;
      timeoutMs?: number;
    },
  ) {}

  start(plan: {
    runningCommit: string;
    targetCommit: string;
    lastKnownGood: string;
    requestedBy: DeploymentRequester;
  }): void {
    const planPath = join(dirname(this.deps.statePath), 'deployment-plan.json');
    writeFileSync(
      planPath,
      `${JSON.stringify(
        {
          ...plan,
          repoRoot: this.deps.repoRoot,
          statePath: this.deps.statePath,
          serviceName: this.deps.serviceName,
          healthUrl: this.deps.healthUrl,
          timeoutMs: this.deps.timeoutMs ?? 60_000,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    // A detached child still belongs to this service's cgroup and systemd
    // kills it during restart. A transient unit is a genuinely external
    // supervisor: its health/rollback loop survives the parent disappearing.
    const unit = `pop-agent-deploy-${String(process.pid)}-${String(Date.now())}`;
    execFileSync(
      'sudo',
      [
        '-n',
        'systemd-run',
        '--quiet',
        '--collect',
        `--unit=${unit}`,
        '--property=Type=exec',
        `--property=User=${userInfo().username}`,
        process.execPath,
        this.deps.scriptPath,
        planPath,
      ],
      { cwd: this.deps.repoRoot, stdio: 'ignore' },
    );
  }
}

function validRecord(value: unknown): value is DeploymentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<DeploymentRecord>;
  return (
    typeof record.phase === 'string' &&
    typeof record.runningCommit === 'string' &&
    typeof record.targetCommit === 'string' &&
    typeof record.lastKnownGood === 'string' &&
    typeof record.updatedAt === 'string'
  );
}
