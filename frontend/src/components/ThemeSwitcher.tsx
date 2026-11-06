import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/context'
import { useTheme } from '../theme/context'
import { THEMES, type Theme } from '../theme/theme'
import { SegmentedControl } from './SegmentedControl'

export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { saveSettings } = useAuth()

  function choose(next: Theme) {
    setTheme(next)
    void saveSettings({ theme: next }) // remembered on the account too (does nothing when signed out)
  }

  return (
    <SegmentedControl
      label={t('theme.label')}
      value={theme}
      options={THEMES.map((value) => ({ value, label: t(`theme.${value}`) }))}
      onChange={choose}
    />
  )
}
