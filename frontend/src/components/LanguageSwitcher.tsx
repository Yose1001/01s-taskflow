import { useTranslation } from 'react-i18next'
import { LANGUAGES, isLanguage } from '../i18n'
import { SegmentedControl } from './SegmentedControl'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const current = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en'
  return (
    <SegmentedControl
      label={t('language.label')}
      value={current}
      // Each language is named in its own language, so people can find theirs.
      options={LANGUAGES.map((value) => ({ value, label: t(`language.${value}`) }))}
      onChange={(lng) => void i18n.changeLanguage(lng)}
    />
  )
}
