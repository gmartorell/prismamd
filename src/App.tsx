import { useCallback, useMemo, useState } from 'preact/hooks';
import { AppShell } from './components/AppShell';
import {
  I18nContext,
  detectInitialLocale,
  getDictionary,
  getRegisteredLocales,
  persistLocale,
} from './i18n';

export function App() {
  const [locale, setLocaleState] = useState<string>(() => detectInitialLocale());

  const setLocale = useCallback((code: string) => {
    persistLocale(code);
    setLocaleState(code);
  }, []);

  const contextValue = useMemo(
    () => ({
      locale,
      t: getDictionary(locale),
      availableLocales: getRegisteredLocales(),
      setLocale,
    }),
    [locale, setLocale],
  );

  return (
    <I18nContext.Provider value={contextValue}>
      <AppShell />
    </I18nContext.Provider>
  );
}
