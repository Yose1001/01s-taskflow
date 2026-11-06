import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingState } from '../components/states'
import { useAuth } from './context'

interface FromState {
  from?: { pathname: string; search?: string }
}

/** Shown while a reload brings back the session, so the login page does not flash up first. */
function Restoring() {
  const { t } = useTranslation()
  return <LoadingState label={t('auth.restoring')} />
}

/** Pages that need a signed-in user. Signed-out visitors are sent to /login and returned afterwards. */
export function RequireAuth() {
  const { user, restoring, loggedOut } = useAuth()
  const location = useLocation()
  if (restoring) return <Restoring />
  // After an explicit log out nobody should be brought back to the page that was just left.
  if (!user) return <Navigate to="/login" replace state={loggedOut ? null : { from: location }} />
  return <Outlet />
}

/** Login and sign-up pages: a signed-in user has no business here and goes to where they were heading. */
export function GuestOnly() {
  const { user, restoring } = useAuth()
  const location = useLocation()
  if (restoring) return <Restoring />
  if (user) {
    // Only an internal path from the router's own state is used: never a value from the URL (no open redirect).
    const from = (location.state as FromState | null)?.from
    const internal = from && from.pathname.startsWith('/') && !from.pathname.startsWith('//')
    // Keep the query string too, so a deep link like /?page=2 comes back exactly as it was.
    const target = internal ? from.pathname + (from.search ?? '') : '/'
    return <Navigate to={target} replace />
  }
  return <Outlet />
}
