export interface InboundA2aRecord {
  id: string; contextId: string; chatId: string; runId: string;
  messageId: string; digest: string; createdAt: string;
  state: 'working' | 'completed' | 'failed' | 'canceled';
  text: string; timestamp: string;
}
export interface InboundA2aRepo {
  get(id: string): InboundA2aRecord | undefined;
  byMessage(id: string): InboundA2aRecord | undefined;
  byContext(id: string): InboundA2aRecord | undefined;
  byRun(id: string): InboundA2aRecord | undefined;
  count(): number;
  save(record: InboundA2aRecord): void;
  prune(before: string): void;
}
