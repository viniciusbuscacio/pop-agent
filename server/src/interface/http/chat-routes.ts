import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { ChatDTO, MessageDTO, ModelDTO } from '@popy/shared';
import type { Chat, ChatSummary, Message } from '../../domain/chat/chat.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import type { RunService } from '../../application/chat/run-service.js';
import type { ModelInfo } from '../../application/ports/agent-bridge.js';
import type { ProviderService } from '../../application/providers/provider-service.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';
import type { EventTickets } from './event-tickets.js';
import type { SseHub } from './sse-hub.js';

/**
 * Conversations, runs and the event stream (popy.spec §13).
 *
 * Sending a message answers 202 with ids and nothing else: the reply itself
 * arrives over the stream. That split is what lets a run outlive the request
 * that started it, survive a reload, and be watched from a second device.
 */

const HEARTBEAT_MS = 25_000;
const MAX_MESSAGE_LENGTH = 32_000;

const patchSchema = z
  .object({
    title: z.string().optional(),
    archived: z.boolean().optional(),
    model: z.string().optional(),
  })
  .strict();

/** 16 MB of file is ~21.4 MB of base64; the schema allows a little slack. */
const MAX_ATTACHMENT_DATA_URI = 22_400_000;
const MAX_ATTACHMENTS = 8;

const sendSchema = z
  .object({
    text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
    attachments: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            type: z.string().max(100),
            dataUri: z.string().startsWith('data:').max(MAX_ATTACHMENT_DATA_URI),
          })
          .strict(),
      )
      .max(MAX_ATTACHMENTS)
      .optional(),
  })
  .strict();

export interface ChatRoutesDeps {
  chats: ChatService;
  runs: RunService;
  providers: ProviderService;
  hub: SseHub;
  tickets: EventTickets;
}

export function createChatRoutes(deps: ChatRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/chats', (c) => {
    const archived = c.req.query('archived') === 'true';
    return c.json({ chats: deps.chats.list({ archived }).map(toChatDto) });
  });

  routes.post('/chats', (c) => c.json(toChatDto(deps.chats.create()), 201));

  routes.patch('/chats/:id', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const id = c.req.param('id');
    let chat = deps.chats.get(id);
    if (chat === undefined) return chatNotFound(c);

    if (parsed.data.title !== undefined) chat = deps.chats.rename(id, parsed.data.title) ?? chat;
    if (parsed.data.archived !== undefined) {
      chat = deps.chats.setArchived(id, parsed.data.archived) ?? chat;
    }
    if (parsed.data.model !== undefined) chat = deps.chats.setModel(id, parsed.data.model) ?? chat;

    return c.json(toChatDto(chat));
  });

  routes.delete('/chats/:id', (c) => {
    if (!deps.chats.delete(c.req.param('id'))) return chatNotFound(c);
    return c.body(null, 204);
  });

  routes.get('/chats/:id/messages', (c) => {
    const before = c.req.query('before');
    const limitParam = c.req.query('limit');
    const limit = limitParam === undefined ? undefined : Number(limitParam);
    if (limit !== undefined && !Number.isFinite(limit)) {
      return apiError(c, 400, 'invalid_field', 'limit must be a number.');
    }

    const chatId = c.req.param('id');
    const messages = deps.chats.getMessages(chatId, {
      ...(before === undefined ? {} : { before }),
      ...(limit === undefined ? {} : { limit }),
    });
    if (messages === undefined) return chatNotFound(c);

    // A client mounting mid-run gets what already streamed, not a blank
    // bubble; only the first page carries it -- history pages have no "now".
    const live = before === undefined ? deps.runs.liveRun(chatId) : undefined;
    return c.json({
      messages: messages.map(toMessageDto),
      ...(live === undefined ? {} : { live }),
    });
  });

  routes.post('/chats/:id/messages', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const result = deps.runs.startRun(
      c.req.param('id'),
      parsed.data.text,
      parsed.data.attachments ?? [],
    );
    if (!result.ok) {
      return result.reason === 'chat_not_found'
        ? chatNotFound(c)
        : apiError(c, 409, 'run_in_progress', 'This chat is already waiting on an answer.');
    }

    // 202: accepted and started. The answer arrives on the stream.
    return c.json({ runId: result.runId, userMessageId: result.userMessageId }, 202);
  });

  routes.post('/chats/:id/stop', (c) => {
    const id = c.req.param('id');
    if (deps.chats.get(id) === undefined) return chatNotFound(c);
    return c.json({ stopped: deps.runs.stopRun(id) });
  });

  routes.get('/models', async (c) => {
    const catalog = await deps.providers.models();
    return c.json({ models: catalog.models.map(toModelDto), source: catalog.source });
  });

  /** Trades a session for a short-lived ticket the EventSource URL can carry. */
  routes.post('/events/ticket', (c) => c.json({ ticket: deps.tickets.issue() }));

  routes.get('/events', (c) => {
    if (!deps.tickets.consume(c.req.query('ticket'))) {
      return apiError(c, 401, 'invalid_session', 'This stream needs a fresh ticket.');
    }

    return streamSSE(c, async (stream) => {
      const pending: string[] = [];
      let notify: (() => void) | undefined;

      const unsubscribe = deps.hub.subscribe((payload) => {
        pending.push(payload);
        notify?.();
      });

      let open = true;
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        notify?.();
      });

      while (open) {
        while (pending.length > 0) {
          const payload = pending.shift();
          if (payload !== undefined) await stream.writeSSE({ data: payload });
        }
        if (!open) break;

        // Wake on the next event, or on the heartbeat -- a comment line that
        // keeps proxies from deciding an idle stream is a dead one.
        const woken = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            notify = undefined;
            resolve(false);
          }, HEARTBEAT_MS);
          notify = () => {
            clearTimeout(timer);
            notify = undefined;
            resolve(true);
          };
        });
        if (!woken && open) await stream.write(':ka\n\n');
      }

      unsubscribe();
    });
  });

  return routes;
}

function chatNotFound(c: Context): Response {
  return apiError(c, 404, 'chat_not_found', 'That conversation does not exist.');
}

function toChatDto(chat: Chat | ChatSummary): ChatDTO {
  return {
    id: chat.id,
    title: chat.title,
    model: chat.model,
    archived: chat.archived,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    preview: 'preview' in chat ? chat.preview : '',
  };
}

function toModelDto(model: ModelInfo): ModelDTO {
  return {
    id: model.id,
    ...(model.name === undefined ? {} : { name: model.name }),
    ...(model.context === undefined ? {} : { context: model.context }),
    ...(model.pricing === undefined ? {} : { pricing: model.pricing }),
  };
}

function toMessageDto(message: Message): MessageDTO {
  return {
    id: message.id,
    chatId: message.chatId,
    role: message.role,
    content: message.content,
    thinking: message.thinking,
    tools: message.tools.map((tool) => ({
      name: tool.name,
      status: tool.status,
      detail: tool.detail,
    })),
    attachments: message.attachments.map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      dataUri: attachment.dataUri,
    })),
    createdAt: message.createdAt,
  };
}
