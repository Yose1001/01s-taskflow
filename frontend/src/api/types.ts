// Shapes of the API responses (see docs/openapi.yaml).

export type Locale = 'th' | 'en'
export type Theme = 'light' | 'dark'

export interface User {
  id: string
  email: string
  displayName: string
  locale: Locale
  theme: Theme
  createdAt: string
}

export interface LoginResponse {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number // seconds
}

export interface SettingsPatch {
  displayName?: string
  locale?: Locale
  theme?: Theme
}
