import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchMe, loginUser, registerUser, updateMe } from '../api/auth'
import { ApiError, api, type ApiOptions } from '../api/client'
import type { Locale, SettingsPatch, User } from '../api/types'
import { isLanguage } from '../i18n'
import { useTheme } from '../theme/context'
import { AuthContext, type RegisterInput } from './context'

// The session ends a little before the server would reject the token, to avoid a confusing error mid-click.
const EXPIRY_MARGIN_MS = 10_000
const MAX_TIMER_MS = 2_000_000_000

/**
 * Holds who is signed in.
 *
 * SECURITY: the access token lives only in a variable inside this component (memory). It is never put in
 * localStorage, sessionStorage, cookies or React state, so a page script that reads storage cannot steal it.
 * The price: reloading the page signs the user out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [user, setUser] = useState<User | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const tokenRef = useRef<string | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  const queryClient = useQueryClient()

  const endSession = useCallback(
    (expired: boolean) => {
      window.clearTimeout(timerRef.current)
      tokenRef.current = null
      // Everything fetched for this person is thrown away, so the next person to sign in on this
      // browser can never see it (not even for a moment).
      queryClient.clear()
      setUser(null)
      setSessionExpired(expired)
    },
    [queryClient],
  )

  const startSession = useCallback(
    (token: string, expiresInSeconds: number, me: User) => {
      window.clearTimeout(timerRef.current)
      tokenRef.current = token
      timerRef.current = window.setTimeout(
        () => endSession(true),
        Math.min(MAX_TIMER_MS, Math.max(0, expiresInSeconds * 1000 - EXPIRY_MARGIN_MS)),
      )
      setSessionExpired(false)
      setUser(me)
    },
    [endSession],
  )

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await loginUser({ email, password })
      const me = await fetchMe(tokens.accessToken)
      startSession(tokens.accessToken, tokens.expiresIn, me)
      // The account's saved preferences win after signing in, so every device looks the same.
      void i18n.changeLanguage(me.locale)
      setTheme(me.theme)
      return me
    },
    [i18n, setTheme, startSession],
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      await registerUser(input)
      const tokens = await loginUser({ email: input.email, password: input.password })
      // A new account starts with what the person already chose on this device.
      const locale: Locale = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en'
      let me: User
      try {
        me = await updateMe(tokens.accessToken, { locale, theme })
      } catch {
        me = await fetchMe(tokens.accessToken)
      }
      startSession(tokens.accessToken, tokens.expiresIn, me)
      return me
    },
    [i18n, startSession, theme],
  )

  const logout = useCallback(() => endSession(false), [endSession])

  const request = useCallback(
    async <T,>(path: string, options: Omit<ApiOptions, 'token'> = {}): Promise<T> => {
      const token = tokenRef.current
      if (!token) throw new ApiError(401, 'unauthorized', 'not signed in')
      try {
        return await api<T>(path, { ...options, token })
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) endSession(true)
        throw error
      }
    },
    [endSession],
  )

  const saveSettings = useCallback(
    async (patch: SettingsPatch) => {
      if (!tokenRef.current) return
      try {
        setUser(await request<User>('/me', { method: 'PATCH', body: patch }))
      } catch {
        // The choice still applies on this device; it will be saved on the next change.
      }
    },
    [request],
  )

  const value = useMemo(
    () => ({ user, sessionExpired, login, register, logout, request, saveSettings }),
    [user, sessionExpired, login, register, logout, request, saveSettings],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
