import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { LocaleCode, LocaleMeta, TranslationDictionary } from './types';
import { esDict } from './locales/es';
import { enDict } from './locales/en';

export interface RegisteredLocale {
  meta: LocaleMeta;
  dict: TranslationDictionary;
}

const LOCALE_REGISTRY = new Map<string, RegisteredLocale>();

export function registerLocale(meta: LocaleMeta, dict: TranslationDictionary): void {
  LOCALE_REGISTRY.set(meta.code, { meta, dict });
}

registerLocale({ code: 'es', nativeName: 'Español', dir: 'ltr' }, esDict);
registerLocale({ code: 'en', nativeName: 'English', dir: 'ltr' }, enDict);

const STORAGE_KEY = 'prismamd.locale';

export function getRegisteredLocales(): LocaleMeta[] {
  return Array.from(LOCALE_REGISTRY.values()).map((entry) => entry.meta);
}

export function getDictionary(locale: LocaleCode): TranslationDictionary {
  return LOCALE_REGISTRY.get(locale)?.dict ?? esDict;
}

export function isDefaultDemoMarkdown(content: string): boolean {
  for (const entry of LOCALE_REGISTRY.values()) {
    if (entry.dict.demoMarkdown === content) {
      return true;
    }
  }
  return false;
}

export function detectInitialLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALE_REGISTRY.has(saved)) {
      return saved;
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }

  if (typeof navigator !== 'undefined') {
    const candidates = [navigator.language, ...(navigator.languages ?? [])];
    for (const lang of candidates) {
      if (!lang) continue;
      const lower = lang.toLowerCase();
      if (LOCALE_REGISTRY.has(lower)) return lower;
      const base = lower.split('-')[0];
      if (base && LOCALE_REGISTRY.has(base)) return base;
    }
  }

  return 'es';
}

export function persistLocale(locale: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore storage errors
  }
}

export interface I18nContextValue {
  locale: string;
  t: TranslationDictionary;
  availableLocales: LocaleMeta[];
  setLocale: (code: string) => void;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'es',
  t: esDict,
  availableLocales: getRegisteredLocales(),
  setLocale: () => undefined,
});

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function formatMessage(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`,
  );
}
