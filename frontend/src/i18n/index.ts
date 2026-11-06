import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import th from './locales/th.json'

export const LANGUAGES = ['th', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
export const LANGUAGE_STORAGE_KEY = 'tf-lang'

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l === value)
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, th: { translation: th } },
    supportedLngs: LANGUAGES,
    nonExplicitSupportedLngs: true, // "th-TH" -> "th", "en-GB" -> "en"
    load: 'languageOnly',
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      // A saved choice wins; otherwise follow the browser language.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  })

// Screen readers and browsers use <html lang> to pick pronunciation and fonts.
function syncHtmlLang(lng: string) {
  document.documentElement.setAttribute('lang', lng.split('-')[0] ?? 'en')
}
syncHtmlLang(i18n.resolvedLanguage ?? i18n.language ?? 'en')
i18n.on('languageChanged', syncHtmlLang)

export default i18n
