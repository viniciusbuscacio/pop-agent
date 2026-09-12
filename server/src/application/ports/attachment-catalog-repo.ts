export interface AttachmentRecord {
  path: string;
  chatId: string;
  messageId: string;
  name: string;
  type: string;
  subject: string;
  description: string;
  createdAt: string;
}
export interface AttachmentCatalogRepo {
  put(record: AttachmentRecord): void;
  get(path: string): AttachmentRecord | undefined;
  search(query: string, limit: number): AttachmentRecord[];
}
