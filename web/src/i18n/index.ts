import { en, type TranslationKey } from './en';

/**
 * Minimal dictionary lookup with `{name}` placeholders -- no i18n library,
 * because one dictionary and one language do not need a runtime (docs/specs/Spec-Pop-General.md §14).
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const template: string = en[key];
  if (vars === undefined) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export type { TranslationKey };
