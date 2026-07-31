import { SESSION_TOKEN_HEADER } from '@popy/shared';
import { session } from './session';

/**
 * The only module in the app that calls `fetch` (popy.spec §14, enforced by
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

export async function apiRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = session.token();
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  // The server hands back a fresh token once the current one is a day old.
  const renewed = response.headers.get(SESSION_TOKEN_HEADER);
  if (renewed !== null && renewed.length > 0) session.refresh(renewed);

  if (response.ok) return (await response.json()) as T;

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

  const response = await fetch(`${BASE}${path}`, { headers });
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

/** A multipart upload (e.g. an artifact), returning the parsed JSON reply. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const token = session.token();
  const headers: Record<string, string> = {};
  // No content-type header: the browser sets the multipart boundary itself.
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: form });
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
    return new ApiError('operation_error', 'Popy could not be reached.', response.status);
  }
}
