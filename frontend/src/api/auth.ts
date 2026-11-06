import { api } from './client'
import type { LoginResponse, SettingsPatch, User } from './types'

export function registerUser(input: {
  email: string
  password: string
  displayName: string
}): Promise<User> {
  return api<User>('/auth/register', { method: 'POST', body: input })
}

export function loginUser(input: { email: string; password: string }): Promise<LoginResponse> {
  return api<LoginResponse>('/auth/login', { method: 'POST', body: input })
}

/** Uses the HttpOnly refresh cookie (the browser sends it; this code never sees it) to get a new access token. */
export function refreshSession(): Promise<LoginResponse> {
  return api<LoginResponse>('/auth/refresh', { method: 'POST' })
}

/** Ends the session on the server and removes the refresh cookie. */
export function logoutSession(): Promise<void> {
  return api<void>('/auth/logout', { method: 'POST' })
}

export function fetchMe(token: string): Promise<User> {
  return api<User>('/me', { token })
}

export function updateMe(token: string, patch: SettingsPatch): Promise<User> {
  return api<User>('/me', { method: 'PATCH', token, body: patch })
}
