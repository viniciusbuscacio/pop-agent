import type { HealthResponse } from '@pop-agent/shared';

/**
 * The connection monitor (docs/specs/Spec-Pop-General.md §14). It answers one question on the
 * user's behalf -- can this app still reach its server? -- and it keeps the
 * two ways of answering no apart, because they need different words and
 * different actions. A phone with no signal is the user's to fix; a server
 * that stopped answering is not, and being told so is the whole point:
 * otherwise the first suspect is always the wi-fi.
 *
 * The cadence follows the answer. Healthy, this is a keepalive -- one cheap
 * GET a minute, enough to notice a server that went away while the user sat
 * reading. Unreachable, it retries after 1s and exponentially backs off to a
 * 10s cap, because short deployment restarts should unlock the app promptly.
 *
 * Nothing runs while the page is hidden. iOS freezes a backgrounded PWA within
 * seconds anyway, so a timer that survived would only resume holding a verdict
 * from whenever the system suspended it. The poll stops on the way out and
 * fires immediately on the way back in -- which is why the wake-up probe
 * matters more than the interval: what is on screen after a night in a pocket
 * must never be an old answer.
 *
 * Debug escape hatches (for visual tests without taking the server down):
 * `?health=mock-offline` fakes an unreachable server, `?health=mock-device`
 * fakes a phone with no network, `?health=mock-degraded` fakes a
 * connected-but-degraded report.
 */
export type HealthState =
  | { kind: 'ok' }
  | { kind: 'device-offline' }
  | { kind: 'offline' }
  | { kind: 'degraded'; problems: string[] };

/** Healthy: a keepalive, not a heartbeat. */
const KEEPALIVE_MS = 60_000;
/** Unreachable: recover quickly from a restart, then cap at one probe per 10 seconds. */
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 10_000;

type Listener = () => void;

function mockParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('health');
  } catch {
    return null;
  }
}

/** `navigator.onLine === false` is certain; `true` only means "worth a try". */
function deviceIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

class HealthMonitor {
  private state: HealthState = { kind: 'ok' };
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = FIRST_RETRY_MS;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  getState = (): HealthState => this.state;

  /** The banner's "Try now": ask again this instant, whatever the timer says. */
  checkNow = (): void => {
    void this.poll();
  };

  /**
   * A real request just failed to reach the server (services/api). Letting the
   * keepalive discover that up to a minute later would leave the user staring
   * at a send that did nothing with no explanation on screen, so the verdict is
   * published now and the retry cadence takes over from here.
   */
  reportUnreachable = (): void => {
    // Nobody subscribed means nothing renders and no timer should be left
    // running -- the monitor is stopped, and a stray request does not start it.
    if (this.listeners.size === 0 || this.mocked()) return;
    this.setState(deviceIsOffline() ? { kind: 'device-offline' } : { kind: 'offline' });
    this.schedule(this.nextDelay());
  };

  /**
   * A real request just succeeded. That is better evidence than any poll, so a
   * banner still up from a blip comes down without waiting for the next probe.
   * It only clears the unreachable verdicts: whether the provider or the db is
   * sick is not something an unrelated 200 can vouch for.
   */
  reportReachable = (): void => {
    if (this.listeners.size === 0 || this.mocked()) return;
    if (this.state.kind !== 'offline' && this.state.kind !== 'device-offline') return;
    this.setState({ kind: 'ok' });
    this.schedule(this.nextDelay());
  };

  /**
   * A faked verdict has to survive the real traffic around it. The login
   * screen alone asks `/auth/state` and gets a 200, which would clear a
   * mocked outage before anyone could photograph it -- the hatch exists
   * precisely to look at the banner on a server that is perfectly fine.
   */
  private mocked(): boolean {
    return mockParam() !== null;
  }

  private setState(state: HealthState): void {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private start(): void {
    document.addEventListener('visibilitychange', this.onVisibility);
    // Safari restoring a frozen page does not always fire visibilitychange,
    // but it does fire pageshow -- the same pair services/events relies on.
    window.addEventListener('pageshow', this.wake);
    window.addEventListener('pagehide', this.sleep);
    // The radio changing its mind is a reason to ask again immediately.
    window.addEventListener('online', this.wake);
    window.addEventListener('offline', this.wake);
    this.wake();
  }

  private stop(): void {
    this.sleep();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pageshow', this.wake);
    window.removeEventListener('pagehide', this.sleep);
    window.removeEventListener('online', this.wake);
    window.removeEventListener('offline', this.wake);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.sleep();
    else this.wake();
  };

  private sleep = (): void => {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  };

  private wake = (): void => {
    void this.poll();
  };

  private schedule(ms: number): void {
    this.sleep();
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  /** Healthy or merely degraded, the server answered: back to keepalive pace. */
  private nextDelay(): number {
    if (this.state.kind === 'ok' || this.state.kind === 'degraded') {
      this.retryMs = FIRST_RETRY_MS;
      return KEEPALIVE_MS;
    }
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    return delay;
  }

  private async poll(): Promise<void> {
    this.sleep();
    // Nobody is watching, or the page is in the background: no probe, no timer.
    // Whatever wakes the page calls this again.
    if (this.listeners.size === 0 || document.hidden) return;

    const mock = mockParam();
    if (mock === 'mock-offline') {
      this.setState({ kind: 'offline' });
    } else if (mock === 'mock-device') {
      this.setState({ kind: 'device-offline' });
    } else if (mock === 'mock-degraded') {
      this.setState({ kind: 'degraded', problems: ['provider', 'db'] });
    } else if (deviceIsOffline()) {
      // No request can succeed with the radio down; asking anyway only spends
      // battery, and the `online` event is what moves us off this state.
      this.setState({ kind: 'device-offline' });
    } else {
      try {
        // no-store: a cached 200 would report a server that answered minutes ago.
        const response = await fetch('/v1/health', { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const report = (await response.json()) as HealthResponse;
        const problems = (['provider', 'db'] as const).filter((key) => report[key] === 'error');
        this.setState(problems.length === 0 ? { kind: 'ok' } : { kind: 'degraded', problems });
      } catch {
        this.setState(deviceIsOffline() ? { kind: 'device-offline' } : { kind: 'offline' });
      }
    }

    this.schedule(this.nextDelay());
  }
}

export const healthMonitor = new HealthMonitor();
