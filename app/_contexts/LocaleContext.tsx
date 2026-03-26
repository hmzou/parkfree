/**
 * LocaleContext — changing language in Profile triggers re-renders
 * across all screens so t() calls pick up the new locale immediately.
 */
import React, { createContext, useContext, useState } from 'react';
import { getLocale, setLocale as setI18nLocale } from '../_i18n';

type Locale = 'en' | 'fr';

interface LocaleContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleContextType>({
  locale: 'en',
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  const setLocale = (l: Locale) => {
    setI18nLocale(l);   // update i18n module (affects t() calls)
    setLocaleState(l);  // trigger re-renders of all consumers
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

/** Subscribe to this in every component/screen that renders translated text. */
export function useLocale(): LocaleContextType {
  return useContext(LocaleContext);
}
