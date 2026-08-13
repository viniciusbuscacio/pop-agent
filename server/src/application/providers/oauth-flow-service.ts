import { randomUUID } from 'node:crypto';
import type {
  ProviderAuthEvent,
  ProviderAuthInteraction,
  ProviderAuthPrompt,
} from '../ports/agent-bridge.js';
import type { OAuthCooldownStore } from '../ports/oauth-cooldown-store.js';
import { oauthFailureCode } from './oauth-diagnostic.js';
import { providerDefinition } from './provider-definitions.js';

/**
 * One interactive OAuth login at a time (pop-agent.spec §15, fase 1.5). The
 * engine's flow runs on the server; the browser only sees a transcript --
 * events to show, at most one question to answer -- and answers it with
 * `submit`. Token material never enters this service: the credential goes
 * from the flow straight into the engine's own store.
 *
 * Single-user install, single active flow: starting a new one cancels the
 * previous, and a flow that nobody finishes times out on its own.
 */

const FLOW_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Fallback when a rate-limited provider gives no Retry-After. GitHub remained
 * at 429 after retries tens of minutes apart, so one minute was not a real
 * brake. The deadline is persisted: restarting Pop must not bypass it.
 */
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Thrown by {@link OAuthFlowService.start} when the provider is still cooling
 * down from a rate limit. The route turns it into HTTP 429 with Retry-After,
 * so the browser shows the wait instead of hammering the provider again.
 */
export class OAuthCooldownError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(
      `Wait ${String(retryAfterSeconds)}s before signing in to "${providerId}" again -- the provider is rate-limiting the sign-in.`,
    );
    this.name = 'OAuthCooldownError';
  }
}

/** The one question waiting for the user, shorn of everything else. */
export interface PendingPrompt {
  type: 'text' | 'secret' | 'manual_code' | 'select';
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
}

/** What the browser polls: a transcript, never a secret. */
export interface OAuthFlowState {
  flowId: string;
  providerId: string;
  events: ProviderAuthEvent[];
  pending?: PendingPrompt;
  done: boolean;
  ok?: boolean;
  error?: string;
}

export interface OAuthFlowServiceDeps {
  /** The engine's login flow, behind the port. Persists the credential itself. */
  login: (providerId: string, interaction: ProviderAuthInteraction) => Promise<void>;
  /** Told when a sign-in lands, e.g. to forgive the provider's cooldown. */
  onSuccess?: (providerId: string) => void;
  /** Persists rate-limit windows so restarting Pop cannot bypass the provider's brake. */
  cooldownStore?: OAuthCooldownStore;
  /** Overridable so the timeout test does not wait ten minutes. */
  timeoutMs?: number;
  /** Overridable so cooldown tests need not wait a real hour. */
  rateLimitCooldownMs?: number;
}

interface Flow {
  state: OAuthFlowState;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  resolvePrompt: ((value: string) => void) | undefined;
  startedAt: number;
  stage: string;
}

export class OAuthFlowService {
  private flow: Flow | undefined;
  /** Per-provider earliest wall-clock time a fresh flow may start again. */
  private readonly cooldownUntil = new Map<string, number>();

  constructor(private readonly deps: OAuthFlowServiceDeps) {}

  /** Starts the provider's login flow, cancelling any flow already running. */
  start(providerId: string): { flowId: string } {
    const definition = providerDefinition(providerId);
    if (definition === undefined || definition.authType !== 'oauth') {
      throw new Error(`"${providerId}" is not an OAuth provider`);
    }
    // A provider still cooling down from a 429 is refused before anything is
    // torn down: the running flow (if any) survives, and the caller learns
    // exactly how long to wait rather than feeding the provider's rate limit.
    const now = Date.now();
    const until = Math.max(
      this.cooldownUntil.get(providerId) ?? 0,
      this.deps.cooldownStore?.get(providerId) ?? 0,
    );
    if (now < until) {
      throw new OAuthCooldownError(providerId, Math.ceil((until - now) / 1000));
    }
    this.clearCooldown(providerId);
    this.cancel();

    const controller = new AbortController();
    const flow: Flow = {
      state: {
        flowId: randomUUID(),
        providerId,
        events: [],
        done: false,
      },
      controller,
      timer: setTimeout(() => {
        this.abort(flow, 'The sign-in took too long and was abandoned.');
      }, this.deps.timeoutMs ?? FLOW_TIMEOUT_MS),
      resolvePrompt: undefined,
      startedAt: now,
      stage: 'started',
    };
    flow.timer.unref?.();
    this.flow = flow;

    const interaction: ProviderAuthInteraction = {
      signal: controller.signal,
      prompt: (prompt) => {
        // Record the shape, never the prompt or answer: either may be secret.
        this.markStage(flow, `prompt_${prompt.type}`);
        return this.ask(flow, prompt);
      },
      notify: (event) => {
        if (flow.state.done) return;
        flow.state.events.push(sanitizeEvent(event));
        // Event type is enough to distinguish device-code polling from model
        // setup without journaling the user code, URL, or provider prose.
        this.markStage(flow, `event_${event.type}`);
      },
    };

    this.log(flow, 'result=running');
    this.deps.login(providerId, interaction).then(
      () => {
        this.markStage(flow, 'credential_saved');
        this.finish(flow, undefined);
        // Only a flow that really landed counts -- a cancel that raced the
        // login's own resolution keeps ok=false and stays penalized.
        if (flow.state.ok === true) this.deps.onSuccess?.(providerId);
      },
      (error: unknown) =>
        this.finish(flow, flow.state.error ?? messageOf(error) ?? 'The sign-in failed.'),
    );

    return { flowId: flow.state.flowId };
  }

  /** The current flow's transcript, or undefined when none was ever started. */
  state(): OAuthFlowState | undefined {
    return this.flow?.state;
  }

  /** Answers the pending question. False when nothing was waiting. */
  submit(value: string): boolean {
    const flow = this.flow;
    if (flow === undefined || flow.state.done || flow.resolvePrompt === undefined) return false;
    const resolve = flow.resolvePrompt;
    flow.resolvePrompt = undefined;
    delete flow.state.pending;
    resolve(value);
    return true;
  }

  /** Aborts the running flow, if any. Safe to call with nothing running. */
  cancel(): void {
    const flow = this.flow;
    if (flow === undefined || flow.state.done) return;
    this.abort(flow, 'The sign-in was cancelled.');
  }

  private ask(flow: Flow, prompt: ProviderAuthPrompt): Promise<string> {
    if (flow.state.done) return Promise.reject(new Error('the flow is over'));
    return new Promise<string>((resolve, reject) => {
      flow.resolvePrompt = resolve;
      flow.state.pending = sanitizePrompt(prompt);
      const onAbort = (): void => {
        flow.resolvePrompt = undefined;
        delete flow.state.pending;
        reject(new Error('the sign-in was aborted'));
      };
      flow.controller.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private abort(flow: Flow, reason: string): void {
    // Recorded before the abort so the login rejection cannot overwrite it
    // with the SDK's own wording.
    flow.state.error = reason;
    flow.controller.abort();
    // The flow's promise settles the state; but a login that ignores the
    // signal must not leave the UI spinning forever.
    this.finish(flow, reason);
  }

  private finish(flow: Flow, error: string | undefined): void {
    if (flow.state.done) return;
    clearTimeout(flow.timer);
    flow.resolvePrompt = undefined;
    delete flow.state.pending;
    flow.state.done = true;
    // pi surfaces a failed login with the provider's raw HTTP body attached --
    // a GitHub 503 dragged its entire Unicorn HTML page into the transcript
    // (Vinicius, 13/08). The wire only ever carries a short, tag-free line.
    const clean = error === undefined ? undefined : sanitizeError(error);
    flow.state.ok = clean === undefined;
    if (clean !== undefined) flow.state.error = clean;
    // A rate-limited sign-in arms a cooldown so the next attempt waits for the
    // provider's window to drain instead of escalating the 429.
    if (error !== undefined && isRateLimit(error)) {
      const fallback = this.deps.rateLimitCooldownMs ?? RATE_LIMIT_COOLDOWN_MS;
      const until = Date.now() + (retryAfterMs(error) ?? fallback);
      this.cooldownUntil.set(flow.state.providerId, until);
      this.deps.cooldownStore?.set(flow.state.providerId, until);
    }
    this.log(
      flow,
      clean === undefined ? 'result=ok' : `result=error error=${oauthFailureCode(error ?? clean)}`,
    );
  }

  private clearCooldown(providerId: string): void {
    this.cooldownUntil.delete(providerId);
    this.deps.cooldownStore?.set(providerId, undefined);
  }

  private markStage(flow: Flow, stage: string): void {
    if (flow.state.done) return;
    flow.stage = stage;
    this.log(flow, 'result=running');
  }

  /** One bounded, token-free line per transition. */
  private log(flow: Flow, result: string): void {
    const duration = Math.max(0, Date.now() - flow.startedAt);
    console.log(
      `pop oauth: provider=${flow.state.providerId} flow=${flow.state.flowId.slice(0, 8)} stage=${flow.stage} ${result} duration_ms=${String(duration)}`,
    );
  }
}

/** Copies only the fields the wire may carry; anything else is dropped. */
function sanitizeEvent(event: ProviderAuthEvent): ProviderAuthEvent {
  switch (event.type) {
    case 'info':
      return {
        type: 'info',
        message: event.message,
        ...(event.links === undefined
          ? {}
          : {
              links: event.links.map((link) => ({
                url: link.url,
                ...(link.label === undefined ? {} : { label: link.label }),
              })),
            }),
      };
    case 'auth_url':
      return {
        type: 'auth_url',
        url: event.url,
        ...(event.instructions === undefined ? {} : { instructions: event.instructions }),
      };
    case 'device_code':
      return {
        type: 'device_code',
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
        ...(event.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: event.expiresInSeconds }),
      };
    case 'progress':
      return { type: 'progress', message: event.message };
  }
}

function sanitizePrompt(prompt: ProviderAuthPrompt): PendingPrompt {
  if (prompt.type === 'select') {
    return {
      type: 'select',
      message: prompt.message,
      options: prompt.options.map((option) => ({
        id: option.id,
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
      })),
    };
  }
  return {
    type: prompt.type,
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
  };
}

function messageOf(error: unknown): string | undefined {
  return error instanceof Error && error.message.length > 0 ? error.message : undefined;
}

/** A too-fast device-flow retry comes back as a bare 429 (GitHub Copilot). */
function isRateLimit(message: string): boolean {
  return /\b429\b|too many requests/i.test(message);
}

/** Honor a numeric Retry-After when an upstream adapter includes it. */
function retryAfterMs(message: string): number | undefined {
  const match = message.match(
    /retry[- ]after(?:\s*[:=]|\s+)\s*(\d{1,6})(?:\s*(?:s|sec|seconds?))?/i,
  );
  if (match?.[1] === undefined) return undefined;
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
  return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
}

/** Cap on any error line that reaches the browser -- long enough to be useful. */
const MAX_ERROR_LENGTH = 200;

/**
 * Collapses a login failure into one short, tag-free line fit for the UI.
 *
 * pi attaches the provider's raw HTTP response to the rejection, so a 503 or
 * 502 arrives as `503 Service Unavailable: <!DOCTYPE html> ...` -- a whole
 * error page, base64 logos and all. When the message opens with an HTTP
 * status, only `HTTP <code> <reason>` survives and the body is dropped;
 * otherwise any markup is stripped and the rest is clamped to a sane length.
 */
function sanitizeError(error: string): string {
  const raw = error.trim();
  const status = raw.match(/^(\d{3})\b[ \t]*([A-Za-z][A-Za-z .-]*)?/);
  if (status !== null) {
    const reason = (status[2] ?? '').trim();
    return `HTTP ${status[1]}${reason.length > 0 ? ` ${reason}` : ''}`;
  }
  const stripped = raw
    .replace(/<!doctype[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length === 0) return 'The sign-in failed.';
  return stripped.length > MAX_ERROR_LENGTH ? `${stripped.slice(0, MAX_ERROR_LENGTH)}…` : stripped;
}
