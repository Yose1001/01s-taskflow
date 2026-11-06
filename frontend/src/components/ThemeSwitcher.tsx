import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme/context'
import { THEMES } from '../theme/theme'
import { SegmentedControl } from './SegmentedControl'

export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  return (
    <SegmentedControl
      label={t('theme.label')}
      value={theme}
      options={THEMES.map((value) => ({ value, label: t(`theme.${value}`) }))}
      onChange={setTheme}
    />
  )
}
