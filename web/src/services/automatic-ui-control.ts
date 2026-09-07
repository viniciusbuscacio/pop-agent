import { clientEnvironment } from './api';
import { integrationsService, restApiStatus } from './integrations';
import { uiControl } from './ui-control';

/** The signed-in app follows the REST Server switch; retries registration only. */
export function startAutomaticUiControl(): () => void {
  let stopped = false;
  let connecting = false;
  const reconcile = (): void => {
    if (stopped) return;
    if (restApiStatus.getState() !== true) { uiControl.stop(); return; }
    if (connecting || uiControl.getState().connected) return;
    connecting = true;
    const client = clientEnvironment();
    void uiControl.start(`${client.platform} · ${client.appLabel}`).catch(async () => {
      if (!stopped) await integrationsService.settings().catch(() => undefined);
    }).finally(() => { connecting = false; });
  };
  const unsubscribe = restApiStatus.subscribe(reconcile);
  const timer = setInterval(reconcile, 5000);
  window.addEventListener('pageshow', reconcile);
  window.addEventListener('online', reconcile);
  reconcile();
  return () => {
    stopped = true; clearInterval(timer); unsubscribe();
    window.removeEventListener('pageshow', reconcile);
    window.removeEventListener('online', reconcile);
    uiControl.stop();
  };
}
