import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { t } from '../i18n';
import { settingsResources, type ResourceState } from '../services/settings-resources';
import { ensureSetting, syncSetting } from '../services/settings-preload';
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
  const missing = values.some(({ state, blocking }) => blocking && state.data === undefined);
  const savedTimes = values.flatMap(({ state }) => !state.fresh && state.savedAt !== undefined ? [state.savedAt] : []);
  return <SyncContext.Provider value={report}>
    {stale && values.length > 0 ? <div className="mb-4 flex flex-wrap items-center gap-2" role={failed ? 'alert' : 'status'}>
      <p className="text-sm text-[var(--muted)]">{failed
        ? t(cached ? 'settings.sync.failedCached' : 'settings.sync.failed')
        : t(cached ? 'settings.sync.cached' : 'settings.sync.loading')}</p>
      {failed ? <Button type="button" variant="ghost" disabled={loading} onClick={() => values.forEach(({ retry }) => retry())}>{t('settings.sync.retry')}</Button> : null}
      {savedTimes.length > 0 ? <p className="w-full text-xs text-[var(--muted)]">{t('settings.sync.savedAt', { when: new Date(Math.min(...savedTimes)).toLocaleString('en-GB') })}</p> : null}
    </div> : null}
    {missing ? <div aria-hidden="true" className="mb-4 grid gap-3">
      <div className="h-10 rounded-md bg-[var(--hover-overlay)]" />
      <div className="h-32 rounded-md bg-[var(--hover-overlay)]" />
    </div> : null}
    <div inert={blocked} data-settings-stale={stale ? 'true' : 'false'}>{children}</div>
  </SyncContext.Provider>;
}

/** Callback reads current component state, so background reads never capture old drafts. */
export function useSettingsLoad<T>(key: string, loader: () => Promise<T>, receive: (data: T) => void, blocking = true, reportStatus = true): ResourceState {
  const id = useId();
  const loaderRef = useRef(loader); loaderRef.current = loader;
  const receiveRef = useRef(receive); receiveRef.current = receive;
  const report = useContext(SyncContext);
  const state = useSyncExternalStore(
    useCallback((listener) => settingsResources.subscribe(key, listener), [key]),
    useCallback(() => settingsResources.state(key), [key]),
  );
  const retry = useCallback(() => { void syncSetting(key, true, () => loaderRef.current()); }, [key]);
  useLayoutEffect(() => {
    if (state.data !== undefined) receiveRef.current(state.data as T);
  }, [state.data, state.received]);
  useEffect(() => { if (reportStatus) report(id, { state, retry, blocking }); return () => report(id); }, [id, report, state, retry, blocking, reportStatus]);
  useEffect(() => {
    ensureSetting(key, () => loaderRef.current());
  }, [key]);
  return state;
}
