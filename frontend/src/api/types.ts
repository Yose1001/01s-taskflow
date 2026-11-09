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
  /** Tasks not in the trash. */
  taskCount: number
  /** Of those, how many are done. */
  doneCount: number
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

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'on_hold' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

/** One line of a task's checklist. */
export interface Subtask {
  id: string
  title: string
  done: boolean
}

export interface Task {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** Why it is on hold. Null in every other column. */
  holdReason: string | null
  assigneeIds: string[]
  subtasks: Subtask[]
  createdBy: string
  /** A calendar day, "YYYY-MM-DD" (no time zone). */
  startDate: string | null
  /** The end date. */
  dueDate: string | null
  /** Order inside a column. Only comparable between tasks of the same status. */
  position: number
  createdAt: string
  updatedAt: string
  /** Set while the task is in the trash. */
  deletedAt: string | null
  /** When a trashed task will be removed for good. */
  purgeAt: string | null
}

export interface SettingsPatch {
  displayName?: string
  locale?: Locale
  theme?: Theme
}
