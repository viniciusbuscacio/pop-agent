export type PwaInstallStatus = 'available' | 'installed' | 'unavailable';

interface InstallChoice {
  outcome: 'accepted' | 'dismissed';
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<InstallChoice>;
}

type Listener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | undefined;
let installed = runningStandalone();
const listeners = new Set<Listener>();

function runningStandalone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Chromium decides when an install prompt is eligible. Capture it at module
 * load, before Settings is opened, because the browser may emit it only once.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    installed = true;
    notify();
  });
}

export function pwaInstallStatus(): PwaInstallStatus {
  if (installed || runningStandalone()) return 'installed';
  return deferredPrompt === undefined ? 'unavailable' : 'available';
}

export function subscribePwaInstall(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the browser-owned confirmation. A web page can never install silently. */
export async function installPwa(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredPrompt;
  if (prompt === undefined) return 'unavailable';
  deferredPrompt = undefined;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === 'accepted') installed = true;
  notify();
  return choice.outcome;
}
