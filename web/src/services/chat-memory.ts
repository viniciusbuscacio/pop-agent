import { useChatStore } from '../store/chat';
import { chatCache } from './chat-cache';

export const CHAT_MEMORY_MAX_CHATS = 15;
export const CHAT_MEMORY_MAX_BYTES = 300 * 1024 * 1024;

/** Conservative content estimate, not a browser heap measurement. Immutable
 * DTOs are measured once without allocating JSON/UTF-8 copies of attachments. */
export function createContentSizer(): (value: unknown) => number {
  const sizes = new WeakMap<object, number>();
  const size = (value: unknown): number => {
    if (typeof value === 'string') return value.length * 2;
    if (value === null || typeof value !== 'object') return 8;
    const known = sizes.get(value);
    if (known !== undefined) return known;
    let bytes = 32;
    for (const [key, item] of Object.entries(value)) bytes += key.length * 2 + size(item);
    sizes.set(value, bytes);
    return bytes;
  };
  return size;
}

export function memoryVictims(
  entries: { id: string; bytes: number; used: number; protected: boolean }[],
  maxChats = CHAT_MEMORY_MAX_CHATS,
  maxBytes = CHAT_MEMORY_MAX_BYTES,
): string[] {
  let count = entries.length;
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const victims: string[] = [];
  for (const entry of entries.filter(entry => !entry.protected).sort((a, b) => a.used - b.used)) {
    if (count <= maxChats && bytes <= maxBytes) break;
    victims.push(entry.id); count--; bytes -= entry.bytes;
  }
  return victims;
}

let selected: string | undefined;
let clock = 0;
const recency = new Map<string, number>();
let trim = (): void => {};

export function selectMemoryChat(id?: string): void {
  selected = id;
  if (id) recency.set(id, ++clock);
  trim();
}

/** Eviction removes only reconstructible transcripts, never drafts/run state. */
export function startChatMemory(): () => void {
  const size = createContentSizer();
  let trimming = false;
  trim = () => {
    if (trimming) return;
    const state = useChatStore.getState();
    for (const id of recency.keys()) if (id !== selected && state.messages[id] === undefined) recency.delete(id);
    const victims = memoryVictims(Object.entries(state.messages).map(([id, messages]) => ({
      id, bytes: size(messages), used: recency.get(id) ?? 0,
      protected: id === selected || state.live[id] !== undefined || (state.pending[id]?.length ?? 0) > 0,
    })));
    if (!victims.length) return;
    trimming = true;
    try {
      const messages = { ...state.messages };
      for (const id of victims) {
        // The writer coalesces this with snapshot/event persistence. A storage
        // failure is harmless: the authoritative server can restore the tail.
        void chatCache.put(id, messages[id]!);
        delete messages[id]; recency.delete(id);
      }
      useChatStore.setState({ messages });
    } finally { trimming = false; }
  };
  const unsubscribe = useChatStore.subscribe(trim);
  trim();
  return () => { unsubscribe(); trim = () => {}; selected = undefined; recency.clear(); clock = 0; };
}
