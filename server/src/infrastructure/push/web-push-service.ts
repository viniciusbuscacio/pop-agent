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

/**
 * The VAPID `sub` claim: a contact URI for this application server. It looks
 * like a formality and is not one -- **Apple's push service validates it and
 * answers 403 `BadJwtToken` when it does not like what it sees**, so a
 * placeholder here means an iPhone never rings, with nothing in the UI to say
 * why (measured against web.push.apple.com, 01/08/2026: `mailto:popy@localhost`
 * -> 403 BadJwtToken; the URL below -> 201 Created).
 *
 * `@localhost` is the trap: it is a perfectly good address for a machine
 * talking to itself and not a domain Apple will accept. The default is the
 * project's own public URL, which is a real contact point for whoever runs
 * this server; POPY_PUSH_SUBJECT replaces it with the operator's own address.
 */
const DEFAULT_SUBJECT = 'https://github.com/viniciusbuscacio/popy';

/** A host with a dot in it -- `localhost` and bare names are what Apple rejects. */
const DOMAIN = /^[^\s@<>]+\.[^\s@<>.]+$/;

/** An address with no room for a stray space or an angle bracket either. */
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>.]+$/;

/**
 * Picks the subject to sign with. An operator override that would be rejected
 * upstream is dropped for the default rather than honoured: a typo in an
 * environment variable must not silently switch every notification off.
 */
export function vapidSubject(configured?: string): string {
  const candidate = configured?.trim() ?? '';
  if (candidate.length === 0) return DEFAULT_SUBJECT;

  if (candidate.startsWith('mailto:')) {
    return ADDRESS.test(candidate.slice('mailto:'.length)) ? candidate : DEFAULT_SUBJECT;
  }

  if (candidate.startsWith('https://')) {
    try {
      return DOMAIN.test(new URL(candidate).hostname) ? candidate : DEFAULT_SUBJECT;
    } catch {
      return DEFAULT_SUBJECT;
    }
  }

  return DEFAULT_SUBJECT;
}

export class WebPushService implements PushService {
  private readonly publicKey: string;

  constructor(
    private readonly repo: PushRepo,
    secrets: SecretsRepo,
    /** POPY_PUSH_SUBJECT, when the operator wants their own contact URI. */
    subject?: string,
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
    webpush.setVapidDetails(vapidSubject(subject), publicKey, privateKey);
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
