import type { HealthResponse } from '@popy/shared';

/**
 * The sidebar's health probe (popy.spec §14): a light poll of the public
 * `/v1/health` every ~10s, backing off while the tab is hidden. Silence
 * means healthy -- consumers render nothing while the report is all ok.
 *
 * Debug escape hatches (for visual tests without taking the server down):
 * `?health=mock-offline` fakes an unreachable server, `?health=mock-degraded`
 * fakes a connected-but-degraded report.
 */
export type HealthState =
  | { kind: 'ok' }
  | { kind: 'offline' }
  | { kind: 'degraded'; problems: string[] };

const POLL_MS = 10_000;

type Listener = () => void;

function mockParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('health');
  } catch {
    return null;
  }
}

class HealthMonitor {
  private state: HealthState = { kind: 'ok' };
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  getState = (): HealthState => this.state;

  private setState(state: HealthState): void {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private start(): void {
    void this.poll();
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = (): void => {
    if (!document.hidden) void this.poll();
  };

  private async poll(): Promise<void> {
    if (this.listeners.size === 0) return;
    // A hidden tab does not need a diagnosis; it waits for visibility.
    if (!document.hidden) {
      const mock = mockParam();
      if (mock === 'mock-offline') {
        this.setState({ kind: 'offline' });
      } else if (mock === 'mock-degraded') {
        this.setState({ kind: 'degraded', problems: ['provider', 'db'] });
      } else {
        try {
          const response = await fetch('/v1/health');
          if (!response.ok) throw new Error(String(response.status));
          const report = (await response.json()) as HealthResponse;
          const problems = (['provider', 'db'] as const).filter((key) => report[key] === 'error');
          this.setState(problems.length === 0 ? { kind: 'ok' } : { kind: 'degraded', problems });
        } catch {
          this.setState({ kind: 'offline' });
        }
      }
    }
    this.timer = setTimeout(() => void this.poll(), POLL_MS);
  }
}

export const healthMonitor = new HealthMonitor();
