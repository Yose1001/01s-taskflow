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
  /** Everyone in the project. */
  memberCount: number
  /** The first few of them (up to 5): the owner, then by when they joined. */
  members: Person[]
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

/** How many days before an important day to remind: 0 = on the day itself. */
export type RemindDay = 0 | 1 | 3 | 7
export const REMIND_DAYS: readonly RemindDay[] = [0, 1, 3, 7]
/** Reminders before a day's time, in minutes. */
export type RemindMinute = 15 | 30 | 60 | 120
export const REMIND_MINUTES: readonly RemindMinute[] = [15, 30, 60, 120]

/** Someone in a project with the signed-in person: who an important day can be shared with. */
export interface Person {
  userId: string
  displayName: string
  email: string
}

/** An important day on the calendar: the person's own (projectId null) or a project's. */
export interface CalendarEvent {
  id: string
  title: string
  note: string
  /** "YYYY-MM-DD" */
  day: string
  projectId: string | null
  projectName: string | null
  /** Whose personal day it is; null for a project's day. */
  ownerId: string | null
  createdBy: string
  remindDays: RemindDay[]
  /** The time of day, "HH:MM" (Thai time), or null for a day without a time. */
  atTime: string | null
  /** Reminders before the time. Only a day with a time has them. */
  remindMinutes: RemindMinute[]
  /** Who a personal day is shared with. Only its owner is told; for anyone else it is empty. */
  sharedWith: Person[]
  /** The owner's name, when the day was shared with the person looking. */
  sharedBy: string | null
  /** The person may change or remove it. */
  canEdit: boolean
  createdAt: string
  updatedAt: string
}

/** A task with a date, as the calendar shows it. */
export interface CalendarTask {
  id: string
  projectId: string
  projectName: string
  title: string
  status: TaskStatus
  startDate: string | null
  dueDate: string | null
  /** Who works on it, so the calendar can show one person's tasks. */
  assigneeIds: string[]
}

export interface CalendarRange {
  events: CalendarEvent[]
  tasks: CalendarTask[]
}

/** A reminder about an important day. */
export interface AppNotification {
  id: string
  eventId: string
  title: string
  day: string
  projectId: string | null
  projectName: string | null
  sharedBy: string | null
  daysBefore: RemindDay
  /** Set for a reminder before the day's time; 0 for one by day. */
  minutesBefore: 0 | RemindMinute
  /** The day's time, if it has one. */
  atTime: string | null
  createdAt: string
  readAt: string | null
}

export interface NotificationList {
  items: AppNotification[]
  unread: number
}
