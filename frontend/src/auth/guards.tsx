import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './context'

interface FromState {
  from?: { pathname: string; search?: string }
}

/** Pages that need a signed-in user. Signed-out visitors are sent to /login and returned afterwards. */
export function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

/** Login and sign-up pages: a signed-in user has no business here and goes to where they were heading. */
export function GuestOnly() {
  const { user } = useAuth()
  const location = useLocation()
  if (user) {
    // Only an internal path from the router's own state is used: never a value from the URL (no open redirect).
    const from = (location.state as FromState | null)?.from
    const target =
      from && from.pathname.startsWith('/') && !from.pathname.startsWith('//') ? from.pathname : '/'
    return <Navigate to={target} replace />
  }
  return <Outlet />
}
