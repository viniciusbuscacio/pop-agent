import webpush from 'web-push';
import type {
  PushNotification,
  PushRepo,
  PushService,
  PushSubscription,
} from '../../application/ports/push-repo.js';
import type { SecretsRepo } from '../../application/ports/secrets-repo.js';

/**
 * Web Push (popy.spec §14): the server telling a phone that a run finished even
 * when the PWA is closed. The VAPID key pair is generated once and kept in the
 * secrets table, so a restart does not invalidate every subscription. A
 * subscription the push service reports gone (404/410) is deleted.
 *
 * `web-push` does the VAPID JWT and the payload encryption; this wraps it in
 * the ports the rest of the app speaks.
 */

const VAPID_PUBLIC = 'push.vapidPublicKey';
const VAPID_PRIVATE = 'push.vapidPrivateKey';
const SUBJECT = 'mailto:popy@localhost';

export class WebPushService implements PushService {
  private readonly publicKey: string;

  constructor(
    private readonly repo: PushRepo,
    secrets: SecretsRepo,
  ) {
    let publicKey = secrets.get(VAPID_PUBLIC);
    let privateKey = secrets.get(VAPID_PRIVATE);
    if (publicKey === undefined || privateKey === undefined) {
      const keys = webpush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      secrets.set(VAPID_PUBLIC, publicKey);
      secrets.set(VAPID_PRIVATE, privateKey);
    }
    webpush.setVapidDetails(SUBJECT, publicKey, privateKey);
    this.publicKey = publicKey;
  }

  /** The key the browser needs to subscribe. Safe to hand out. */
  vapidPublicKey(): string {
    return this.publicKey;
  }

  subscribe(subscription: PushSubscription): void {
    this.repo.save(subscription);
  }

  unsubscribe(endpoint: string): void {
    this.repo.delete(endpoint);
  }

  /** Sends to every subscription, dropping any the service says is gone. */
  async send(notification: PushNotification): Promise<void> {
    const payload = JSON.stringify(notification);
    await Promise.all(
      this.repo.list().map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
          );
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) this.repo.delete(subscription.endpoint);
        }
      }),
    );
  }
}
