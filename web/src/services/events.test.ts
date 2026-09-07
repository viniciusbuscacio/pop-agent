// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventStream, type EventStreamEnvironment } from './events';

class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  closed = false;

  constructor(url: string) {
    super();
    this.url = url;
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  fail(): void {
    this.dispatchEvent(new Event('error'));
  }

  message(value: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness() {
  const ticketRequests: Deferred<string>[] = [];
  const sources: FakeEventSource[] = [];
  const environment: EventStreamEnvironment = {
    issueTicket: () => {
      const request = deferred<string>();
      ticketRequests.push(request);
      return request.promise;
    },
    open: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source as unknown as EventSource;
    },
    document,
    window,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => clearTimeout(handle),
  };
  return { stream: createEventStream(environment), ticketRequests, sources };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('event stream lifecycle', () => {
  it('keeps one connection while the ticket request is in flight', async () => {
    const { stream, ticketRequests, sources } = harness();

    stream.start();
    stream.start();

    expect(ticketRequests).toHaveLength(1);
    ticketRequests[0]!.resolve('ticket-1');
    await settle();
    expect(sources.map((source) => source.url)).toEqual(['/v1/events?ticket=ticket-1']);
    stream.stop();
  });

  it('ignores a ticket response from before stop and restart', async () => {
    const { stream, ticketRequests, sources } = harness();

    stream.start();
    stream.stop();
    stream.start();
    expect(ticketRequests).toHaveLength(2);

    ticketRequests[0]!.resolve('stale');
    await settle();
    expect(sources).toHaveLength(0);

    ticketRequests[1]!.resolve('current');
    await settle();
    expect(sources[0]?.url).toBe('/v1/events?ticket=current');
    stream.stop();
  });

  it('retries with a fresh ticket and refreshes snapshots after opening', async () => {
    const { stream, ticketRequests, sources } = harness();
    const resume = vi.fn();
    stream.onResume(resume);
    stream.start();
    ticketRequests[0]!.resolve('first');
    await settle();
    sources[0]!.open();

    sources[0]!.fail();
    expect(sources[0]!.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(ticketRequests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticketRequests).toHaveLength(2);

    ticketRequests[1]!.resolve('second');
    await settle();
    sources[1]!.open();
    expect(sources[1]?.url).toBe('/v1/events?ticket=second');
    expect(resume).toHaveBeenCalledOnce();
    stream.stop();
  });

  it('forces a replacement after returning from the background', async () => {
    const { stream, ticketRequests, sources } = harness();
    const resume = vi.fn();
    stream.onResume(resume);
    stream.start();
    ticketRequests[0]!.resolve('first');
    await settle();
    sources[0]!.open();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(sources[0]!.closed).toBe(true);
    expect(ticketRequests).toHaveLength(2);
    expect(resume).not.toHaveBeenCalled();
    ticketRequests[1]!.resolve('after-resume');
    await settle();
    sources[1]!.open();
    expect(resume).toHaveBeenCalledOnce();
    stream.stop();
  });

  it('replaces the source after a back-forward cache restore', async () => {
    const { stream, ticketRequests, sources } = harness();
    const resume = vi.fn();
    stream.onResume(resume);
    stream.start();
    ticketRequests[0]!.resolve('first');
    await settle();
    sources[0]!.open();

    const pageShow = Object.assign(new Event('pageshow'), { persisted: true });
    window.dispatchEvent(pageShow);

    expect(sources[0]!.closed).toBe(true);
    expect(ticketRequests).toHaveLength(2);
    expect(resume).not.toHaveBeenCalled();
    stream.stop();
  });

  it('does not let a superseded source schedule another retry', async () => {
    const { stream, ticketRequests, sources } = harness();
    stream.start();
    ticketRequests[0]!.resolve('first');
    await settle();
    sources[0]!.open();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    ticketRequests[1]!.resolve('replacement');
    await settle();
    sources[1]!.open();

    sources[0]!.fail();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(ticketRequests).toHaveLength(2);
    stream.stop();
  });

  it('drops messages from a source replaced by foreground recovery', async () => {
    const { stream, ticketRequests, sources } = harness();
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.start();
    ticketRequests[0]!.resolve('first');
    await settle();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    sources[0]!.message({ kind: 'local-machines-changed' });

    expect(listener).not.toHaveBeenCalled();
    stream.stop();
  });
});
