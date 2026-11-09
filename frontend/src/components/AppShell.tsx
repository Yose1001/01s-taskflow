import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/context'
import { initials } from '../lib/format'
import { Icon } from './Icon'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'

/** The frame around every page: top bar with the app name, who is signed in, and the theme and language switches. */
export function AppShell() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-primary-fg">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-xl bg-primary-bg text-primary"
            >
              <Icon name="check" size={20} />
            </span>
            {t('app.name')}
          </Link>
          {/* Wide screens: everything in one row. */}
          <div className="hidden items-center gap-2 sm:flex">
            <LanguageSwitcher />
            <ThemeSwitcher />
            <AccountLinks />
          </div>
          {/* Phones: one button that opens the same controls, so the bar stays one line. */}
          <MobileMenu />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}

/** Name and Log out when signed in; Log in and Sign up otherwise; nothing while a session is being restored. */
function AccountLinks({ stacked = false }: { stacked?: boolean }) {
  const { t } = useTranslation()
  const { user, restoring, logout } = useAuth()
  if (restoring) return null
  if (user)
    return (
      <>
        <span
          className={`truncate text-sm text-muted ${stacked ? '' : 'max-w-40'}`}
          title={user.email}
        >
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
    )
  return (
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
  )
}

/** The phone menu. Closes on Escape (focus goes back to the button), on a click outside, and on navigation. */
function MobileMenu() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  // A new page closes the menu.
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className="relative sm:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('nav.menu')}
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 min-w-9 place-items-center rounded-full border border-border bg-surface-2 px-2 text-sm font-semibold text-primary-fg"
      >
        {user ? <span aria-hidden="true">{initials(user.displayName)}</span> : <Icon name="menu" />}
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-11 w-64 space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-lg"
        >
          {user && (
            <div className="min-w-0">
              <p className="truncate font-semibold">{user.displayName}</p>
              <p className="truncate text-sm text-muted">{user.email}</p>
            </div>
          )}
          <LanguageSwitcher />
          <ThemeSwitcher />
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 [&>span]:hidden">
            <AccountLinks stacked />
          </div>
        </div>
      )}
    </div>
  )
}
