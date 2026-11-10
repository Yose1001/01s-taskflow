import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createEvent,
  deleteEvent,
  getCalendar,
  listNotifications,
  listPeople,
  markNotificationsRead,
  updateEvent,
  type EventInput,
  type EventPatch,
} from '../../api/calendar'
import { listProjects } from '../../api/projects'
import { useAuth } from '../../auth/context'

// Cache keys. Changing an important day refreshes every calendar range and the reminders.
export const calendarKeys = {
  all: ['calendar'] as const,
  range: (from: string, to: string) => ['calendar', from, to] as const,
  notifications: ['notifications'] as const,
  projects: ['projects', 'for-calendar'] as const,
  people: ['people'] as const,
}

/** How often the bell looks for new reminders while the app is open. */
export const NOTIFICATION_REFRESH_MS = 60_000

export function useCalendar(from: string, to: string) {
  const { request } = useAuth()
  return useQuery({
    queryKey: calendarKeys.range(from, to),
    queryFn: ({ signal }) => getCalendar(request, { from, to, signal }),
    placeholderData: keepPreviousData, // keep the old month on screen while the next one loads
  })
}

/** The person's active projects, to choose where a new important day belongs (the API's largest page). */
export function useProjectChoices() {
  const { request } = useAuth()
  return useQuery({
    queryKey: calendarKeys.projects,
    queryFn: ({ signal }) =>
      listProjects(request, { page: 1, pageSize: 100, trashed: false, signal }),
  })
}

/** Who the person may share an important day with. */
export function usePeople() {
  const { request } = useAuth()
  return useQuery({
    queryKey: calendarKeys.people,
    queryFn: ({ signal }) => listPeople(request, signal),
  })
}

function useRefreshCalendar() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: calendarKeys.all }),
      qc.invalidateQueries({ queryKey: calendarKeys.notifications }),
    ])
}

export function useCreateEvent() {
  const { request } = useAuth()
  const refresh = useRefreshCalendar()
  return useMutation({
    mutationFn: (input: EventInput) => createEvent(request, input),
    onSuccess: refresh,
  })
}

export function useUpdateEvent() {
  const { request } = useAuth()
  const refresh = useRefreshCalendar()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: EventPatch }) =>
      updateEvent(request, id, patch),
    onSuccess: refresh,
  })
}

export function useDeleteEvent() {
  const { request } = useAuth()
  const refresh = useRefreshCalendar()
  return useMutation({
    mutationFn: (id: string) => deleteEvent(request, id),
    onSuccess: refresh,
  })
}

/** The bell's reminders, looked at again every minute while the app is open. */
export function useNotifications(enabled: boolean) {
  const { request } = useAuth()
  return useQuery({
    queryKey: calendarKeys.notifications,
    queryFn: ({ signal }) => listNotifications(request, signal),
    enabled,
    refetchInterval: NOTIFICATION_REFRESH_MS,
  })
}

export function useMarkRead() {
  const { request } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(request, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.notifications }),
  })
}
