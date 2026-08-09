import { randomUUID } from 'node:crypto';
import type {
  ProviderAuthEvent,
  ProviderAuthInteraction,
  ProviderAuthPrompt,
} from '../ports/agent-bridge.js';
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
  /** Overridable so the timeout test does not wait ten minutes. */
  timeoutMs?: number;
}

interface Flow {
  state: OAuthFlowState;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  resolvePrompt: ((value: string) => void) | undefined;
}

export class OAuthFlowService {
  private flow: Flow | undefined;

  constructor(private readonly deps: OAuthFlowServiceDeps) {}

  /** Starts the provider's login flow, cancelling any flow already running. */
  start(providerId: string): { flowId: string } {
    const definition = providerDefinition(providerId);
    if (definition === undefined || definition.authType !== 'oauth') {
      throw new Error(`"${providerId}" is not an OAuth provider`);
    }
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
    };
    flow.timer.unref?.();
    this.flow = flow;

    const interaction: ProviderAuthInteraction = {
      signal: controller.signal,
      prompt: (prompt) => {
        // The sign-in's own heartbeat, journaled: which question is up, when.
        // The credential can land long before the login promise resolves, and
        // only the journal says which side stopped talking (Vinicius, 08/08).
        console.log(`pop oauth: ${providerId} asks ${prompt.type}`);
        return this.ask(flow, prompt);
      },
      notify: (event) => {
        if (!flow.state.done) flow.state.events.push(sanitizeEvent(event));
      },
    };

    console.log(`pop oauth: ${providerId} flow started`);
    this.deps.login(providerId, interaction).then(
      () => {
        console.log(`pop oauth: ${providerId} login resolved`);
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
    flow.state.ok = error === undefined;
    if (error !== undefined) flow.state.error = error;
    console.log(
      `pop oauth: ${flow.state.providerId} finished ok=${flow.state.ok}${error === undefined ? '' : ` (${error})`}`,
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
