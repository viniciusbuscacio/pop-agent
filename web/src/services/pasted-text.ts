import type { AttachmentDTO } from '@pop-agent/shared';

/** Match the message API's UTF-16 length constraint, not UTF-8 byte size. */
export function shouldAttachPastedText(text: string, remainingDraftLength: number): boolean {
  return text.length > 0 && (text.length > 10_000 || remainingDraftLength + text.length > 32_000);
}

/** Chunk conversion avoids argument-stack limits for large UTF-8 input. */
export function pastedTextAttachment(bytes: Uint8Array, name: string): AttachmentDTO {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return { name, type: 'text/plain', dataUri: `data:text/plain;base64,${btoa(chunks.join(''))}` };
}
