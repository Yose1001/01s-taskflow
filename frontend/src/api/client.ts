// The one place that talks HTTP to the Go API.
//
// - Always same-origin (/api/v1): in development Vite forwards it to the Go server.
// - The access token is passed in by the caller for each request. It is NEVER stored here.
// - credentials: 'omit' - no cookies are ever sent or accepted.

export const API_BASE = '/api/v1'

/** Everything that can go wrong, with a stable `code` the UI translates. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>
  /** Seconds to wait before retrying (from a 429 response), when known. */
  readonly retryAfter: number | undefined

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string> = {},
    retryAfter?: number,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  token?: string | null
  signal?: AbortSignal
}

interface ErrorBody {
  code?: unknown
  message?: unknown
  fields?: unknown
}

function parseFields(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v
  return out
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token, signal } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      signal: signal ?? null,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network', 'network error') // server down, offline, blocked...
  }

  if (response.status === 204) return undefined as T

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // Not JSON (for example an error page from a proxy): handled below.
  }

  if (!response.ok) {
    const e = (data ?? {}) as ErrorBody
    const retry = Number(response.headers.get('Retry-After'))
    throw new ApiError(
      response.status,
      typeof e.code === 'string' ? e.code : response.status >= 500 ? 'internal_error' : 'unknown',
      typeof e.message === 'string' ? e.message : `HTTP ${response.status}`,
      parseFields(e.fields),
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    )
  }
  return data as T
}
