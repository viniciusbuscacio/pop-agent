import type { PushRepo, PushSubscription } from '../../application/ports/push-repo.js';
import type { Db } from './types.js';

/** SQLite adapter for {@link PushRepo}. */
export class SqlitePushRepo implements PushRepo {
  constructor(private readonly db: Db) {}

  list(): PushSubscription[] {
    return this.db
      .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions')
      .all() as PushSubscription[];
  }

  save(subscription: PushSubscription): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(subscription.endpoint, subscription.p256dh, subscription.auth, new Date().toISOString());
  }

  delete(endpoint: string): void {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
}
