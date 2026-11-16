import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { AppShell } from './components/AppShell';
import {
  I18nContext,
  detectInitialLocale,
  getDictionary,
  getRegisteredLocales,
  persistLocale,
} from './i18n';

const THEME_META_COLORS: Record<string, string> = {
  dark: '#0d1117',
  sepia: '#f3ead8',
  light: '#f6f8fa',
};

function syncThemeColorMeta(themeAttr?: string | null): void {
  if (typeof document === 'undefined') return;
  const activeTheme =
    themeAttr ||
    document.documentElement.dataset.theme ||
    (() => {
      try {
        return localStorage.getItem('prismamd.theme');
      } catch {
        return null;
      }
    })() ||
    'dark';
  const color = THEME_META_COLORS[activeTheme] ?? THEME_META_COLORS.dark;
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  if (meta.content !== color) {
    meta.content = color;
  }
}

export function App() {
  const [locale, setLocaleState] = useState<string>(() => detectInitialLocale());

  const setLocale = useCallback((code: string) => {
    persistLocale(code);
    setLocaleState(code);
  }, []);

  const availableLocales = useMemo(() => getRegisteredLocales(), []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const dir = availableLocales.find((loc) => loc.code === locale)?.dir ?? 'ltr';
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, availableLocales]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    syncThemeColorMeta(document.documentElement.dataset.theme);
    const observer = new MutationObserver(() => {
      syncThemeColorMeta(document.documentElement.dataset.theme);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const contextValue = useMemo(
    () => ({
      locale,
      t: getDictionary(locale),
      availableLocales,
      setLocale,
    }),
    [locale, availableLocales, setLocale],
  );

  return (
    <I18nContext.Provider value={contextValue}>
      <AppShell />
    </I18nContext.Provider>
  );
}
