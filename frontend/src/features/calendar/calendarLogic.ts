import type { CalendarEvent, CalendarRange, CalendarTask } from '../../api/types'

// The rules of the calendar, as plain functions (no React), so they can be tested without a browser.

/** What one task is doing on one day: starting, ending, or both (a one-day task). */
export type TaskMark = 'start' | 'due' | 'both'

export interface DayItems {
  events: CalendarEvent[]
  tasks: { task: CalendarTask; mark: TaskMark }[]
}

const EMPTY: DayItems = { events: [], tasks: [] }

/**
 * Everything on each day. A task shows on its start day and its end day only, not on every day between,
 * so a long task does not fill the whole month.
 */
export function itemsByDay(range: CalendarRange | undefined): Map<string, DayItems> {
  const byDay = new Map<string, DayItems>()
  const at = (day: string) => {
    let items = byDay.get(day)
    if (!items) {
      items = { events: [], tasks: [] }
      byDay.set(day, items)
    }
    return items
  }
  for (const event of range?.events ?? []) at(event.day).events.push(event)
  for (const task of range?.tasks ?? []) {
    if (task.startDate && task.startDate === task.dueDate) {
      at(task.startDate).tasks.push({ task, mark: 'both' })
      continue
    }
    if (task.startDate) at(task.startDate).tasks.push({ task, mark: 'start' })
    if (task.dueDate) at(task.dueDate).tasks.push({ task, mark: 'due' })
  }
  return byDay
}

export const itemsOn = (byDay: Map<string, DayItems>, day: string): DayItems =>
  byDay.get(day) ?? EMPTY

/** Whole days from today to the day: 0 today, 1 tomorrow, negative when it has passed. */
export function daysUntil(day: string, today: string): number {
  return Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
}

/** A "YYYY-MM-DD" from the address, or undefined when it is not a real day. */
export function parseDay(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : undefined
}
