import type { StreamEvent, SyncManifestResponse } from '@pop-agent/shared';
import { apiRequest } from './api';
import { eventStream } from './events';
import { session } from './session';
import { chatCache } from './chat-cache';
import { useChatStore } from '../store/chat';
import { settingsResources } from './settings-resources';
import { settingsLoaders, syncSetting } from './settings-preload';
import { providersService } from './providers';
import { syncQueue } from './sync-queue';

let fullRound: Promise<void> | undefined;
let recovery: Promise<void> | undefined;
let manifest: SyncManifestResponse | undefined;
let generation = 0;
let selectedChat: string | undefined;
const loadedChats = new Set<string>();
const fullChats = new Set<string>();

function syncChat(id: string, foreground = false): Promise<void> {
  const started = generation;
  return syncQueue.add(`chat:${id}`, async signal => {
    if (generation !== started || signal.aborted) return;
    const visible = foreground || selectedChat === id;
    await useChatStore.getState().openChat(id, true, signal, !visible);
    if (generation === started && !signal.aborted) {
      loadedChats.add(id);
      if (visible) fullChats.add(id);
    }
  }, foreground);
}

export function ensureChat(id: string): () => void {
  selectedChat = id;
  const started = generation;
  void chatCache.get(id).then(messages => {
    if (generation === started && messages && useChatStore.getState().messages[id] === undefined) {
      useChatStore.setState(state => ({ messages: { ...state.messages, [id]: messages } }));
    }
  });
  if (!fullChats.has(id) || useChatStore.getState().messages[id] === undefined) {
    void syncChat(id, true).then(() => {
      // A text-only warmup may already have been running when navigation won.
      if (generation === started && loadedChats.has(id) && !fullChats.has(id)) void syncChat(id, true);
    });
  } else syncQueue.promote(`chat:${id}`);
  return () => { if (selectedChat === id) selectedChat = undefined; };
}

function hydrate(): void {
  const started = generation;
  const initial = useChatStore.getState();
  void chatCache.getLists().then(lists => {
    if (lists && generation === started) {
      const current = useChatStore.getState();
      useChatStore.setState({
        listsLoaded: true,
        ...(current.chats === initial.chats ? { chats: lists.chats } : {}),
        ...(current.archived === initial.archived ? { archived: lists.archived } : {}),
      });
    }
  });
  for (const key of Object.keys(settingsLoaders)) void settingsResources.hydrate(key);
}

async function readManifest(): Promise<SyncManifestResponse> {
  return apiRequest<SyncManifestResponse>('/sync');
}

/** One round per explicit request; another click/open joins the existing work. */
export function refreshClientData(): Promise<void> {
  if (fullRound) return fullRound;
  if (!session.token()) return Promise.resolve();
  const started = generation;
  hydrate();
  syncQueue.clearErrors();
  fullRound = (async () => {
    let before: SyncManifestResponse | undefined;
    const reads: Promise<void>[] = [];
    // The manifest precedes snapshots, so a change during reads remains dirty
    // at the next recovery. Never acknowledge a later revision speculatively.
    await syncQueue.add('manifest', async () => { before = await readManifest(); });
    if (generation !== started) return;
    await Promise.all([
      syncQueue.add('chats', signal => useChatStore.getState().loadChats(signal)),
      syncQueue.add('archived', signal => useChatStore.getState().loadArchived(signal)),
    ]);
    if (generation !== started) return;
    const { chats, archived } = useChatStore.getState();
    for (const chat of [...chats, ...archived]) reads.push(syncChat(chat.id));
    for (const key of Object.keys(settingsLoaders)) reads.push(syncSetting(key));
    await Promise.all(reads);
    if (generation !== started) return;
    const providers = settingsResources.state('providers').data as { providers?: { id: string; configured: boolean }[] } | undefined;
    if (providers?.providers?.some(provider => provider.id === 'openai-codex' && provider.configured)) {
      settingsLoaders['subscription:openai-codex'] = () => providersService.subscriptionUsage('openai-codex');
      await syncSetting('subscription:openai-codex');
    }
    if (generation === started && syncQueue.getState().errors.length === 0) manifest = before;
  })().finally(() => { if (generation === started) fullRound = undefined; });
  return fullRound;
}

function synchronizeKeys(keys: string[]): Promise<void> {
  const reads = keys.map(key => {
    if (key === 'chats') return Promise.all([
      syncQueue.add('chats', signal => useChatStore.getState().loadChats(signal)),
      syncQueue.add('archived', signal => useChatStore.getState().loadArchived(signal)),
    ]).then(() => undefined);
    if (key.startsWith('chat:')) return syncChat(key.slice(5), selectedChat === key.slice(5));
    settingsResources.invalidate(key);
    return syncSetting(key);
  });
  return Promise.all(reads).then(() => undefined);
}

function recover(): void {
  if (recovery) return;
  const started = generation;
  recovery = (async () => {
    if (fullRound) await fullRound;
    if (generation !== started) return;
    const next = await readManifest();
    if (generation !== started) return;
    if (!manifest || manifest.epoch !== next.epoch) { await refreshClientData(); return; }
    const changed = Object.keys(next.revisions).filter(key => next.revisions[key] !== manifest?.revisions[key]);
    await synchronizeKeys(changed);
    if (generation === started && syncQueue.getState().errors.length === 0) manifest = next;
  })().catch(() => { /* Retain the old revision; explicit refresh or next reconnect retries. */ })
    .finally(() => { if (generation === started) recovery = undefined; });
}

function apply(event: StreamEvent): void {
  useChatStore.getState().apply(event);
  if (event.kind === 'resources-changed') { void synchronizeKeys(event.keys); return; }
  if (event.kind === 'local-machines-changed') { void synchronizeKeys(['devices']); return; }
  if (event.kind === 'delta' || event.kind === 'thinking' || event.kind === 'tool') return;
  const state = useChatStore.getState();
  void chatCache.putLists(state.chats, state.archived);
  if ('chatId' in event && event.kind !== 'chat-deleted') {
    const messages = state.messages[event.chatId];
    if (messages) void chatCache.put(event.chatId, messages);
  }
  if (event.kind === 'done' || event.kind === 'error') {
    void synchronizeKeys([`chat:${event.chatId}`, 'chats', 'storage', 'subscription:openai-codex']);
  }
}

/** Lives above routes: Settings must not stop chat projection/persistence. */
export function startClientSync(): () => void {
  const unsubscribe = eventStream.subscribe(apply);
  const resume = eventStream.onOpen(recover);
  void refreshClientData();
  return () => {
    generation++; unsubscribe(); resume(); syncQueue.stop();
    manifest = undefined; fullRound = undefined; recovery = undefined;
    loadedChats.clear(); fullChats.clear(); selectedChat = undefined;
    useChatStore.getState().reset();
  };
}
