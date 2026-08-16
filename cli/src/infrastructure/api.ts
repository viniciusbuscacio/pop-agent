import {
  CLIENT_HEADER,
  CLIENT_PLATFORM_HEADER,
  LOCAL_CONNECTION_HEADER,
  SESSION_TOKEN_HEADER,
} from '@pop-agent/shared';
import type {
  ChatDTO,
  ChatListResponse,
  EventTicketResponse,
  LoginResponse,
  MessagesResponse,
  SendMessageResponse,
  SessionCommandName,
  SessionCommandResponse,
  SessionForkPointDTO,
  UpdateStatusResponse,
} from '@pop-agent/shared';

/**
 * The one place `pop` speaks HTTP (docs/cli.md, "The wire"). Same rule the
 * PWA follows: nothing else in the client calls `fetch`, so the base URL, the
 * bearer token and token renewal live in one file.
 *
 * Renewal is the part that is easy to miss and expensive to skip: the server
 * hands back a fresh token in `x-pop-agent-token` once the current one is a day
 * old (spec §9), and a client that ignored it would be signed out on a
 * schedule for no reason.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  url: string;
  token?: string;
  /** Told when the server issues a fresh token, so the profile can store it. */
  onToken?: (token: string) => void;
  /**
   * This terminal's local connection, read at call time and not captured:
   * the socket may attach after the first request and drop before the last.
   * Undefined means the message names no machine, and the run gets the
   * server's tools only (docs/cli.md, Whose local access).
   */
  localConnectionId?: () => string | undefined;
  /** Injected so tests never open a socket. */
  fetch?: typeof globalThis.fetch;
}

export class PopAgentApi {
  private readonly http: typeof globalThis.fetch;

  constructor(private readonly options: ApiOptions) {
    this.http = options.fetch ?? globalThis.fetch;
  }

  login(password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('/login', { method: 'POST', body: { password } });
  }

  chats(): Promise<ChatListResponse> {
    return this.request<ChatListResponse>('/chats');
  }

  updateStatus(): Promise<UpdateStatusResponse> {
    return this.request<UpdateStatusResponse>('/update/status');
  }

  createChat(): Promise<ChatDTO> {
    return this.request<ChatDTO>('/chats', { method: 'POST' });
  }

  messages(chatId: string): Promise<MessagesResponse> {
    return this.request<MessagesResponse>(`/chats/${chatId}/messages`);
  }

  /** Fire and return: the answer arrives on the stream, not here. */
  send(chatId: string, text: string): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: { text },
    });
  }

  stop(chatId: string): Promise<void> {
    return this.request<void>(`/chats/${chatId}/stop`, { method: 'POST' });
  }

  sessionCommand(chatId: string, command: SessionCommandName, argument = ''): Promise<SessionCommandResponse> {
    return this.request<SessionCommandResponse>(`/chats/${chatId}/commands`, {
      method: 'POST', body: { command, ...(argument.length === 0 ? {} : { argument }) },
    });
  }

  forkPoints(chatId: string): Promise<{ points: SessionForkPointDTO[] }> {
    return this.request<{ points: SessionForkPointDTO[] }>(`/chats/${chatId}/fork-points`);
  }

  /** EventSource cannot send a header, so the stream is opened with a ticket. */
  eventTicket(): Promise<EventTicketResponse> {
    return this.request<EventTicketResponse>('/events/ticket', { method: 'POST' });
  }

  /** The raw stream response; the caller reads and parses `text/event-stream`. */
  openEvents(ticket: string): Promise<Response> {
    return this.http(`${this.options.url}/v1/events?ticket=${encodeURIComponent(ticket)}`);
  }

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {
      // Set here and nowhere else, so every call carries it -- including the
      // ones nobody has written yet (pop-agent.spec §13).
      [CLIENT_HEADER]: 'cli',
      [CLIENT_PLATFORM_HEADER]: process.platform,
    };
    const localConnectionId = this.options.localConnectionId?.();
    if (localConnectionId !== undefined) headers[LOCAL_CONNECTION_HEADER] = localConnectionId;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (this.options.token !== undefined) headers['authorization'] = `Bearer ${this.options.token}`;

    const response = await this.http(`${this.options.url}/v1${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    const renewed = response.headers.get(SESSION_TOKEN_HEADER);
    if (renewed !== null && renewed.length > 0) this.options.onToken?.(renewed);

    if (response.status === 204) return undefined as T;
    if (response.ok) return (await response.json()) as T;
    throw await toApiError(response);
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(
      body.error?.code ?? 'operation_error',
      body.error?.message ?? 'Something went wrong.',
      response.status,
    );
  } catch {
    // A body that is not JSON is usually a proxy in the way, not Pop Agent.
    return new ApiError('operation_error', `The server answered ${String(response.status)}.`, response.status);
  }
}
