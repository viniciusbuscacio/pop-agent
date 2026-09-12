import type { WebAuthnCredential, WebAuthnRepo } from '../../application/ports/webauthn-repo.js';
import type { Db } from './types.js';

interface Row {
  id: string;
  public_key: Buffer;
  counter: number;
  transports: string;
  label: string;
}

/** SQLite adapter for {@link WebAuthnRepo}. */
export class SqliteWebAuthnRepo implements WebAuthnRepo {
  constructor(private readonly db: Db) {}

  list(): WebAuthnCredential[] {
    return (this.db.prepare('SELECT * FROM webauthn_credentials').all() as Row[]).map(toCredential);
  }

  get(id: string): WebAuthnCredential | undefined {
    const row = this.db.prepare('SELECT * FROM webauthn_credentials WHERE id = ?').get(id) as
      | Row
      | undefined;
    return row === undefined ? undefined : toCredential(row);
  }

  save(credential: WebAuthnCredential): void {
    this.db
      .prepare(
        `INSERT INTO webauthn_credentials (id, public_key, counter, transports, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, counter = excluded.counter`,
      )
      .run(
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        credential.transports.join(','),
        credential.label,
        new Date().toISOString(),
      );
  }

  updateCounter(id: string, counter: number): void {
    this.db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE id = ?').run(counter, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM webauthn_credentials WHERE id = ?').run(id);
  }
}

function toCredential(row: Row): WebAuthnCredential {
  return {
    id: row.id,
    publicKey: new Uint8Array(row.public_key),
    counter: row.counter,
    transports: row.transports.length > 0 ? row.transports.split(',') : [],
    label: row.label,
  };
}
