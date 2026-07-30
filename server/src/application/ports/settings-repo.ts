/**
 * Persistence port for the settings table (popy.spec §6): one JSON document
 * per key. The application layer only ever sees this interface; the SQLite
 * adapter lives in infrastructure and can be swapped without touching callers.
 */
export interface SettingsRepo {
  /**
   * Reads a setting, or undefined when the key was never written. The caller
   * names the expected shape: settings are schemaless JSON by design, so this
   * is a claim about the stored document, not a checked conversion.
   */
  get<T>(key: string): T | undefined;

  /** Writes (or overwrites) a setting. */
  set<T>(key: string, value: T): void;
}
