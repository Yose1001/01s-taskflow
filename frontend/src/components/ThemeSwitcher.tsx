import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme/context'
import { THEME_PREFERENCES } from '../theme/theme'
import { SegmentedControl } from './SegmentedControl'

export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { preference, setPreference } = useTheme()
  return (
    <SegmentedControl
      label={t('theme.label')}
      value={preference}
      options={THEME_PREFERENCES.map((value) => ({ value, label: t(`theme.${value}`) }))}
      onChange={setPreference}
    />
  )
}
