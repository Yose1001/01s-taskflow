import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from './client'
import { mockApi } from '../test/mockApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api()', () => {
  it('calls same-origin /api/v1 without cookies and sends JSON', async () => {
    const server = mockApi({ 'POST /things': () => ({ status: 201, body: { id: 1 } }) })
    const result = await api<{ id: number }>('/things', { method: 'POST', body: { name: 'x' } })

    expect(result).toEqual({ id: 1 })
    const call = server.calls[0]!
    expect(call.credentials).toBe('omit')
    expect(call.headers.get('Content-Type')).toBe('application/json')
    expect(call.headers.get('Accept')).toBe('application/json')
    expect(call.body).toEqual({ name: 'x' })
  })

  it('sends no Content-Type on a request without a body, and no Authorization without a token', async () => {
    const server = mockApi({ 'GET /ping': () => ({ body: { ok: true } }) })
    await api('/ping')
    const call = server.calls[0]!
    expect(call.headers.get('Content-Type')).toBeNull()
    expect(call.headers.get('Authorization')).toBeNull()
  })

  it('sends the token as a Bearer header only when given', async () => {
    const server = mockApi({ 'GET /me': () => ({ body: {} }) })
    await api('/me', { token: 'abc' })
    expect(server.calls[0]!.headers.get('Authorization')).toBe('Bearer abc')
  })

  it('returns undefined for 204 No Content', async () => {
    mockApi({ 'DELETE /things/1': () => ({ status: 204 }) })
    await expect(api('/things/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('turns an error response into an ApiError with code and field codes', async () => {
    mockApi({
      'POST /auth/register': () => ({
        status: 422,
        body: {
          code: 'validation_failed',
          message: 'validation failed',
          fields: { email: 'invalid_email', n: 5 },
        },
      }),
    })
    const error = await api('/auth/register', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    const e = error as ApiError
    expect([e.status, e.code]).toEqual([422, 'validation_failed'])
    expect(e.fields).toEqual({ email: 'invalid_email' }) // non-string values are dropped
  })

  it('reads Retry-After from a 429', async () => {
    mockApi({
      'POST /auth/login': () => ({
        status: 429,
        body: { code: 'rate_limited', message: 'x' },
        headers: { 'Retry-After': '42' },
      }),
    })
    const e = (await api('/auth/login', { method: 'POST', body: {} }).catch(
      (x: unknown) => x,
    )) as ApiError
    expect([e.status, e.code, e.retryAfter]).toEqual([429, 'rate_limited', 42])
  })

  it('copes with error pages that are not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })),
    )
    const bad = (await api('/x').catch((x: unknown) => x)) as ApiError
    expect([bad.status, bad.code]).toEqual([502, 'internal_error'])

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 400 })),
    )
    const other = (await api('/x').catch((x: unknown) => x)) as ApiError
    expect([other.status, other.code]).toEqual([400, 'unknown'])
  })

  it('reports a network failure as code "network", status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const e = (await api('/x').catch((x: unknown) => x)) as ApiError
    expect(e).toBeInstanceOf(ApiError)
    expect([e.status, e.code]).toEqual([0, 'network'])
  })

  it('lets an aborted request stay an abort (not a network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))),
    )
    const e = await api('/x').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(DOMException)
    expect((e as DOMException).name).toBe('AbortError')
  })

  it('never puts the token into an error message', async () => {
    mockApi({
      'GET /me': () => ({
        status: 401,
        body: { code: 'unauthorized', message: 'authentication required' },
      }),
    })
    const e = (await api('/me', { token: 'super-secret-token' }).catch(
      (x: unknown) => x,
    )) as ApiError
    expect(`${e.message} ${e.code} ${JSON.stringify(e.fields)}`).not.toContain('super-secret-token')
  })
})
