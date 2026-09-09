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
let manifest: SyncManifestResponse | undefined;
const verified = new Map<string, number>();
let generation = 0;
let selectedChat: string | undefined;
const loadedChats = new Set<string>();
const fullChats = new Set<string>();
const navigationVersions = new Map<string, { epoch: string; revision: number }>();
const navigationChecks = new Map<string, { snapshot?: SyncManifestResponse }>();

function syncChat(id: string, foreground = false): Promise<void> {
  // Archive contents are demand-loaded, including during reconnect recovery.
  // Forget verification on invalidation so reopening still reconciles the cache.
  if (!foreground && selectedChat !== id && !useChatStore.getState().chats.some(chat => chat.id === id)) {
    loadedChats.delete(id); fullChats.delete(id);
    return Promise.resolve();
  }
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
  let active = true;
  void chatCache.get(id).then(messages => {
    if (active && generation === started && messages && useChatStore.getState().messages[id] === undefined) {
      useChatStore.setState(state => ({ messages: { ...state.messages, [id]: messages } }));
    }
  });
  const check = navigationChecks.get(id) ?? {};
  navigationChecks.set(id, check);
  void syncQueue.add(`check-chat:${id}`, async signal => {
    if (generation !== started) return;
    check.snapshot = await apiRequest<SyncManifestResponse>('/sync', { signal });
  }, true, false).then(async () => {
    if (navigationChecks.get(id) === check) navigationChecks.delete(id);
    const next = check.snapshot;
    if (!active || generation !== started || !next) return;
    const revision = next.revisions[`chat:${id}`] ?? 0;
    const previous = navigationVersions.get(id);
    const known = (previous?.epoch === next.epoch && previous.revision === revision)
      || (manifest?.epoch === next.epoch && verified.get(`chat:${id}`) === revision);
    const messages = useChatStore.getState().messages[id];
    const missingAttachments = messages?.some(message => message.attachments?.some(attachment => !attachment.dataUri));
    if (!known || messages === undefined || missingAttachments) {
      await syncChat(id, true);
      // Navigation may have joined a text-only warmup already in flight.
      if (active && generation === started && loadedChats.has(id) && !fullChats.has(id)) await syncChat(id, true);
      if (generation !== started || syncQueue.getState().errors.includes(`chat:${id}`)) return;
    }
    navigationVersions.set(id, { epoch: next.epoch, revision });
  });
  return () => { active = false; if (selectedChat === id) selectedChat = undefined; };
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

/** Verify every in-scope resource, downloading only missing or changed snapshots. */
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
    if (generation !== started || !before) return;
    if (manifest?.epoch !== before.epoch) verified.clear();
    manifest = before;
    const snapshot = before;
    const revision = (key: string) => snapshot.revisions[key] ?? 0;
    const needs = (key: string) => !verified.has(key) || verified.get(key) !== revision(key);
    const record = async (key: string, jobKey: string, read: Promise<void>) => {
      const expected = revision(key);
      await read;
      if (generation === started && !syncQueue.getState().errors.includes(jobKey)) verified.set(key, expected);
    };
    if (needs('chats') || !useChatStore.getState().listsLoaded) {
      await Promise.all([
        syncQueue.add('chats', signal => useChatStore.getState().loadChats(signal)),
        syncQueue.add('archived', signal => useChatStore.getState().loadArchived(signal)),
      ]);
      if (generation === started && !syncQueue.getState().errors.some(key => key === 'chats' || key === 'archived')) verified.set('chats', revision('chats'));
    }
    if (generation !== started) return;
    const { chats } = useChatStore.getState();
    const ids = new Set(chats.map(chat => chat.id));
    if (selectedChat) ids.add(selectedChat);
    for (const id of loadedChats) {
      if (!ids.has(id) && needs(`chat:${id}`)) { loadedChats.delete(id); fullChats.delete(id); }
    }
    for (const id of ids) {
      const key = `chat:${id}`;
      if (needs(key) || !loadedChats.has(id) || useChatStore.getState().messages[id] === undefined) {
        reads.push(record(key, key, syncChat(id, selectedChat === id)));
      }
    }
    const readSetting = (key: string) => {
      const state = settingsResources.state(key);
      if (needs(key) || !state.fresh || state.data === undefined) return record(key, `settings:${key}`, syncSetting(key));
      return Promise.resolve();
    };
    for (const key of Object.keys(settingsLoaders)) reads.push(readSetting(key));
    await Promise.all(reads);
    if (generation !== started) return;
    const providers = settingsResources.state('providers').data as { providers?: { id: string; configured: boolean }[] } | undefined;
    if (providers?.providers?.some(provider => provider.id === 'openai-codex' && provider.configured)) {
      settingsLoaders['subscription:openai-codex'] = () => providersService.subscriptionUsage('openai-codex');
      await readSetting('subscription:openai-codex');
    }
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
  void refreshClientData();
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
    manifest = undefined; fullRound = undefined; verified.clear();
    loadedChats.clear(); fullChats.clear(); navigationVersions.clear(); navigationChecks.clear(); selectedChat = undefined;
    useChatStore.getState().reset();
  };
}
