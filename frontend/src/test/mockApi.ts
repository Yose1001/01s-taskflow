import { vi } from 'vitest'
import type { User } from '../api/types'

// A fake server for tests: replaces fetch, answers by "METHOD /path", and records every request.
// Routes may contain :params ("GET /projects/:id") and the handler receives them as request.params.

export interface RecordedRequest {
  method: string
  path: string
  /** The path without the query string. */
  pathname: string
  query: URLSearchParams
  params: Record<string, string>
  body: unknown
  headers: Headers
  credentials: RequestCredentials | undefined
}

export interface Reply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

export type Handler = (request: RecordedRequest) => Reply | Promise<Reply>

export const TOKEN = 'tok-secret-123'

export const ME: User = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'alice@example.com',
  displayName: 'Alice',
  locale: 'en',
  theme: 'light',
  createdAt: '2026-01-01T00:00:00Z',
}

export const LOGIN_OK: Reply = {
  body: { accessToken: TOKEN, tokenType: 'Bearer', expiresIn: 3600 },
}

function findRoute(routes: Record<string, Handler>, method: string, path: string) {
  const pathname = path.split('?')[0]!
  // A route can be given with its query string ("GET /projects?page=2") or without ("GET /projects").
  const exact = routes[`${method} ${path}`] ?? routes[`${method} ${pathname}`]
  if (exact) return { handler: exact, params: {} as Record<string, string> }

  const segments = pathname.split('/').filter(Boolean)
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ') as [string, string]
    if (m !== method || !pattern.includes(':')) continue
    const parts = pattern.split('/').filter(Boolean)
    if (parts.length !== segments.length) continue
    const params: Record<string, string> = {}
    const ok = parts.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[i]!)
        return true
      }
      return part === segments[i]
    })
    if (ok) return { handler: routes[key]!, params }
  }
  return undefined
}

export function mockApi(routes: Record<string, Handler>) {
  const calls: RecordedRequest[] = []
  const unhandled: string[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api\/v1/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const [pathname = '', search = ''] = path.split('?')
    const request: RecordedRequest = {
      method,
      path,
      pathname,
      query: new URLSearchParams(search),
      params: {},
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
    }
    calls.push(request)

    const found = findRoute(routes, method, path)
    if (!found) {
      unhandled.push(`${method} ${path}`)
      return new Response(JSON.stringify({ code: 'not_found', message: 'unhandled in test' }), {
        status: 404,
      })
    }
    request.params = found.params
    const reply = await found.handler(request)
    const status = reply.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json', ...reply.headers },
    })
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    calls,
    unhandled,
    fetchMock,
    to: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key),
    /** Requests by "METHOD /path" ignoring the query string. */
    hits: (key: string) => calls.filter((c) => `${c.method} ${c.pathname}` === key),
  }
}

/** Every value stored in localStorage, sessionStorage and cookies, as one string (to prove a secret is not in there). */
export function allBrowserStorage(): string {
  const parts: string[] = []
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)!
      parts.push(`${key}=${store.getItem(key)}`)
    }
  }
  parts.push(document.cookie)
  return parts.join('\n')
}
