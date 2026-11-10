import type { RequestFn } from './client'
import type { CalendarEvent, CalendarRange, NotificationList, RemindDay } from './types'

// One function per calendar endpoint in docs/openapi.yaml.
const id = encodeURIComponent

export interface EventInput {
  title: string
  note?: string
  /** "YYYY-MM-DD" */
  day: string
  /** Leave out for a personal day. */
  projectId?: string
  remindDays: RemindDay[]
}

/** Where a day belongs cannot change. */
export type EventPatch = Partial<Omit<EventInput, 'projectId'>>

export function getCalendar(
  request: RequestFn,
  range: { from: string; to: string; signal?: AbortSignal | undefined },
): Promise<CalendarRange> {
  const params = new URLSearchParams({ from: range.from, to: range.to })
  return request<CalendarRange>(`/calendar?${params}`, range.signal ? { signal: range.signal } : {})
}

export function createEvent(request: RequestFn, input: EventInput): Promise<CalendarEvent> {
  return request<CalendarEvent>('/events', { method: 'POST', body: input })
}

export function updateEvent(
  request: RequestFn,
  eventId: string,
  patch: EventPatch,
): Promise<CalendarEvent> {
  return request<CalendarEvent>(`/events/${id(eventId)}`, { method: 'PATCH', body: patch })
}

export function deleteEvent(request: RequestFn, eventId: string): Promise<void> {
  return request<void>(`/events/${id(eventId)}`, { method: 'DELETE' })
}

export function listNotifications(
  request: RequestFn,
  signal?: AbortSignal,
): Promise<NotificationList> {
  return request<NotificationList>('/notifications', signal ? { signal } : {})
}

/** Marks the listed reminders as read, or all of them when no ids are given. */
export function markNotificationsRead(request: RequestFn, ids?: string[]): Promise<void> {
  return request<void>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} })
}
