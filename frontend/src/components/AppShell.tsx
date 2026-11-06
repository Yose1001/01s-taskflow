import { Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'

/** The frame around every page: top bar with the app name, theme and language switches. */
export function AppShell() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-primary-fg">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-xl bg-primary-bg text-primary"
            >
              ✓
            </span>
            {t('app.name')}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
