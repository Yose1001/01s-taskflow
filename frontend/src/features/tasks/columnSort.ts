import type { Task, TaskStatus } from '../../api/types'
import {
  COLUMN_PREFIX,
  STATUSES,
  dropTarget,
  isStatus,
  type Columns,
  type Move,
} from './boardLogic'

// How each column is shown. Sorting changes only what this person sees: the order people arrange by
// hand stays saved on the server, and comes back when the column goes back to "manual".

export const SORTS = ['manual', 'priority', 'due', 'newest'] as const
export type ColumnSort = (typeof SORTS)[number]
export type ColumnSorts = Record<TaskStatus, ColumnSort>

const PRIORITY_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 }

function compare(a: Task, b: Task, sort: ColumnSort): number {
  switch (sort) {
    case 'priority':
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    case 'due':
      // Tasks without a date go last. Days are "YYYY-MM-DD", so comparing the text is enough.
      if (a.dueDate === b.dueDate) return 0
      if (a.dueDate === null) return 1
      if (b.dueDate === null) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    case 'newest':
      return b.createdAt.localeCompare(a.createdAt)
    default:
      return 0
  }
}

/** The column's tasks in the chosen order. Ties keep the order they were arranged in. */
export function sortColumn(tasks: Task[], sort: ColumnSort): Task[] {
  if (sort === 'manual') return tasks
  return [...tasks].sort((a, b) => compare(a, b, sort) || a.position - b.position)
}

function columnOf(columns: Columns, id: string): TaskStatus | null {
  if (id.startsWith(COLUMN_PREFIX)) {
    const status = id.slice(COLUMN_PREFIX.length)
    return isStatus(status) ? status : null
  }
  return STATUSES.find((status) => columns[status].some((task) => task.id === id)) ?? null
}

/**
 * What a drop means when columns can be sorted. `columns` must be in the arranged order, not the sorted one.
 * - A column in its arranged order works as usual.
 * - A card dropped into a sorted column just joins it: the sort decides where it shows.
 * - Arranging by hand inside a sorted column is impossible, so that answers 'sorted' and nothing moves.
 */
export function dropWithSorts(
  columns: Columns,
  sorts: ColumnSorts,
  activeId: string,
  overId: string,
  after = false,
): Move | 'sorted' | null {
  if (overId === activeId) return null
  const from = columnOf(columns, activeId)
  const to = columnOf(columns, overId)
  if (!from || !to) return null
  if (sorts[to] === 'manual') return dropTarget(columns, activeId, overId, after)
  if (from === to) return 'sorted'
  return { taskId: activeId, status: to, beforeTaskId: null }
}

const storageKey = (projectId: string) => `tf-column-sorts:${projectId}`

function isSort(value: unknown): value is ColumnSort {
  return typeof value === 'string' && (SORTS as readonly string[]).includes(value)
}

/** The sorts this device last used for a project. Anything unexpected in storage counts as "manual". */
export function loadColumnSorts(projectId: string): ColumnSorts {
  const sorts: ColumnSorts = {
    todo: 'manual',
    in_progress: 'manual',
    review: 'manual',
    on_hold: 'manual',
    done: 'manual',
  }
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? '{}')
    if (typeof saved !== 'object' || saved === null) return sorts
    for (const status of STATUSES) {
      const value = (saved as Record<string, unknown>)[status]
      if (isSort(value)) sorts[status] = value
    }
  } catch {
    // Unreadable storage: start from the arranged order.
  }
  return sorts
}

export function saveColumnSorts(projectId: string, sorts: ColumnSorts) {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(sorts))
  } catch {
    // Storage blocked: the choice still applies until the page is reloaded.
  }
}
