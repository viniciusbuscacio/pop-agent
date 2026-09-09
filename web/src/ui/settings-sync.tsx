import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { t } from '../i18n';
import { settingsResources, type ResourceState } from '../services/settings-resources';
import { eventStream } from '../services/events';
import { healthMonitor } from '../services/health';
import { Button } from './controls';

interface Report { state: ResourceState; retry: () => void; blocking: boolean }
const SyncContext = createContext<(key: string, report?: Report) => void>(() => undefined);

/** One status surface per Settings destination, outside its disabled controls. */
export function SettingsSyncBoundary({ children }: { children: ReactNode }) {
  const [reports, setReports] = useState<Record<string, Report>>({});
  const report = useCallback((key: string, value?: Report) => {
    setReports((old) => { const next = { ...old }; if (value) next[key] = value; else delete next[key]; return next; });
  }, []);
  const values = Object.values(reports);
  const stale = values.some(({ state }) => !state.fresh);
  const failed = values.some(({ state }) => state.error);
  const loading = values.some(({ state }) => state.loading);
  const cached = values.some(({ state }) => state.data !== undefined && !state.fresh);
  const blocked = values.some(({ state, blocking }) => blocking && !state.fresh);
  const savedTimes = values.flatMap(({ state }) => !state.fresh && state.savedAt !== undefined ? [state.savedAt] : []);
  return <SyncContext.Provider value={report}>
    {(stale || loading) && values.length > 0 ? <div className="mb-4 flex flex-wrap items-center gap-2" role={failed ? 'alert' : 'status'}>
      <p className="text-sm text-[var(--muted)]">{failed
        ? t(cached ? 'settings.sync.failedCached' : 'settings.sync.failed')
        : t(cached ? 'settings.sync.cached' : 'settings.sync.loading')}</p>
      {failed ? <Button type="button" variant="ghost" disabled={loading} onClick={() => values.forEach(({ retry }) => retry())}>{t('settings.sync.retry')}</Button> : null}
      {savedTimes.length > 0 ? <p className="w-full text-xs text-[var(--muted)]">{t('settings.sync.savedAt', { when: new Date(Math.min(...savedTimes)).toLocaleString('en-GB') })}</p> : null}
    </div> : null}
    <div inert={blocked} data-settings-stale={stale ? 'true' : 'false'}>{children}</div>
  </SyncContext.Provider>;
}

/** Callback reads current component state, so background reads never capture old drafts. */
export function useSettingsLoad<T>(key: string, loader: () => Promise<T>, receive: (data: T) => void, blocking = true): ResourceState {
  const id = useId();
  const loaderRef = useRef(loader); loaderRef.current = loader;
  const receiveRef = useRef(receive); receiveRef.current = receive;
  const report = useContext(SyncContext);
  const state = useSyncExternalStore(
    useCallback((listener) => settingsResources.subscribe(key, listener), [key]),
    useCallback(() => settingsResources.state(key), [key]),
  );
  const retry = useCallback(() => { void settingsResources.load(key, () => loaderRef.current()); }, [key]);
  useEffect(() => {
    if (state.data !== undefined) receiveRef.current(state.data as T);
  }, [state.data, state.received]);
  useEffect(() => { report(id, { state, retry, blocking }); return () => report(id); }, [id, report, state, retry, blocking]);
  useEffect(() => {
    retry();
    const visible = () => { if (!document.hidden) retry(); };
    const unsubscribe = eventStream.onResume(visible);
    let previous = healthMonitor.getState().kind;
    const stopHealth = healthMonitor.subscribe(() => {
      const next = healthMonitor.getState().kind;
      if ((previous === 'offline' || previous === 'device-offline') && next !== previous) visible();
      previous = next;
    });
    window.addEventListener('online', visible);
    window.addEventListener('pageshow', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(visible, 60_000);
    return () => { unsubscribe(); stopHealth(); clearInterval(timer); window.removeEventListener('online', visible); window.removeEventListener('pageshow', visible); document.removeEventListener('visibilitychange', visible); };
  }, [retry]);
  return state;
}
