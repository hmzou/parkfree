/**
 * LocaleContext — the app's language. The user's choice is saved, so ParkFree
 * opens in the same language next time; until they choose, the phone's
 * language is used and a one-time picker asks them on first launch.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getLocale, setLocale as setI18nLocale } from '../_i18n';

export type Locale = 'en' | 'fr';

const STORAGE_KEY = 'app_locale';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AsyncStorage = (() => {
  try {
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
})();

interface LocaleContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** False until the user has picked a language (or the saved choice is still loading) */
  hasChosen: boolean;
  /** True once the saved choice has been read */
  ready: boolean;
}

const LocaleContext = createContext<LocaleContextType>({
  locale: 'en',
  setLocale: () => {},
  hasChosen: true,
  ready: true,
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const [hasChosen, setHasChosen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await AsyncStorage?.getItem(STORAGE_KEY).catch(() => null);
      if (cancelled) return;
      if (saved === 'en' || saved === 'fr') {
        setI18nLocale(saved);
        setLocaleState(saved);
        setHasChosen(true);
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setI18nLocale(l);   // update i18n module (affects t() calls)
    setLocaleState(l);  // trigger re-renders of all consumers
    setHasChosen(true);
    void AsyncStorage?.setItem(STORAGE_KEY, l).catch(() => null);
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, hasChosen, ready }}>
      {children}
    </LocaleContext.Provider>
  );
}

/** Subscribe to this in every component/screen that renders translated text. */
export function useLocale(): LocaleContextType {
  return useContext(LocaleContext);
}
