import { vi } from 'vitest'
import type { User } from '../api/types'

// A fake server for tests: replaces fetch, answers by "METHOD /path", and records every request.

export interface RecordedRequest {
  method: string
  path: string
  body: unknown
  headers: Headers
  credentials: RequestCredentials | undefined
}

export interface Reply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

type Handler = (request: RecordedRequest) => Reply | Promise<Reply>

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

export function mockApi(routes: Record<string, Handler>) {
  const calls: RecordedRequest[] = []
  const unhandled: string[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/api\/v1/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const request: RecordedRequest = {
      method,
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
    }
    calls.push(request)

    const handler = routes[`${method} ${path}`]
    if (!handler) {
      unhandled.push(`${method} ${path}`)
      return new Response(JSON.stringify({ code: 'not_found', message: 'unhandled in test' }), {
        status: 404,
      })
    }
    const reply = await handler(request)
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
