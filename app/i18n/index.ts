import { I18n } from 'i18n-js';
import * as ExpoLocalization from 'expo-localization';

import en from './en.json';
import fr from './fr.json';

const i18n = new I18n({ en, fr });

// Detect locale: prefer French if any French locale is first
const locales = ExpoLocalization.getLocales();
const primaryLocale = locales[0]?.languageCode ?? 'en';
i18n.locale = primaryLocale === 'fr' ? 'fr' : 'en';
i18n.enableFallback = true;
i18n.defaultLocale = 'en';

export { i18n };

export function setLocale(locale: 'en' | 'fr') {
  i18n.locale = locale;
}

export function getLocale(): 'en' | 'fr' {
  return (i18n.locale as 'en' | 'fr') ?? 'en';
}

export function t(key: string, options?: Record<string, string | number>): string {
  return i18n.t(key, options);
}
