import { createContext, useContext, useEffect, useRef } from 'react';

export type SettingsDetail = { label: string; back: () => void };
export const SettingsDetailContext = createContext<((detail: SettingsDetail | undefined) => void) | undefined>(undefined);

/** Optional outside Settings, so the provider wizard also works during setup. */
export function useSettingsDetail(label: string | undefined, back: () => void): void {
  const publish = useContext(SettingsDetailContext);
  const backRef = useRef(back);
  useEffect(() => { backRef.current = back; });
  useEffect(() => {
    publish?.(label === undefined ? undefined : { label, back: () => backRef.current() });
    return () => publish?.(undefined);
  }, [label, publish]);
}
