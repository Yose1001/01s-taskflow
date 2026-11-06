import { ApiError } from '../api/client'

/** Retry once for network trouble or server errors. Never retry a 4xx: asking again gives the same answer. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}
