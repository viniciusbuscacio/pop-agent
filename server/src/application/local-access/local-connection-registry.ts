import { entityId } from '../../domain/ids.js';
import type { LocalAccessPolicyService } from './local-access-policy-service.js';

export const PING_EVERY_MS = 15_000;
export const MISSED_PINGS_BEFORE_GONE = 3;
export const MAX_CONCURRENT_CALLS = 4;
export const MAX_CALL_OUTPUT_BYTES = 50 * 1024 * 1024;

export type LocalConnectionRole = 'interactive' | 'background';

export interface LocalMachine {
  machineId?: string;
  hostname: string;
  platform: string;
  arch: string;
  cwd: string;
  clientVersion: string;
}

export interface LocalConnection {
  id: string;
  machine: LocalMachine;
  role?: LocalConnectionRole;
  epoch?: number;
  expiresAt?: number;
  send(frame: unknown): void;
  close(code?: number, reason?: string): void;
}

interface Entry {
  connection: LocalConnection;
  unanswered: number;
  pingId: number;
  calls: number;
}

interface Pending {
  connectionId: string;
  settle: (result: LocalResult) => void;
  onOutput: (chunk: string) => void;
  outputBytes: number;
}

export interface LocalResult {
  ok: boolean;
  output: string;
  exitCode?: number | null;
  error?: string;
}

export interface LocalCall {
  tool: string;
  input: unknown;
}

export class LocalConnectionRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly onJournal?: (line: string) => void,
    private readonly now: () => number = Date.now,
    private readonly accessPolicy?: LocalAccessPolicyService,
    private readonly onMachinesChanged?: () => void,
  ) {}

  attach(connection: LocalConnection): void {
    this.entries.set(connection.id, { connection, unanswered: 0, pingId: 0, calls: 0 });
    this.accessPolicy?.remember(connection.machine);
    this.onJournal?.(
      `pop local access: attached ${connection.machine.platform}/${connection.machine.arch} (${connection.role ?? 'interactive'})`,
    );
    this.onMachinesChanged?.();
  }

  detach(connectionId: string, message = 'The local connection disconnected before this finished.'): void {
    const entry = this.entries.get(connectionId);
    if (entry === undefined) return;
    this.entries.delete(connectionId);
    this.releaseCalls(connectionId, message);
    this.onJournal?.(`pop local access: detached ${connectionId.slice(-6)}`);
    this.onMachinesChanged?.();
  }

  heard(connectionId: string): void {
    const entry = this.entries.get(connectionId);
    if (entry !== undefined) entry.unanswered = 0;
  }

  /** Resolves an allowed live connection ID or stable machine ID. */
  connection(selector: string | undefined): LocalConnection | undefined {
    const connection = this.transportConnection(selector);
    if (connection === undefined) return undefined;
    return this.accessPolicy === undefined || this.accessPolicy.enabled(connection.machine.machineId)
      ? connection
      : undefined;
  }

  /** Resolves the secure transport even while file access is disabled. */
  transportConnection(selector: string | undefined): LocalConnection | undefined {
    if (selector === undefined) return undefined;
    const direct = this.entries.get(selector)?.connection;
    if (direct !== undefined && !this.expired(direct)) return direct;
    return this.connections()
      .filter((connection) => connection.machine.machineId === selector)
      .sort((a, b) => Number(b.role === 'background') - Number(a.role === 'background'))[0];
  }

  accessEnabled(machineId: string | undefined): boolean {
    return machineId !== undefined && (this.accessPolicy?.enabled(machineId) ?? true);
  }

  knownAndDisabled(selector: string): boolean {
    if (this.accessPolicy === undefined) return false;
    const machineId = this.transportConnection(selector)?.machine.machineId ?? selector;
    return this.accessPolicy.machines().some((machine) => machine.machineId === machineId && !machine.enabled);
  }

  setAccessEnabled(machineId: string, enabled: boolean): boolean {
    if (this.accessPolicy === undefined || !this.accessPolicy.setEnabled(machineId, enabled)) return false;
    for (const entry of this.entries.values()) {
      if (entry.connection.machine.machineId !== machineId) continue;
      if (!enabled) this.cancelCalls(entry.connection, 'Local file access was disabled.');
      entry.connection.send({ kind: 'access_policy', enabled });
    }
    this.onJournal?.(`pop local access: ${enabled ? 'enabled' : 'disabled'} ${machineId}`);
    this.onMachinesChanged?.();
    return true;
  }

  publishAccessPolicy(connectionId: string): void {
    const connection = this.entries.get(connectionId)?.connection;
    if (connection === undefined) return;
    connection.send({
      kind: 'access_policy',
      enabled: this.accessEnabled(connection.machine.machineId),
    });
  }

  has(selector: string): boolean {
    return this.connection(selector) !== undefined;
  }

  call(
    connectionId: string,
    request: LocalCall,
    onOutput: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<LocalResult> {
    const connection = this.connection(connectionId);
    const entry = connection === undefined ? undefined : this.entries.get(connection.id);
    if (entry === undefined || connection === undefined) {
      return Promise.reject(new Error('The local connection is no longer available.'));
    }
    if (entry.calls >= MAX_CONCURRENT_CALLS) {
      return Promise.reject(new Error('The local connection is busy.'));
    }
    const callId = entityId('call');
    entry.calls += 1;
    return new Promise<LocalResult>((resolve) => {
      const settle = (result: LocalResult): void => {
        signal?.removeEventListener('abort', abort);
        resolve(result);
      };
      const abort = (): void => {
        if (!this.pending.has(callId)) return;
        connection.send({ kind: 'cancel', callId, reason: 'run_stopped' });
        this.settle(callId, { ok: false, output: '', error: 'The local operation was cancelled.' });
      };
      this.pending.set(callId, {
        connectionId: connection.id,
        settle,
        onOutput,
        outputBytes: 0,
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else connection.send({ kind: 'call', callId, tool: request.tool, input: request.input });
    });
  }

  output(callId: string, chunk: string): void {
    const pending = this.pending.get(callId);
    if (pending === undefined) return;
    pending.outputBytes += new TextEncoder().encode(chunk).byteLength;
    if (pending.outputBytes > MAX_CALL_OUTPUT_BYTES) {
      const connection = this.transportConnection(pending.connectionId);
      connection?.send({ kind: 'cancel', callId, reason: 'output_limit' });
      this.settle(callId, { ok: false, output: '', error: 'Local output exceeded 50 MiB.' });
      return;
    }
    pending.onOutput(chunk);
  }

  settle(callId: string, result: LocalResult): void {
    const pending = this.pending.get(callId);
    if (pending === undefined) return;
    this.pending.delete(callId);
    const entry = this.entries.get(pending.connectionId);
    if (entry !== undefined) entry.calls = Math.max(0, entry.calls - 1);
    pending.settle(result);
  }

  revokeEpoch(epoch: number): void {
    for (const [id, entry] of [...this.entries]) {
      if (entry.connection.epoch !== epoch) continue;
      entry.connection.send({ kind: 'closing', code: 'session_revoked', message: 'Session revoked' });
      this.detach(id, 'The local session was revoked.');
      entry.connection.close(4004, 'session_revoked');
    }
  }

  revokeAll(): void {
    for (const entry of [...this.entries.values()]) {
      entry.connection.send({ kind: 'closing', code: 'session_revoked', message: 'Session revoked' });
      this.detach(entry.connection.id, 'The local session was revoked.');
      entry.connection.close(4004, 'session_revoked');
    }
  }

  attached(): LocalMachine[] {
    return [...this.entries.values()].map((entry) => entry.connection.machine);
  }

  knownMachines() {
    return this.accessPolicy?.machines() ?? [];
  }

  connections(): LocalConnection[] {
    return [...this.entries.values()]
      .map((entry) => entry.connection)
      .filter((connection) => !this.expired(connection));
  }

  beat(): void {
    for (const [id, entry] of [...this.entries]) {
      if (this.expired(entry.connection)) {
        entry.connection.send({ kind: 'closing', code: 'session_expired', message: 'Session expired' });
        this.detach(id, 'The local session expired.');
        entry.connection.close(4004, 'session_expired');
        continue;
      }
      entry.unanswered += 1;
      if (entry.unanswered >= MISSED_PINGS_BEFORE_GONE) {
        this.detach(id);
        entry.connection.close(4002, 'heartbeat_timeout');
        continue;
      }
      entry.pingId += 1;
      entry.connection.send({ kind: 'ping', pingId: entry.pingId });
    }
  }

  private expired(connection: LocalConnection): boolean {
    return connection.expiresAt !== undefined && this.now() >= connection.expiresAt;
  }

  private cancelCalls(connection: LocalConnection, message: string): void {
    for (const [callId, pending] of [...this.pending]) {
      if (pending.connectionId !== connection.id) continue;
      connection.send({ kind: 'cancel', callId, reason: 'access_disabled' });
      this.settle(callId, { ok: false, output: '', error: message });
    }
  }

  private releaseCalls(connectionId: string, message: string): void {
    for (const [callId, pending] of [...this.pending]) {
      if (pending.connectionId !== connectionId) continue;
      this.pending.delete(callId);
      pending.settle({ ok: false, output: '', error: message });
    }
  }
}
