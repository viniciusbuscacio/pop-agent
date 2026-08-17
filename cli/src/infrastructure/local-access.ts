import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, hostname, arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const MAX_TIMEOUT_SECONDS = 86_400;
const LOCAL_LEASE_MS = 45_000;

export interface LocalAccessOptions {
  url: string;
  token: string | (() => string);
  version: string;
  role?: 'interactive' | 'background';
  onEvent?: (event: LocalAccessEvent) => void;
  reconnectDelayMs?: number;
  /** Test override; production uses the protocol's 45-second local lease. */
  localLeaseMs?: number;
  fetch?: typeof globalThis.fetch;
}

export type LocalAccessEvent =
  | { kind: 'attached'; connectionId: string; transport: 'wss' | 'https-long-poll' }
  | { kind: 'access-policy'; enabled: boolean }
  | { kind: 'behind'; server: string; install: string }
  | { kind: 'outdated'; minimum: string; server: string; install: string }
  | { kind: 'authentication-required' }
  | { kind: 'ran'; command: string }
  | { kind: 'closed' }
  | { kind: 'transport'; transport: 'wss' | 'https-long-poll' };

interface CallFrame {
  kind: 'call';
  callId: string;
  tool: string;
  input: unknown;
}

interface PollEnvelope {
  seq: number;
  frame: Record<string, unknown>;
}

export class LocalAccess {
  private socket: WebSocket | undefined;
  private id: string | undefined;
  private accessEnabled = false;
  private refused = false;
  private shouldConnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private socketLeaseTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private outageReported = false;
  private preAttachFailures = 0;
  private transport: 'wss' | 'https-long-poll' = 'wss';
  private pollAbort: AbortController | undefined;
  private lastHttpSuccess = 0;
  private readonly children = new Map<string, ChildProcess>();
  private readonly completedCalls = new Map<string, Record<string, unknown>>();
  private eventCounter = 0;
  private httpEventChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: LocalAccessOptions) {}

  get connectionId(): string | undefined {
    return this.accessEnabled ? this.id : undefined;
  }

  connect(): void {
    if (this.shouldConnect) return;
    this.shouldConnect = true;
    this.refused = false;
    this.open();
  }

  setAccessEnabled(enabled: boolean): void {
    if (this.id === undefined) return;
    const frame = { kind: 'set_access', enabled };
    if (this.transport === 'https-long-poll') {
      void this.queueHttpEvents([frame]).catch(() => undefined);
    } else if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame));
    }
  }

  close(): void {
    this.shouldConnect = false;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.clearSocketLease();
    this.pollAbort?.abort();
    this.pollAbort = undefined;
    this.socket?.close();
    this.socket = undefined;
    this.id = undefined;
    this.accessEnabled = false;
    this.killAll();
  }

  private open(): void {
    if (!this.shouldConnect || this.refused) return;
    if (this.transport === 'https-long-poll') void this.openPolling();
    else this.openSocket();
  }

  private openSocket(): void {
    const url = `${this.options.url.replace(/^http/, 'ws')}/v1/local-tools`;
    const socket = new WebSocket(url, { headers: this.authHeaders() });
    this.socket = socket;
    let attached = false;

    socket.on('open', () => socket.send(JSON.stringify(this.attachFrame())));
    socket.on('message', (data: Buffer | string) => {
      const frame = parseObject(String(data));
      if (frame === undefined) return;
      if (frame['kind'] === 'attached') {
        const connectionId = stringField(frame, 'connectionId') ?? stringField(frame, 'id');
        if (connectionId === undefined) return;
        attached = true;
        this.accessEnabled = frame['accessEnabled'] !== false;
        this.attached(connectionId, 'wss');
        this.armSocketLease(socket);
        return;
      }
      if (attached) this.armSocketLease(socket);
      void this.handleServerFrame(frame, (event) => this.sendSocket(event, socket));
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.clearSocketLease();
      this.socket = undefined;
      this.id = undefined;
      this.killAll();
      if (!attached) this.preAttachFailures += 1;
      if (this.preAttachFailures >= 2) {
        void this.tryHttpsFallback();
        return;
      }
      this.disconnected();
    });
    socket.on('error', () => undefined);
  }

  private async tryHttpsFallback(): Promise<void> {
    if (!this.shouldConnect || this.refused) return;
    try {
      const response = await this.http()(`${this.options.url}/v1/session/refresh`, {
        method: 'POST',
        headers: this.authHeaders(),
      });
      if (response.ok) {
        this.transport = 'https-long-poll';
        this.options.onEvent?.({ kind: 'transport', transport: this.transport });
        await this.openPolling();
        return;
      }
      if (response.status === 401 || response.status === 403) {
        this.refused = true;
        this.options.onEvent?.({ kind: 'authentication-required' });
      }
    } catch {
      // General network failure: HTTPS is not a fallback when HTTPS is down too.
    }
    this.disconnected();
  }

  private async openPolling(): Promise<void> {
    if (!this.shouldConnect || this.refused) return;
    const abort = new AbortController();
    this.pollAbort = abort;
    try {
      const response = await this.http()(`${this.options.url}/v1/local-tools/connections`, {
        method: 'POST',
        headers: { ...this.authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(this.attachFrame()),
        signal: abort.signal,
      });
      if (response.status === 401 || response.status === 403) {
        this.refused = true;
        this.options.onEvent?.({ kind: 'authentication-required' });
        this.disconnected(false);
        return;
      }
      if (response.status === 426) {
        const body = (await response.json()) as { error?: Record<string, unknown> };
        this.outdated(body.error ?? {});
        return;
      }
      if (!response.ok) throw new Error(`local connect: ${String(response.status)}`);
      const body = (await response.json()) as {
        connectionId?: string;
        accessEnabled?: boolean;
        frames?: Record<string, unknown>[];
      };
      if (typeof body.connectionId !== 'string') throw new Error('local connect: missing id');
      this.lastHttpSuccess = Date.now();
      this.accessEnabled = body.accessEnabled !== false;
      this.attached(body.connectionId, 'https-long-poll');
      for (const frame of body.frames ?? []) await this.handleServerFrame(frame, (event) => this.queueHttpEvents([event]));
      await this.pollLoop(body.connectionId, abort.signal);
    } catch {
      if (!abort.signal.aborted && this.shouldConnect) this.disconnected();
    }
  }

  private async pollLoop(connectionId: string, signal: AbortSignal): Promise<void> {
    let ackSeq = 0;
    while (this.shouldConnect && !signal.aborted && this.id === connectionId) {
      const response = await this.http()(
        `${this.options.url}/v1/local-tools/connections/${encodeURIComponent(connectionId)}/poll`,
        {
          method: 'POST',
          headers: { ...this.authHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({ ackSeq }),
          signal,
        },
      );
      if (!response.ok) throw new Error(`local poll: ${String(response.status)}`);
      this.lastHttpSuccess = Date.now();
      const body = (await response.json()) as { frames?: PollEnvelope[]; latestSeq?: number };
      const events: Record<string, unknown>[] = [];
      for (const envelope of body.frames ?? []) {
        if (envelope.frame['kind'] === 'call') {
          // Do not park the poll loop behind a long command: output and result
          // travel through their own authenticated event requests.
          void this.handleServerFrame(envelope.frame, (event) => this.queueHttpEvents([event]));
        } else {
          await this.handleServerFrame(envelope.frame, (event) => {
            events.push(event);
          });
        }
        ackSeq = Math.max(ackSeq, envelope.seq);
      }
      if (events.length > 0) await this.queueHttpEvents(events);
      if (Date.now() - this.lastHttpSuccess > LOCAL_LEASE_MS) throw new Error('local lease expired');
    }
  }

  private async handleServerFrame(
    frame: Record<string, unknown>,
    send: (frame: Record<string, unknown>) => void | Promise<void>,
  ): Promise<void> {
    if (frame['kind'] === 'ping') {
      await send({ kind: 'pong', pingId: frame['pingId'] });
      return;
    }
    if (frame['kind'] === 'access_policy') {
      this.accessEnabled = frame['enabled'] === true;
      this.options.onEvent?.({ kind: 'access-policy', enabled: this.accessEnabled });
      return;
    }
    if (frame['kind'] === 'outdated') {
      this.outdated(frame);
      return;
    }
    if (frame['kind'] === 'version_warning') {
      this.options.onEvent?.({
        kind: 'behind',
        server: stringField(frame, 'server') ?? '',
        install: stringField(frame, 'install') ?? '',
      });
      return;
    }
    if (frame['kind'] === 'cancel') {
      const callId = stringField(frame, 'callId');
      if (callId !== undefined) this.kill(callId);
      return;
    }
    if (frame['kind'] !== 'call') return;
    const call = frame as unknown as CallFrame;
    if (!this.accessEnabled) {
      await send({
        kind: 'result', callId: call.callId, ok: false, output: '',
        error: 'Local file access is disabled on this computer.',
      });
      return;
    }
    const completed = this.completedCalls.get(call.callId);
    if (completed !== undefined) {
      await send(completed);
      return;
    }
    await this.run(call, async (event) => {
      if (event['kind'] === 'result') this.completedCalls.set(call.callId, event);
      await send(event);
    });
  }

  private async run(
    frame: CallFrame,
    send: (frame: Record<string, unknown>) => void | Promise<void>,
  ): Promise<void> {
    const reply = async (result: Record<string, unknown>): Promise<void> =>
      send({ kind: 'result', callId: frame.callId, ...result });
    try {
      const input = objectValue(frame.input);
      switch (frame.tool) {
        case 'bash': {
          const command = requiredString(input, 'command', 64 * 1024);
          const cwd = optionalString(input, 'cwd') ?? process.cwd();
          const timeout = optionalNumber(input, 'timeout');
          const exitCode = await this.runCommand(frame.callId, command, cwd, timeout, async (stream, chunk) => {
            await send({ kind: 'output', callId: frame.callId, stream, chunk });
          });
          this.options.onEvent?.({ kind: 'ran', command });
          await reply({ ok: true, output: '', exitCode });
          return;
        }
        case 'read': {
          const bytes = await readFile(requiredString(input, 'path', 16 * 1024));
          if (bytes.length > MAX_FILE_BYTES) throw new LocalError('payload_too_large', 'File exceeds 8 MiB.');
          await reply({ ok: true, output: bytes.toString('base64') });
          return;
        }
        case 'access':
          await access(requiredString(input, 'path', 16 * 1024));
          await reply({ ok: true, output: '' });
          return;
        case 'mkdir':
          await mkdir(requiredString(input, 'path', 16 * 1024), { recursive: true });
          await reply({ ok: true, output: '' });
          return;
        case 'write': {
          const contents = requiredString(input, 'contents', MAX_FILE_BYTES);
          await writeFile(requiredString(input, 'path', 16 * 1024), contents);
          await reply({ ok: true, output: '' });
          return;
        }
        default:
          throw new LocalError('invalid_input', `Unknown local tool: ${frame.tool}`);
      }
    } catch (error) {
      const detail = localError(error);
      await reply({ ok: false, output: '', error: detail });
    }
  }

  private runCommand(
    callId: string,
    command: string,
    cwd: string,
    timeoutSeconds: number | undefined,
    output: (stream: 'stdout' | 'stderr', chunk: string) => Promise<void>,
  ): Promise<number | null> {
    if (timeoutSeconds !== undefined && (timeoutSeconds <= 0 || timeoutSeconds > MAX_TIMEOUT_SECONDS)) {
      return Promise.reject(new LocalError('invalid_input', 'Invalid timeout.'));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        detached: process.platform !== 'win32',
        env: sanitizedEnv(),
      });
      this.children.set(callId, child);
      let outputBytes = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = (stream: 'stdout' | 'stderr', bytes: Buffer): void => {
        outputBytes += bytes.length;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          this.kill(callId);
          reject(new LocalError('output_limit', 'Output exceeded 50 MiB.'));
          return;
        }
        for (let offset = 0; offset < bytes.length; offset += MAX_CHUNK_BYTES) {
          void output(stream, bytes.subarray(offset, offset + MAX_CHUNK_BYTES).toString('utf8'));
        }
      };
      child.stdout?.on('data', (bytes: Buffer) => chunk('stdout', bytes));
      child.stderr?.on('data', (bytes: Buffer) => chunk('stderr', bytes));
      child.once('error', (error) => reject(new LocalError('spawn_failed', error.message)));
      child.once('close', (code) => {
        if (timer !== undefined) clearTimeout(timer);
        this.children.delete(callId);
        resolve(code);
      });
      if (timeoutSeconds !== undefined) {
        timer = setTimeout(() => {
          this.kill(callId);
          reject(new LocalError('timeout', 'Command timed out.'));
        }, timeoutSeconds * 1000);
      }
    });
  }

  private sendSocket(frame: Record<string, unknown>, socket: WebSocket): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }

  private armSocketLease(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.clearSocketLease();
    this.socketLeaseTimer = setTimeout(() => {
      if (this.socket === socket && this.shouldConnect) socket.terminate();
    }, this.options.localLeaseMs ?? LOCAL_LEASE_MS);
    this.socketLeaseTimer.unref?.();
  }

  private clearSocketLease(): void {
    if (this.socketLeaseTimer !== undefined) clearTimeout(this.socketLeaseTimer);
    this.socketLeaseTimer = undefined;
  }

  private queueHttpEvents(frames: Record<string, unknown>[]): Promise<void> {
    this.httpEventChain = this.httpEventChain
      .catch(() => undefined)
      .then(() => this.sendHttpEvents(frames))
      .catch(() => {
        this.pollAbort?.abort();
        if (this.shouldConnect) this.disconnected();
      });
    return this.httpEventChain;
  }

  private async sendHttpEvents(frames: Record<string, unknown>[]): Promise<void> {
    if (this.id === undefined || frames.length === 0) return;
    const events = frames.map((frame) => ({ eventId: `event-${String(++this.eventCounter)}`, frame }));
    const response = await this.http()(
      `${this.options.url}/v1/local-tools/connections/${encodeURIComponent(this.id)}/events`,
      {
        method: 'POST',
        headers: { ...this.authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ events }),
        ...(this.pollAbort === undefined ? {} : { signal: this.pollAbort.signal }),
      },
    );
    if (!response.ok) throw new Error(`local events: ${String(response.status)}`);
    this.lastHttpSuccess = Date.now();
  }

  private attached(id: string, transport: 'wss' | 'https-long-poll'): void {
    this.id = id;
    this.preAttachFailures = 0;
    this.reconnectAttempt = 0;
    this.outageReported = false;
    this.options.onEvent?.({ kind: 'attached', connectionId: id, transport });
  }

  private outdated(frame: Record<string, unknown>): void {
    this.refused = true;
    this.shouldConnect = false;
    this.options.onEvent?.({
      kind: 'outdated',
      minimum: stringField(frame, 'minimum') ?? '',
      server: stringField(frame, 'server') ?? '',
      install: stringField(frame, 'install') ?? '',
    });
  }

  private disconnected(schedule = true): void {
    this.id = undefined;
    this.accessEnabled = false;
    this.killAll();
    if (!this.outageReported) {
      this.outageReported = true;
      this.options.onEvent?.({ kind: 'closed' });
    }
    if (schedule) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.shouldConnect || this.refused || this.reconnectTimer !== undefined) return;
    const base = this.options.reconnectDelayMs ?? Math.min(1_000 * 2 ** this.reconnectAttempt, 30_000);
    const delay = this.options.reconnectDelayMs ?? Math.round(base * (0.8 + Math.random() * 0.4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, delay);
  }

  private kill(callId: string): void {
    const child = this.children.get(callId);
    if (child === undefined) return;
    this.children.delete(callId);
    try {
      if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      child.kill('SIGKILL');
    }
  }

  private killAll(): void {
    for (const callId of [...this.children.keys()]) this.kill(callId);
  }

  private authHeaders(): Record<string, string> {
    const token = typeof this.options.token === 'function' ? this.options.token() : this.options.token;
    return { authorization: `Bearer ${token}` };
  }

  private attachFrame(): Record<string, unknown> {
    return {
      kind: 'attach',
      protocol: 1,
      role: this.options.role ?? 'interactive',
      machine: {
        machineId: machineId(),
        hostname: hostname(),
        platform: platform(),
        arch: arch(),
        cwd: process.cwd(),
        clientVersion: this.options.version,
      },
    };
  }

  private http(): typeof globalThis.fetch {
    return this.options.fetch ?? globalThis.fetch;
  }
}

class LocalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function localError(error: unknown): { code: string; message: string } {
  if (error instanceof LocalError) return { code: error.code, message: error.message };
  const value = error as NodeJS.ErrnoException;
  const code = value?.code === 'ENOENT' ? 'not_found' : value?.code === 'EACCES' ? 'permission_denied' : 'io_error';
  return { code, message: error instanceof Error ? error.message : 'Local operation failed.' };
}

function machineId(): string {
  const path = machineIdPath();
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { machineId?: unknown };
      if (typeof parsed.machineId === 'string' && parsed.machineId.length > 0) return parsed.machineId;
    }
  } catch {
    // A missing or damaged id is replaced below; no user data is involved.
  }
  const id = randomUUID();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ machineId: id })}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(path, 0o600);
  return id;
}

function machineIdPath(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Pop Agent', 'machine.json');
  if (process.platform === 'win32') return join(process.env['LOCALAPPDATA'] ?? homedir(), 'Pop Agent', 'machine.json');
  return join(process.env['XDG_STATE_HOME'] ?? join(homedir(), '.local', 'state'), 'pop-agent', 'machine.json');
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/POP_AGENT.*(TOKEN|PASSWORD|SECRET|IPC)/i.test(key)) delete env[key];
  return env;
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return objectValue(value);
  } catch {
    return undefined;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new LocalError('invalid_input', 'Expected an object.');
  return value as Record<string, unknown>;
}
function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}
function requiredString(value: Record<string, unknown>, key: string, maxBytes: number): string {
  const field = stringField(value, key);
  if (field === undefined || Buffer.byteLength(field, 'utf8') > maxBytes) throw new LocalError('invalid_input', `Invalid ${key}.`);
  return field;
}
function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  return value[key] === undefined ? undefined : requiredString(value, key, 16 * 1024);
}
function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== 'number' || !Number.isFinite(field)) throw new LocalError('invalid_input', `Invalid ${key}.`);
  return field;
}
