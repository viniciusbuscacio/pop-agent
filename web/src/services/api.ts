import {
  CLIENT_HEADER,
  CLIENT_PLATFORM_HEADER,
  EVENT_STREAM_VERSION,
  EVENT_STREAM_VERSION_HEADER,
  LOCAL_CONNECTION_HEADER,
  ONBOARDING_TOKEN_HEADER,
  SESSION_TOKEN_HEADER,
} from '@pop-agent/shared';
import { healthMonitor } from './health';
import { session } from './session';
import {
  clearLocalConnection,
  selectedLocalConnection,
} from './local-connection-selection';

/**
 * The only module in the app that calls `fetch` (docs/specs/Spec-Pop-General.md §14, enforced by
 * ESLint). Everything the API layer owes the rest of the app happens here:
 * the base path, the bearer token, silent token renewal, and turning an error
 * envelope into something typed.
 */

const BASE = '/v1';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Notified when the server says the session is gone, so the UI can react once. */
type SessionLostHandler = () => void;
let onSessionLost: SessionLostHandler = () => undefined;

export function setSessionLostHandler(handler: SessionLostHandler): void {
  onSessionLost = handler;
}

/**
 * Every request doubles as a connection probe. A fetch that never reached the
 * server is the loudest evidence there is, and waiting for the next keepalive
 * to rediscover it would leave the user watching a send that did nothing with
 * nothing on screen to explain it. An application error envelope proves the
 * server answered; a bare reverse-proxy 502/503/504 is classified below as an
 * unreachable Pop server rather than healthy reachability.
 */
async function probed(request: () => Promise<Response>): Promise<Response> {
  try {
    const response = await request();
    healthMonitor.reportReachable();
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    healthMonitor.reportUnreachable();
    throw new ApiError(
      'server_unreachable',
      'The server is temporarily unreachable. Pop Agent is reconnecting.',
      0,
    );
  }
}

/**
 * Which client this is, and what it is running on (docs/specs/Spec-Pop-General.md §13).
 *
 * `web` and `pwa` are the same code; the only real difference is whether it
 * was installed, which `display-mode: standalone` is exactly the question
 * for. A form factor is NOT a client -- "PWA on an iPhone" would otherwise
 * be two answers at once -- so the phone half is carried as the platform.
 */
export interface ClientEnvironment {
  kind: 'web' | 'pwa';
  platform: string;
  deviceLabel: string;
  appLabel: string;
}

/** Shared by request headers and Settings so both describe this client identically. */
export function clientEnvironment(): ClientEnvironment {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true);
  const kind = standalone ? 'pwa' : 'web';
  const platform = platformName();
  const applePhone = /iPhone|iPod/i.test(agent);
  const appleTablet = /iPad/i.test(agent);
  return {
    kind,
    platform,
    deviceLabel: applePhone
      ? 'This iPhone'
      : appleTablet
        ? 'This iPad'
        : platform === 'macos'
          ? 'This Mac'
          : 'This device',
    appLabel: kind === 'pwa' ? 'Installed app' : 'Web browser',
  };
}

function clientHeaders(client = clientEnvironment()): Record<string, string> {
  return {
    [CLIENT_HEADER]: client.kind,
    [CLIENT_PLATFORM_HEADER]: client.platform,
    'x-pop-time-zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    [EVENT_STREAM_VERSION_HEADER]: String(EVENT_STREAM_VERSION),
  };
}

/** Coarse on purpose: the model needs "an iPhone", not a build number. */
function platformName(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(agent)) return 'ios';
  if (/Android/i.test(agent)) return 'android';
  if (/Macintosh/i.test(agent)) return 'macos';
  if (/Windows/i.test(agent)) return 'windows';
  if (/Linux/i.test(agent)) return 'linux';
  return '';
}

// A real server restart on the owner's Windows machine took 28 seconds before
// the interactive PLA transport returned. Keep explicit local routing through
// that observed recovery window without retrying forever.
const LOCAL_RECONNECT_DELAYS_MS = [1_000, 2_000, 3_000, 4_000, 5_000, 5_000, 5_000, 5_000] as const;

interface ApiRequestRuntime {
  sleep?: (milliseconds: number) => Promise<void>;
  reconnectDelaysMs?: readonly number[];
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retriesLocalReconnect(path: string, method: string): boolean {
  return (
    (method === 'POST' && /^\/chats\/[^/]+\/messages$/.test(path)) ||
    (method === 'PUT' && /^\/chats\/[^/]+\/queue(?:\/[^/]+)?$/.test(path))
  );
}

let activeUiRequests = 0;
export const pendingUiRequests = (): number => activeUiRequests;
export async function apiRequest<T>(path: string, init: { method?: string; body?: unknown; onboardingToken?: string; uiKey?: string; signal?: AbortSignal } = {}, runtime: ApiRequestRuntime = {}): Promise<T> {
  const counted = !path.startsWith('/ui/');
  if (counted) activeUiRequests++;
  // Snapshot reads must release the network lane even if the server/proxy
  // accepts a connection and never completes its body. Mutations retain their
  // operation-specific policies (an aborted write can still finish remotely).
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) abort();
  const timer = (init.method ?? 'GET') === 'GET' || path === '/events/ticket' ? setTimeout(abort, 14_000) : undefined;
  try { return await performApiRequest<T>(path, { ...init, signal: controller.signal }, runtime); }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); if (counted) activeUiRequests--; }
}

async function performApiRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; onboardingToken?: string; uiKey?: string; signal?: AbortSignal } = {},
  runtime: ApiRequestRuntime = {},
): Promise<T> {
  const token = session.token();
  const generation = session.generation();
  const isCurrentSession = (): boolean => session.generation() === generation && session.token() === token;
  const client = clientEnvironment();
  const headers: Record<string, string> = clientHeaders(client);
  if (init.uiKey !== undefined) headers['X-Pop-UI-Key'] = init.uiKey;
  const method = init.method ?? 'GET';
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  if (init.onboardingToken !== undefined) {
    headers[ONBOARDING_TOKEN_HEADER] = init.onboardingToken;
  }
  // Capture one stable selector for the whole operation. A reconnect changes
  // only the server-side transport ID; retries must neither lose local routing
  // nor jump to a different machine selected in another UI interaction.
  const localConnection = selectedLocalConnection();
  if (localConnection !== undefined) headers[LOCAL_CONNECTION_HEADER] = localConnection;
  const reconnectDelays =
    client.kind === 'pwa' &&
    localConnection !== undefined &&
    retriesLocalReconnect(path, method)
      ? [...(runtime.reconnectDelaysMs ?? LOCAL_RECONNECT_DELAYS_MS)]
      : [];

  for (;;) {
    const response = await probed(() =>
      fetch(`${BASE}${path}`, {
        method,
        headers,
        ...(init.signal === undefined ? {} : { signal: init.signal }),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

    // The server hands back a fresh token once the current one is a day old.
    const renewed = response.headers.get(SESSION_TOKEN_HEADER);
    if (isCurrentSession() && renewed !== null && renewed.length > 0) session.refresh(renewed);

    // A 204 (every DELETE) has no body to parse -- and neither does a bare 201
    // (POST /files/folders answers created with nothing to add).
    if (response.status === 204) return undefined as T;
    if (response.ok) {
      const text = await response.text();
      return (text.length === 0 ? undefined : JSON.parse(text)) as T;
    }

    const error = classifyServerReachability(await toApiError(response));
    if (error.code === 'local_connection_unknown' && localConnection !== undefined) {
      clearLocalConnection(localConnection);
    }
    if (error.code === 'local_connection_unavailable' && reconnectDelays.length > 0) {
      const delay = reconnectDelays.shift();
      if (delay !== undefined) {
        await (runtime.sleep ?? wait)(delay);
        continue;
      }
    }
    // Only an expired or forged session sends the user back to the login
    // screen; a wrong password on the login form is not that.
    if (isCurrentSession() && error.code === 'invalid_session') {
      session.clear();
      onSessionLost();
    }
    throw error;
  }
}

/** A binary GET (e.g. a backup archive), returned as a Blob with the bearer token. */
export async function apiDownload(path: string): Promise<Blob> {
  return (await authenticatedDownloadResponse(`${BASE}${path}`)).blob();
}

/** Only the same-origin Files endpoint may receive the owner's bearer token. */
export async function fileDownloadResponse(url: string, signal?: AbortSignal): Promise<Response> {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin || target.pathname !== '/files/download'
    || target.username || target.password || target.hash) throw new Error('Invalid file download URL');
  return authenticatedDownloadResponse(`${target.pathname}${target.search}`, signal);
}

async function authenticatedDownloadResponse(url: string, signal?: AbortSignal): Promise<Response> {
  const token = session.token();
  const generation = session.generation();
  const isCurrentSession = (): boolean => session.generation() === generation && session.token() === token;
  const headers: Record<string, string> = clientHeaders();
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;

  const response = await probed(() => fetch(url, { headers, redirect: 'error', ...(signal === undefined ? {} : { signal }) }));
  refreshSessionFrom(response, isCurrentSession);
  if (!response.ok) throw handleSessionError(classifyServerReachability(await toApiError(response)), isCurrentSession);
  return response;
}

/** A multipart upload (e.g. an artifact), returning the parsed JSON reply. */
export async function apiUpload<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  const token = session.token();
  const generation = session.generation();
  const isCurrentSession = (): boolean => session.generation() === generation && session.token() === token;
  const headers: Record<string, string> = clientHeaders();
  // No content-type header: the browser sets the multipart boundary itself.
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;

  const response = await probed(() =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers,
      body: form,
      ...(signal === undefined ? {} : { signal }),
    }),
  );
  refreshSessionFrom(response, isCurrentSession);

  if (response.ok) return (await response.json()) as T;
  throw handleSessionError(classifyServerReachability(await toApiError(response)), isCurrentSession);
}

function refreshSessionFrom(response: Response, isCurrentSession: () => boolean): void {
  const renewed = response.headers.get(SESSION_TOKEN_HEADER);
  if (isCurrentSession() && renewed !== null && renewed.length > 0) session.refresh(renewed);
}

/** Apply the same invalid-session semantics to non-JSON request helpers. */
function handleSessionError(error: ApiError, isCurrentSession: () => boolean): ApiError {
  if (isCurrentSession() && error.code === 'invalid_session') {
    session.clear();
    onSessionLost();
  }
  return error;
}

function classifyServerReachability(error: ApiError): ApiError {
  if (error.code !== 'operation_error' || ![502, 503, 504].includes(error.status)) return error;
  healthMonitor.reportUnreachable();
  return new ApiError(
    'server_unreachable',
    'The server is temporarily unreachable. Pop Agent is reconnecting.',
    error.status,
  );
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
      retryAfterSeconds?: number;
    };
    return new ApiError(
      body.error?.code ?? 'operation_error',
      body.error?.message ?? 'Something went wrong.',
      response.status,
      body.retryAfterSeconds,
    );
  } catch {
    return new ApiError('operation_error', 'Pop Agent could not be reached.', response.status);
  }
}
