import { useSyncExternalStore, type ReactNode } from 'react';
import { healthMonitor } from '../services/health';

/**
 * Server-owned actions cannot succeed during an outage. Keep loaded content
 * visible, but make the route tree inert until the health probe reconnects;
 * the connection banner stays outside this gate so Try now remains available.
 */
export function ServerAvailabilityGate({ children, bypass = false }: { children: ReactNode; bypass?: boolean }) {
  const state = useSyncExternalStore(healthMonitor.subscribe, healthMonitor.getState);
  const unavailable = !bypass && (state.kind === 'offline' || state.kind === 'device-offline');
  return (
    <div
      className="contents"
      data-testid="server-availability-gate"
      data-server-unavailable={unavailable ? 'true' : 'false'}
      inert={unavailable}
    >
      {children}
    </div>
  );
}
