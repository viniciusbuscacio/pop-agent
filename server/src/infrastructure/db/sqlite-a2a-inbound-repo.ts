import type Database from 'better-sqlite3';
import type { InboundA2aRecord, InboundA2aRepo } from '../../application/ports/a2a-inbound-repo.js';
export class SqliteA2aInboundRepo implements InboundA2aRepo {
  constructor(private readonly db: Database.Database) {}
  private find(column: 'id' | 'message_id' | 'context_id' | 'run_id', value: string): InboundA2aRecord | undefined {
    const row = this.db.prepare('SELECT id, message_id AS messageId, context_id AS contextId, chat_id AS chatId, run_id AS runId, digest, created_at AS createdAt, state, response_text AS text, updated_at AS timestamp FROM a2a_inbound_tasks WHERE ' + column + ' = ? ORDER BY created_at DESC LIMIT 1').get(value);
    return row as InboundA2aRecord | undefined;
  }
  get(id: string): InboundA2aRecord | undefined { return this.find('id', id); }
  byMessage(id: string): InboundA2aRecord | undefined { return this.find('message_id', id); }
  byContext(id: string): InboundA2aRecord | undefined { return this.find('context_id', id); }
  byRun(id: string): InboundA2aRecord | undefined { return this.find('run_id', id); }
  count(): number { return (this.db.prepare('SELECT COUNT(*) AS count FROM a2a_inbound_tasks').get() as { count: number }).count; }
  save(record: InboundA2aRecord): void {
    this.db.prepare('INSERT INTO a2a_inbound_tasks (id,message_id,context_id,chat_id,run_id,digest,created_at,state,response_text,updated_at) VALUES (@id,@messageId,@contextId,@chatId,@runId,@digest,@createdAt,@state,@text,@timestamp) ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,state=excluded.state,response_text=excluded.response_text,updated_at=excluded.updated_at').run(record);
  }
  prune(before: string): void {
    this.db.prepare("DELETE FROM a2a_inbound_tasks WHERE state != 'working' AND updated_at < ?").run(before);
  }
}
