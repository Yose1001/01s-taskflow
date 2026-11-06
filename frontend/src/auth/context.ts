import { createContext, useContext } from 'react'
import type { ApiOptions } from '../api/client'
import type { SettingsPatch, User } from '../api/types'

export interface RegisterInput {
  email: string
  password: string
  displayName: string
}

export interface AuthContextValue {
  /** The signed-in user, or null when signed out. */
  user: User | null
  /** True when a session ended because it expired (so the login page can explain why). */
  sessionExpired: boolean
  login: (email: string, password: string) => Promise<User>
  register: (input: RegisterInput) => Promise<User>
  logout: () => void
  /** Calls the API as the signed-in user. A 401 ends the session. The token itself is never exposed. */
  request: <T>(path: string, options?: Omit<ApiOptions, 'token'>) => Promise<T>
  /** Saves language/theme to the account. Does nothing when signed out; failures are ignored (local choice still works). */
  saveSettings: (patch: SettingsPatch) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
