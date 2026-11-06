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

export function fetchMe(token: string): Promise<User> {
  return api<User>('/me', { token })
}

export function updateMe(token: string, patch: SettingsPatch): Promise<User> {
  return api<User>('/me', { method: 'PATCH', token, body: patch })
}
