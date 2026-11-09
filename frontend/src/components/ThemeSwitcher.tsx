import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/context'
import { useTheme } from '../theme/context'
import { Icon } from './Icon'

/** One button: the app has two themes, so it always switches to the other one. */
export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { saveSettings } = useAuth()
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      aria-label={next === 'dark' ? t('theme.switchToDark') : t('theme.switchToLight')}
      onClick={() => {
        setTheme(next)
        void saveSettings({ theme: next }) // remembered on the account too (does nothing when signed out)
      }}
      className="grid h-11 w-11 place-items-center rounded-xl text-text hover:bg-primary-bg sm:h-9 sm:w-9"
    >
      <Icon name={next === 'dark' ? 'moon' : 'sun'} size={18} />
    </button>
  )
}
