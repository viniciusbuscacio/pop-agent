import { createHash } from 'node:crypto';
import type { Message } from '../../domain/chat/chat.js';
import type { AttachmentCatalogRepo, AttachmentRecord } from '../ports/attachment-catalog-repo.js';
import type { FilesService } from './files-service.js';
import type { FileProvenanceService } from './file-provenance.js';

/** Archive before model execution, including turns later stopped or rejected by a provider. */
export class AttachmentArchive {
  constructor(private readonly deps: { files: FilesService; repo: AttachmentCatalogRepo; provenance: FileProvenanceService }) {}
  save(message: Pick<Message, 'id' | 'chatId' | 'content' | 'createdAt' | 'attachments'>): AttachmentRecord[] {
    return message.attachments.flatMap((attachment, index) => {
      const match = /^data:[^;,]*;base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(attachment.dataUri);
      if (!match?.[1]) return [];
      const name = attachment.name.split(/[\\/]/u).at(-1)?.replace(/[^\p{L}\p{N}.() _-]/gu, '_').slice(0, 160).replace(/^\.+/u, '') || 'file';
      const bytes = Buffer.from(match[1], 'base64');
      const key = createHash('sha256').update(`${message.chatId}:${message.id}:${index}:`).update(bytes).digest('hex').slice(0, 24);
      const path = `Attachments/${key}/${name}`;
      const previous = this.deps.repo.get(path);
      if (!previous || this.deps.files.stat(path)?.kind !== 'file') this.deps.files.write(path, bytes);
      const record: AttachmentRecord = { path, name: attachment.name.slice(0, 200), type: attachment.type,
        chatId: message.chatId, messageId: message.id, subject: message.content.slice(0, 4000),
        description: previous?.description ?? '', createdAt: message.createdAt };
      this.deps.repo.put(record);
      this.deps.provenance.recordWrite(message.chatId, path);
      return [record];
    });
  }
  search(query: string, limit = 40): AttachmentRecord[] {
    return this.deps.repo.search(query, 200).filter(record => this.deps.files.stat(record.path)?.kind === 'file').slice(0, limit);
  }
  describe(path: string, description: string): boolean {
    const record = this.deps.repo.get(path);
    if (!record || this.deps.files.stat(path)?.kind !== 'file') return false;
    this.deps.repo.put({ ...record, description: description.slice(0, 4000) });
    return true;
  }
}
