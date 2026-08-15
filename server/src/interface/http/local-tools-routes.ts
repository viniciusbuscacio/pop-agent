import { Hono, type Context } from 'hono';
import { upgradeWebSocket } from '@hono/node-server';
import { compareVersions, installCommand, MIN_CLIENT_VERSION } from '@pop-agent/shared';
import type { AuthService } from '../../application/auth/auth-service.js';
import type { TokenPayload } from '../../application/auth/token.js';
import type { Clock } from '../../application/ports/clock.js';
import {
  type LocalConnectionRole,
  type LocalMachine,
  type LocalConnectionRegistry,
} from '../../application/local-access/local-connection-registry.js';
import { entityId } from '../../domain/ids.js';
import { apiError } from './errors.js';

const POLL_TIMEOUT_MS = 25_000;
const MAX_BATCH_BYTES = 12 * 1024 * 1024;
const MAX_BATCH_EVENTS = 256;
const MAX_QUEUED_FRAMES = 1_024;

interface AttachFrame {
  kind: 'attach';
  protocol?: number;
  role?: LocalConnectionRole;
  machine: LocalMachine;
}

interface Envelope {
  seq: number;
  frame: unknown;
}

class PollConnection {
  readonly id = entityId('local');
  private frames: Envelope[] = [];
  private nextSeq = 1;
  private waiters = new Set<() => void>();
  private seenEvents = new Set<string>();
  closed = false;

  constructor(
    readonly attach: AttachFrame,
    readonly session: TokenPayload,
  ) {}

  send = (frame: unknown): void => {
    if (this.closed) return;
    const encoded = JSON.stringify(frame);
    if (encoded.length > MAX_BATCH_BYTES || this.frames.length >= MAX_QUEUED_FRAMES) {
      this.closed = true;
      this.wake();
      return;
    }
    this.frames.push({ seq: this.nextSeq++, frame });
    this.wake();
  };

  close = (): void => {
    this.closed = true;
    this.wake();
  };

  acceptEvent(eventId: string): boolean {
    if (this.seenEvents.has(eventId)) return false;
    this.seenEvents.add(eventId);
    return true;
  }

  async poll(ackSeq: number): Promise<Envelope[]> {
    this.frames = this.frames.filter((entry) => entry.seq > ackSeq);
    if (this.frames.length > 0 || this.closed) return this.frames;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        resolve();
      }, POLL_TIMEOUT_MS);
      timer.unref?.();
      const done = (): void => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
    });
    return this.frames;
  }

  private wake(): void {
    for (const wake of [...this.waiters]) wake();
  }
}

export interface LocalToolsRoutesDeps {
  localConnections: LocalConnectionRegistry;
  auth: AuthService;
  clock: Clock;
  versions: { popAgentVersion: string };
}

export function createLocalToolsRoutes(deps: LocalToolsRoutesDeps): Hono {
  const routes = new Hono();
  const polling = new Map<string, PollConnection>();

  routes.get(
    '/local-tools',
    upgradeWebSocket((c) => {
      const session = sessionOf(c, deps.auth);
      const id = entityId('local');
      let attached = false;

      return {
        onMessage(event, ws) {
          const frame = parseFrame(event.data);
          if (frame === undefined) return;
          deps.localConnections.heard(id);

          if (frame.kind === 'attach' && !attached) {
            const attach = validAttach(frame);
            if (attach === undefined || session === undefined) {
              ws.send(JSON.stringify({ kind: 'protocol_error', code: 'invalid_attach' }));
              ws.close(4002, 'invalid_attach');
              return;
            }
            const compatibility = versionFrames(attach.machine.clientVersion, deps.versions, c.req.url);
            if (compatibility.outdated !== undefined) {
              ws.send(JSON.stringify(compatibility.outdated));
              ws.close(4003, 'client_outdated');
              return;
            }
            attached = true;
            deps.localConnections.attach({
              id,
              machine: attach.machine,
              ...(attach.role === undefined ? {} : { role: attach.role }),
              epoch: session.epoch,
              expiresAt: session.exp,
              send: (payload) => ws.send(JSON.stringify(payload)),
              close: (code, reason) => ws.close(code, reason),
            });
            ws.send(JSON.stringify({ kind: 'attached', connectionId: id, heartbeatMs: 15_000 }));
            if (compatibility.warning !== undefined) ws.send(JSON.stringify(compatibility.warning));
            return;
          }
          handleClientFrame(deps.localConnections, id, frame);
        },
        onClose() {
          deps.localConnections.detach(id);
        },
        onError() {
          deps.localConnections.detach(id);
        },
      };
    }),
  );

  routes.post('/local-tools/connections', async (c) => {
    const session = sessionOf(c, deps.auth);
    if (session === undefined) return invalidSession(c);
    const frame = await jsonWithinLimit(c);
    const attach = validAttach(frame);
    if (attach === undefined) return apiError(c, 400, 'invalid_attach', 'Invalid local access attach.');
    const compatibility = versionFrames(attach.machine.clientVersion, deps.versions, c.req.url);
    if (compatibility.outdated !== undefined) {
      return c.json({ error: compatibility.outdated }, 426);
    }
    const connection = new PollConnection(attach, session);
    polling.set(connection.id, connection);
    deps.localConnections.attach({
      id: connection.id,
      machine: attach.machine,
      ...(attach.role === undefined ? {} : { role: attach.role }),
      epoch: session.epoch,
      expiresAt: session.exp,
      send: connection.send,
      close: connection.close,
    });
    const frames = compatibility.warning === undefined ? [] : [compatibility.warning];
    return c.json(
      {
        connectionId: connection.id,
        transport: 'https-long-poll' as const,
        heartbeatMs: 15_000,
        pollTimeoutMs: POLL_TIMEOUT_MS,
        frames,
      },
      201,
    );
  });

  routes.post('/local-tools/connections/:id/poll', async (c) => {
    const connection = polling.get(c.req.param('id'));
    if (!authorizedPolling(c, deps.auth, connection)) return invalidSession(c);
    const body = await jsonWithinLimit(c);
    const ackSeq = numberField(body, 'ackSeq') ?? 0;
    deps.localConnections.heard(connection.id);
    const frames = await connection.poll(ackSeq);
    if (connection.closed) {
      cleanupPolling(connection.id);
      return apiError(c, 409, 'connection_closed', 'The local connection is closed.');
    }
    return c.json({ frames, latestSeq: frames.at(-1)?.seq ?? ackSeq });
  });

  routes.post('/local-tools/connections/:id/events', async (c) => {
    const connection = polling.get(c.req.param('id'));
    if (!authorizedPolling(c, deps.auth, connection)) return invalidSession(c);
    const body = await jsonWithinLimit(c);
    const events =
      typeof body === 'object' && body !== null && Array.isArray((body as Record<string, unknown>)['events'])
        ? (body as Record<string, unknown>)['events']
        : undefined;
    if (!Array.isArray(events) || events.length > MAX_BATCH_EVENTS) {
      return apiError(c, 400, 'invalid_events', 'Invalid local event batch.');
    }
    const acceptedEventIds: string[] = [];
    for (const candidate of events) {
      if (typeof candidate !== 'object' || candidate === null) continue;
      const eventId = stringField(candidate, 'eventId');
      const frame = objectField(candidate, 'frame');
      if (eventId === undefined || frame === undefined) continue;
      if (!connection.acceptEvent(eventId)) {
        acceptedEventIds.push(eventId);
        continue;
      }
      acceptedEventIds.push(eventId);
      handleClientFrame(deps.localConnections, connection.id, frame);
    }
    deps.localConnections.heard(connection.id);
    return c.json({ acceptedEventIds });
  });

  routes.delete('/local-tools/connections/:id', (c) => {
    const connection = polling.get(c.req.param('id'));
    if (!authorizedPolling(c, deps.auth, connection)) return invalidSession(c);
    cleanupPolling(connection.id);
    return c.body(null, 204);
  });

  function cleanupPolling(id: string): void {
    const connection = polling.get(id);
    if (connection === undefined) return;
    polling.delete(id);
    connection.close();
    deps.localConnections.detach(id);
  }

  return routes;
}

function handleClientFrame(
  registry: LocalConnectionRegistry,
  connectionId: string,
  frame: Record<string, unknown>,
): void {
  if (frame['kind'] === 'pong') return;
  if (frame['kind'] === 'output') {
    const callId = stringField(frame, 'callId');
    const chunk = stringField(frame, 'chunk');
    if (callId !== undefined && chunk !== undefined) registry.output(callId, chunk);
    return;
  }
  if (frame['kind'] === 'result') {
    const callId = stringField(frame, 'callId');
    if (callId === undefined) return;
    const error = objectField(frame, 'error');
    registry.settle(callId, {
      ok: frame['ok'] === true,
      output: stringField(frame, 'output') ?? '',
      ...(typeof frame['exitCode'] === 'number' || frame['exitCode'] === null
        ? { exitCode: frame['exitCode'] }
        : {}),
      ...(error === undefined
        ? typeof frame['error'] === 'string'
          ? { error: frame['error'] }
          : {}
        : { error: stringField(error, 'message') ?? stringField(error, 'code') ?? 'Local operation failed.' }),
    });
  }
}

function validAttach(value: unknown): AttachFrame | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const frame = value as Record<string, unknown>;
  if (frame['kind'] !== 'attach') return undefined;
  const machine = objectField(frame, 'machine');
  if (machine === undefined) return undefined;
  const hostname = stringField(machine, 'hostname');
  const platform = stringField(machine, 'platform');
  const arch = stringField(machine, 'arch');
  const cwd = stringField(machine, 'cwd');
  const clientVersion = stringField(machine, 'clientVersion');
  if ([hostname, platform, arch, cwd, clientVersion].some((entry) => entry === undefined)) return undefined;
  const role = frame['role'];
  if (role !== undefined && role !== 'interactive') return undefined;
  const machineId = stringField(machine, 'machineId');
  return {
    kind: 'attach',
    ...(typeof frame['protocol'] === 'number' ? { protocol: frame['protocol'] } : {}),
    ...(role === undefined ? {} : { role }),
    machine: {
      hostname: hostname!,
      platform: platform!,
      arch: arch!,
      cwd: cwd!,
      clientVersion: clientVersion!,
      ...(machineId === undefined ? {} : { machineId }),
    },
  };
}

function versionFrames(
  client: string,
  versions: { popAgentVersion: string },
  requestUrl: string,
): { warning?: Record<string, unknown>; outdated?: Record<string, unknown> } {
  const server = versions.popAgentVersion;
  const install = installCommand(originOf(requestUrl), server);
  if (client.length === 0 || compareVersions(client, MIN_CLIENT_VERSION) < 0) {
    return { outdated: { kind: 'outdated', minimum: MIN_CLIENT_VERSION, server, install } };
  }
  return compareVersions(client, server) < 0
    ? { warning: { kind: 'version_warning', server, install } }
    : {};
}

function sessionOf(c: Context, auth: AuthService): TokenPayload | undefined {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token.length === 0) return undefined;
  const verified = auth.verifySession(token);
  return verified.ok ? verified.payload : undefined;
}

function authorizedPolling(
  c: Context,
  auth: AuthService,
  connection: PollConnection | undefined,
): connection is PollConnection {
  const session = sessionOf(c, auth);
  return connection !== undefined && session !== undefined && session.epoch === connection.session.epoch;
}

async function jsonWithinLimit(c: Context): Promise<unknown> {
  const length = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BATCH_BYTES) return undefined;
  try {
    return await c.req.json<unknown>();
  } catch {
    return undefined;
  }
}

function parseFrame(value: unknown): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function objectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'object' && field !== null ? (field as Record<string, unknown>) : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function invalidSession(c: Context): Response {
  return apiError(c, 401, 'invalid_session', 'This session is no longer valid.');
}

function originOf(requestUrl: string): string {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return '';
  }
}
