import type { CalendarEvent, CalendarRange, CalendarTask } from '../../api/types'
import { addDays } from '../../lib/calendar'
import { personName } from '../../lib/format'

// The rules of the calendar, as plain functions (no React), so they can be tested without a browser.

/**
 * What a task is doing on one day: starting, ending, both (a one-day task), or somewhere in between
 * (then `day` of `total` days, counted from its start).
 */
export type TaskMark =
  | { kind: 'start' }
  | { kind: 'due' }
  | { kind: 'both' }
  | { kind: 'during'; day: number; total: number }

export interface DayItems {
  events: CalendarEvent[]
  tasks: { task: CalendarTask; mark: TaskMark }[]
}

const EMPTY: DayItems = { events: [], tasks: [] }

/** Whole days from one day to another: 0 the same day, 1 the next, negative when it is before. */
export function daysUntil(day: string, from: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** The days a task covers: from its start to its end, or just the one day it has. */
export function taskSpan(task: CalendarTask): { from: string; to: string } | undefined {
  const from = task.startDate ?? task.dueDate
  const to = task.dueDate ?? task.startDate
  return from && to ? { from, to } : undefined
}

function markFor(task: CalendarTask, day: string): TaskMark {
  const { startDate: start, dueDate: due } = task
  if (start && start === due) return { kind: 'both' }
  if (day === start) return { kind: 'start' }
  if (day === due) return { kind: 'due' }
  return { kind: 'during', day: daysUntil(day, start!) + 1, total: daysUntil(due!, start!) + 1 }
}

/**
 * Everything on each day from `first` to `last`: important days on their day, and a task on every day
 * from its start to its end.
 */
export function itemsByDay(
  range: CalendarRange | undefined,
  first: string,
  last: string,
): Map<string, DayItems> {
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
    const span = taskSpan(task)
    if (!span) continue
    // Only the days on screen, however long the task is.
    const from = span.from < first ? first : span.from
    const to = span.to > last ? last : span.to
    for (let day = from; day <= to; day = addDays(day, 1))
      at(day).tasks.push({ task, mark: markFor(task, day) })
  }
  return byDay
}

export const itemsOn = (byDay: Map<string, DayItems>, day: string): DayItems =>
  byDay.get(day) ?? EMPTY

/** One bar in one week of the month: an important day (one day long) or a task (one day or more). */
export interface Bar {
  key: string
  kind: 'event' | 'task'
  title: string
  /** 0 = the week's first day (Sunday). */
  column: number
  /** How many days of this week it covers. */
  length: number
  /** Which line it sits on, from the top (0). Bars on one line never overlap. */
  lane: number
  /** False when it carries on from the week before, or into the week after. */
  startsHere: boolean
  endsHere: boolean
}

/**
 * The bars of one week (its 7 days, Sunday first). Important days come first, then longer tasks before
 * shorter ones, each on the first line where it fits. `hidden` counts, for each day, the bars that do not
 * fit in `lanes` lines, so the day can say "+N more".
 */
export function weekBars(
  week: string[],
  range: CalendarRange | undefined,
  lanes: number,
): { bars: Bar[]; hidden: number[] } {
  const first = week[0]!
  const last = week[6]!
  const items: { key: string; kind: Bar['kind']; title: string; from: string; to: string }[] = []
  for (const event of range?.events ?? [])
    if (event.day >= first && event.day <= last)
      items.push({
        key: `e-${event.id}`,
        kind: 'event',
        title: event.title,
        from: event.day,
        to: event.day,
      })
  for (const task of range?.tasks ?? []) {
    const span = taskSpan(task)
    if (span && span.from <= last && span.to >= first)
      items.push({ key: `t-${task.id}`, kind: 'task', title: task.title, ...span })
  }
  const clip = (day: string) => (day < first ? first : day > last ? last : day)
  items.sort(
    (a, b) =>
      Number(a.kind === 'task') - Number(b.kind === 'task') ||
      clip(a.from).localeCompare(clip(b.from)) ||
      daysUntil(clip(b.to), clip(b.from)) - daysUntil(clip(a.to), clip(a.from)) ||
      a.title.localeCompare(b.title),
  )

  const laneEnds: number[] = [] // the last column used on each line
  const bars: Bar[] = []
  const hidden = Array.from({ length: 7 }, () => 0)
  for (const item of items) {
    const column = daysUntil(clip(item.from), first)
    const end = daysUntil(clip(item.to), first)
    let lane = laneEnds.findIndex((used) => used < column)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = end
    if (lane >= lanes) {
      for (let c = column; c <= end; c++) hidden[c] = (hidden[c] ?? 0) + 1
      continue
    }
    bars.push({
      key: item.key,
      kind: item.kind,
      title: item.title,
      column,
      length: end - column + 1,
      lane,
      startsHere: item.from >= first,
      endsHere: item.to <= last,
    })
  }
  return { bars, hidden }
}

/** Where a day belongs, in words: a project, shared by someone, shared with people, or personal. */
export function belongsText(
  t: (key: string, options?: Record<string, unknown>) => string,
  event: Pick<CalendarEvent, 'projectName' | 'sharedBy' | 'sharedWith'>,
): string {
  if (event.projectName) return event.projectName
  if (event.sharedBy) return t('calendar.sharedBy', { name: event.sharedBy })
  if (event.sharedWith.length > 0)
    return t('calendar.sharedWith', { names: event.sharedWith.map(personName).join(', ') })
  return t('calendar.personal')
}

/** A "YYYY-MM-DD" from the address, or undefined when it is not a real day. */
export function parseDay(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : undefined
}
