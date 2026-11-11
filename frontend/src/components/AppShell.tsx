import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { NotificationBell } from '../features/calendar/NotificationBell'
import { personName } from '../lib/format'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Menu } from './Menu'
import { PAGE_ICONS } from './pageIcons'
import { ThemeSwitcher } from './ThemeSwitcher'

/** The frame around every page: the app name, then language, theme and the account, on every screen size. */
export function AppShell() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        {/* A little tighter on phones, where the bar holds six buttons. */}
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-primary-fg">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-xl bg-primary-bg text-primary"
            >
              <Icon name="check" size={20} />
            </span>
            {t('app.name')}
          </Link>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeSwitcher />
            <Account />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}

/** The account menu when signed in; Log in and Sign up otherwise; nothing while a session is being restored. */
function Account() {
  const { t } = useTranslation()
  const { user, restoring, logout } = useAuth()
  if (restoring) return null
  if (user)
    return (
      <>
        {/* On phones only the icon shows; the word stays for screen readers. */}
        <NavLink
          to="/calendar"
          className={({ isActive }) =>
            `inline-flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium sm:h-9 ${
              isActive ? 'bg-primary-bg text-primary-fg' : 'text-text hover:bg-primary-bg'
            }`
          }
        >
          <span className={PAGE_ICONS.calendar.ink}>
            <Icon name="calendar" size={20} />
          </span>
          <span className="max-sm:sr-only">{t('nav.calendar')}</span>
        </NavLink>
        <NotificationBell />
        <Menu
          label={t('nav.account')}
          trigger={<Avatar id={user.id} name={personName(user)} size={36} />}
          triggerClassName="grid h-11 w-11 place-items-center rounded-full hover:ring-2 hover:ring-primary aria-expanded:ring-2 aria-expanded:ring-primary sm:h-9 sm:w-9"
          header={
            <div className="flex items-center gap-3">
              <Avatar id={user.id} name={personName(user)} size={36} />
              <div className="min-w-0">
                <p className="break-words font-semibold">{personName(user)}</p>
                <p className="break-words text-sm text-muted">{user.email}</p>
              </div>
            </div>
          }
          items={[{ key: 'logout', label: t('nav.logout'), icon: 'logout', onSelect: logout }]}
        />
      </>
    )
  // On phones these two are left out: each sign-in form links to the other, and the bar stays one line.
  const link =
    'rounded-xl px-3 py-2 text-sm font-medium text-text hover:bg-primary-bg max-sm:hidden'
  return (
    <>
      <Link to="/login" className={link}>
        {t('nav.login')}
      </Link>
      <Link to="/register" className={link}>
        {t('nav.signup')}
      </Link>
    </>
  )
}
