import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchMe,
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
  updateMe,
} from '../api/auth'
import { ApiError, api, type ApiOptions } from '../api/client'
import type { Locale, SettingsPatch, User } from '../api/types'
import { isLanguage } from '../i18n'
import { useTheme } from '../theme/context'
import { AuthContext, type RegisterInput } from './context'

// A new access token is fetched this long before the current one runs out.
const RENEW_MARGIN_MS = 10_000
const MAX_TIMER_MS = 2_000_000_000
// When the server cannot be reached, renewing is tried again after this long.
const OFFLINE_RETRY_MS = 15_000

/**
 * A NON-secret note that this browser signed in before, so a reload tries to restore the session.
 * Without it no refresh call is made at all (visitors who never signed in cause no failed requests).
 */
export const SESSION_HINT_KEY = 'tf-session'
const CHANNEL_NAME = 'tf-auth'

function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1'
  } catch {
    return false
  }
}

function setSessionHint(on: boolean) {
  try {
    if (on) localStorage.setItem(SESSION_HINT_KEY, '1')
    else localStorage.removeItem(SESSION_HINT_KEY)
  } catch {
    // Storage blocked: the person just signs in again after a reload.
  }
}

type Renewal = { ok: true; token: string } | { ok: false; offline: boolean }

/**
 * Holds who is signed in.
 *
 * SECURITY:
 * - The access token lives only in a variable inside this component (memory). It is never put in
 *   localStorage, sessionStorage, readable cookies or React state, so a page script cannot steal it.
 * - Staying signed in after a reload uses a refresh token in an HttpOnly cookie that only the server
 *   can read. This code never sees it; it just asks the server for a new access token.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [user, setUser] = useState<User | null>(null)
  const [restoring, setRestoring] = useState(hasSessionHint)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [loggedOut, setLoggedOut] = useState(false)
  const tokenRef = useRef<string | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  // One refresh at a time: everyone who needs a new token waits for the same request.
  const renewingRef = useRef<Promise<Renewal> | null>(null)
  // Bumped whenever a session ends, so an answer that arrives afterwards is ignored.
  const generationRef = useRef(0)
  const channelRef = useRef<BroadcastChannel | null>(null)

  const queryClient = useQueryClient()

  const endSession = useCallback(
    (expired: boolean) => {
      generationRef.current++
      window.clearTimeout(timerRef.current)
      tokenRef.current = null
      setSessionHint(false)
      // Everything fetched for this person is thrown away, so the next person to sign in on this
      // browser can never see it (not even for a moment).
      queryClient.clear()
      setUser(null)
      setSessionExpired(expired)
    },
    [queryClient],
  )

  // renew and the timer call each other, so the timer reaches renew through a ref.
  const onTimerRef = useRef<() => void>(() => {})

  const keepToken = useCallback((token: string, expiresInSeconds: number) => {
    tokenRef.current = token
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(
      () => onTimerRef.current(),
      Math.min(MAX_TIMER_MS, Math.max(0, expiresInSeconds * 1000 - RENEW_MARGIN_MS)),
    )
  }, [])

  /** Gets a new access token with the refresh cookie. */
  const renew = useCallback((): Promise<Renewal> => {
    if (!renewingRef.current) {
      const generation = generationRef.current
      renewingRef.current = refreshSession()
        .then((tokens): Renewal => {
          if (generation !== generationRef.current) return { ok: false, offline: false }
          keepToken(tokens.accessToken, tokens.expiresIn)
          return { ok: true, token: tokens.accessToken }
        })
        .catch((error: unknown): Renewal => ({
          ok: false,
          offline: error instanceof ApiError && (error.status === 0 || error.status >= 500),
        }))
        .finally(() => {
          renewingRef.current = null
        })
    }
    return renewingRef.current
  }, [keepToken])

  useEffect(() => {
    onTimerRef.current = () => {
      void renew().then((result) => {
        if (result.ok || !tokenRef.current) return
        if (result.offline) {
          timerRef.current = window.setTimeout(() => onTimerRef.current(), OFFLINE_RETRY_MS)
        } else {
          endSession(true)
        }
      })
    }
  }, [renew, endSession])

  const startSession = useCallback(
    (token: string, expiresInSeconds: number, me: User) => {
      keepToken(token, expiresInSeconds)
      setSessionHint(true)
      setSessionExpired(false)
      setLoggedOut(false)
      setUser(me)
    },
    [keepToken],
  )

  /** The account's saved preferences win after signing in, so every device looks the same. */
  const adoptPreferences = useCallback(
    (me: User) => {
      void i18n.changeLanguage(me.locale)
      setTheme(me.theme)
    },
    [i18n, setTheme],
  )

  /** Second half of bringing a session back: who is this token for? */
  const finishRestore = useCallback(
    async (result: Renewal): Promise<void> => {
      if (!result.ok) {
        if (!result.offline) setSessionHint(false)
        return
      }
      try {
        const me = await fetchMe(result.token)
        setSessionHint(true)
        setSessionExpired(false)
        setLoggedOut(false)
        setUser(me)
        adoptPreferences(me)
      } catch {
        tokenRef.current = null
        window.clearTimeout(timerRef.current)
      }
    },
    [adoptPreferences],
  )

  /** Brings back the session after a reload (or after another tab signed in). */
  const restore = useCallback(() => renew().then(finishRestore), [renew, finishRestore])

  useEffect(() => {
    if (!hasSessionHint()) return
    let cancelled = false
    void renew()
      .then(finishRestore)
      .finally(() => {
        if (!cancelled) setRestoring(false)
      })
    return () => {
      cancelled = true
    }
  }, [renew, finishRestore])

  // Other tabs of this site: a log out there ends the session here too; a log in there signs in here.
  const restoreRef = useRef(restore)
  const endRef = useRef(endSession)
  useEffect(() => {
    restoreRef.current = restore
    endRef.current = endSession
  }, [restore, endSession])
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === 'logout' && tokenRef.current) {
        endRef.current(false)
        setLoggedOut(true)
      } else if (event.data === 'login' && !tokenRef.current) {
        void restoreRef.current()
      }
    }
    channelRef.current = channel
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await loginUser({ email, password })
      const me = await fetchMe(tokens.accessToken)
      startSession(tokens.accessToken, tokens.expiresIn, me)
      adoptPreferences(me)
      channelRef.current?.postMessage('login')
      return me
    },
    [adoptPreferences, startSession],
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
      channelRef.current?.postMessage('login')
      return me
    },
    [i18n, startSession, theme],
  )

  const logout = useCallback(() => {
    // Ends the session on the server too (removes the cookie). Signing out here does not wait for it.
    void logoutSession().catch(() => {})
    channelRef.current?.postMessage('logout')
    endSession(false)
    setLoggedOut(true)
  }, [endSession])

  const request = useCallback(
    async <T,>(path: string, options: Omit<ApiOptions, 'token'> = {}): Promise<T> => {
      const token = tokenRef.current
      if (!token) throw new ApiError(401, 'unauthorized', 'not signed in')
      try {
        return await api<T>(path, { ...options, token })
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error
        // The access token was refused: get a new one once and try again.
        const result = await renew()
        if (!result.ok) {
          if (!result.offline) endSession(true)
          throw error
        }
        try {
          return await api<T>(path, { ...options, token: result.token })
        } catch (retryError) {
          if (retryError instanceof ApiError && retryError.status === 401) endSession(true)
          throw retryError
        }
      }
    },
    [endSession, renew],
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
    () => ({
      user,
      restoring,
      sessionExpired,
      loggedOut,
      login,
      register,
      logout,
      request,
      saveSettings,
    }),
    [user, restoring, sessionExpired, loggedOut, login, register, logout, request, saveSettings],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
