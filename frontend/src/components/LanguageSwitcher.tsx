import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/context'
import { isLanguage, type Language } from '../i18n'
import { Icon } from './Icon'

/** One button that shows the current language and switches to the other one. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const { saveSettings } = useAuth()
  const current: Language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en'
  const next: Language = current === 'th' ? 'en' : 'th'

  return (
    <button
      type="button"
      // The other language is named in its own language, so people can find theirs.
      aria-label={t('language.switchTo', { name: t(`language.${next}`) })}
      onClick={() => {
        void i18n.changeLanguage(next)
        void saveSettings({ locale: next }) // remembered on the account too (does nothing when signed out)
      }}
      className="inline-flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-text hover:bg-primary-bg sm:h-9"
    >
      <Icon name="globe" />
      {t(`language.code_${current}`)}
    </button>
  )
}
