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

export type Role = 'owner' | 'member'

export interface Project {
  id: string
  name: string
  description: string
  ownerId: string
  myRole: Role
  createdAt: string
  updatedAt: string
  /** Set while the project is in the trash. */
  deletedAt: string | null
  /** When a trashed project will be removed for good. */
  purgeAt: string | null
}

export interface Page<T> {
  items: T[]
  total: number
}

export interface Member {
  userId: string
  email: string
  displayName: string
  role: Role
  joinedAt: string
}

export interface SettingsPatch {
  displayName?: string
  locale?: Locale
  theme?: Theme
}
