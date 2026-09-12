import { Hono } from 'hono';
import type { SyncManifestResponse } from '@pop-agent/shared';
import type { SseHub } from './sse-hub.js';

export function createSyncRoutes(hub: SseHub): Hono {
  const routes = new Hono();
  routes.get('/sync', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(hub.manifest() satisfies SyncManifestResponse);
  });
  return routes;
}

/** Only successful owner operations reach this invalidation map. No bodies,
 * credentials or diagnostic content are ever included in a notification. */
export function changedSettingsResources(method: string, path: string): string[] {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return [];
  if (/^\/v1\/providers(?:\/|$)/.test(path)) return ['providers', 'model-catalog'];
  if (/^\/v1\/settings(?:\/|$)/.test(path)) return ['settings'];
  if (/^\/v1\/memory(?:\/|$)/.test(path)) return ['memory'];
  if (/^\/v1\/backups(?:\/|$)/.test(path)) return ['backups', 'storage'];
  if (/^\/v1\/voice(?:\/|$)/.test(path)) return ['voice-models', 'settings'];
  if (/^\/v1\/auth\/webauthn(?:\/|$)/.test(path)) return ['passkeys'];
  if (/^\/v1\/server(?:\/|$)/.test(path)) return ['server-info', 'update-status'];
  if (/^\/v1\/update(?:\/|$)/.test(path)) return ['update-status'];
  return [];
}
