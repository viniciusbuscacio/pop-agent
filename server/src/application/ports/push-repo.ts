/**
 * Persistence for Web Push subscriptions (pop-agent.spec §14). A subscription is a
 * browser's endpoint plus the keys to encrypt for it.
 */
export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushRepo {
  list(): PushSubscription[];
  save(subscription: PushSubscription): void;
  delete(endpoint: string): void;
}

export interface PushNotification {
  title: string;
  body: string;
  /** Deep-link path the notification opens. */
  url?: string;
}

/** The push sender as the routes and the run notifier see it. */
export interface PushService {
  vapidPublicKey(): string;
  subscribe(subscription: PushSubscription): void;
  unsubscribe(endpoint: string): void;
  send(notification: PushNotification): Promise<void>;
}
