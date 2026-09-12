import { apiRequest } from './api';

/**
 * Web Push subscription from the browser side (docs/specs/Spec-Pop-General.md §14). Asks for
 * permission, subscribes with the push service using the server's VAPID key,
 * and registers the result. All of it needs a service worker and a secure
 * context; on iOS it needs the PWA to be installed to the home screen first.
 */

export const pushService = {
  supported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  },

  async isSubscribed(): Promise<boolean> {
    if (!this.supported()) return false;
    const registration = await navigator.serviceWorker.ready;
    return (await registration.pushManager.getSubscription()) !== null;
  },

  /** Requests permission, subscribes, and registers. Returns false if declined. */
  async enable(): Promise<boolean> {
    if (!this.supported()) return false;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const { publicKey } = await apiRequest<{ publicKey: string }>('/push/key');
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const json = subscription.toJSON();
    await apiRequest('/push/subscribe', {
      method: 'POST',
      body: { endpoint: json.endpoint, keys: json.keys },
    });
    return true;
  },

  async disable(): Promise<void> {
    if (!this.supported()) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription === null) return;
    await apiRequest('/push/unsubscribe', {
      method: 'POST',
      body: { endpoint: subscription.endpoint },
    });
    await subscription.unsubscribe();
  },
};

/** VAPID keys arrive base64url; PushManager wants the raw bytes. */
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
