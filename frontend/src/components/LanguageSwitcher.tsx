import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/context'
import { LANGUAGES, isLanguage, type Language } from '../i18n'
import { SegmentedControl } from './SegmentedControl'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const { saveSettings } = useAuth()
  const current = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en'

  function choose(next: Language) {
    void i18n.changeLanguage(next)
    void saveSettings({ locale: next }) // remembered on the account too (does nothing when signed out)
  }

  return (
    <SegmentedControl
      label={t('language.label')}
      value={current}
      // Each language is named in its own language, so people can find theirs.
      options={LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) }))}
      onChange={choose}
    />
  )
}
