import {
  CLIENT_HEADER,
  CLIENT_PLATFORM_HEADER,
  LOCAL_CONNECTION_HEADER,
  SESSION_TOKEN_HEADER,
} from '@pop-agent/shared';
import { healthMonitor } from './health';
import { session } from './session';
import { selectedLocalConnection } from './local-connection-selection';

/**
 * The only module in the app that calls `fetch` (pop-agent.spec §14, enforced by
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
 * nothing on screen to explain it. An answer -- any answer, a 500 included --
 * proves the opposite just as fast.
 */
async function probed(request: () => Promise<Response>): Promise<Response> {
  try {
    const response = await request();
    healthMonitor.reportReachable();
    return response;
  } catch (error) {
    healthMonitor.reportUnreachable();
    throw error;
  }
}

/**
 * Which client this is, and what it is running on (pop-agent.spec §13).
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
    appLabel: kind === 'pwa' ? 'Installed PWA' : 'Web browser',
  };
}

function clientHeaders(): Record<string, string> {
  const client = clientEnvironment();
  return {
    [CLIENT_HEADER]: client.kind,
    [CLIENT_PLATFORM_HEADER]: client.platform,
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

export async function apiRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = session.token();
  const headers: Record<string, string> = clientHeaders();
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  const localConnection = selectedLocalConnection();
  if (localConnection !== undefined) headers[LOCAL_CONNECTION_HEADER] = localConnection;

  const response = await probed(() =>
    fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );

  // The server hands back a fresh token once the current one is a day old.
  const renewed = response.headers.get(SESSION_TOKEN_HEADER);
  if (renewed !== null && renewed.length > 0) session.refresh(renewed);

  // A 204 (every DELETE) has no body to parse -- and neither does a bare 201
  // (POST /files/folders answers created with nothing to add).
  if (response.status === 204) return undefined as T;
  if (response.ok) {
    const text = await response.text();
    return (text.length === 0 ? undefined : JSON.parse(text)) as T;
  }

  const error = await toApiError(response);
  // Only an expired or forged session sends the user back to the login
  // screen; a wrong password on the login form is not that.
  if (error.code === 'invalid_session') {
    session.clear();
    onSessionLost();
  }
  throw error;
}

/** A binary GET (e.g. a backup archive), returned as a Blob with the bearer token. */
export async function apiDownload(path: string): Promise<Blob> {
  const token = session.token();
  const headers: Record<string, string> = {};
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;

  const response = await probed(() => fetch(`${BASE}${path}`, { headers }));
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

/** A multipart upload (e.g. an artifact), returning the parsed JSON reply. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const token = session.token();
  const headers: Record<string, string> = {};
  // No content-type header: the browser sets the multipart boundary itself.
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;

  const response = await probed(() =>
    fetch(`${BASE}${path}`, { method: 'POST', headers, body: form }),
  );
  const renewed = response.headers.get(SESSION_TOKEN_HEADER);
  if (renewed !== null && renewed.length > 0) session.refresh(renewed);

  if (response.ok) return (await response.json()) as T;
  throw await toApiError(response);
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
