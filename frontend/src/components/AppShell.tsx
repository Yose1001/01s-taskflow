import { Link, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/context'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'

/** The frame around every page: top bar with the app name, who is signed in, and the theme and language switches. */
export function AppShell() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
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
            {user ? (
              <>
                <span className="max-w-40 truncate text-sm text-muted" title={user.email}>
                  {user.displayName}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-full border border-border px-3 py-1 text-sm font-medium hover:bg-primary-bg"
                >
                  {t('nav.logout')}
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-full px-3 py-1 text-sm font-medium text-primary-fg hover:bg-primary-bg"
                >
                  {t('nav.login')}
                </Link>
                <Link
                  to="/register"
                  className="rounded-full bg-primary px-3 py-1 text-sm font-medium text-on-primary hover:opacity-90"
                >
                  {t('nav.signup')}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
