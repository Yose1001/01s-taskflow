import type { Task, TaskPriority, TaskStatus } from '../../api/types'
import { today } from '../../lib/calendar'

export { today }

// The rules of the board, as plain functions (no React), so they can be tested without a browser.

export const STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'review', 'on_hold', 'done']
export const PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high']

/** Same spacing the API uses when a column is empty or a task goes last. */
const POSITION_STEP = 1024

export type Columns = Record<TaskStatus, Task[]>

export interface Filters {
  /** Part of a title (any case). */
  q: string
  priority: TaskPriority | ''
  /** '' = everyone, 'none' = unassigned, otherwise a user id. */
  assignee: string
}

export const NO_FILTERS: Filters = { q: '', priority: '', assignee: '' }
export const UNASSIGNED = 'none'

export function isStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

export function isPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value)
}

export function hasFilters(f: Filters): boolean {
  return f.q.trim() !== '' || f.priority !== '' || f.assignee !== ''
}

/** Tasks that pass every active filter. */
export function filterTasks(tasks: Task[], f: Filters): Task[] {
  const q = f.q.trim().toLowerCase()
  return tasks.filter((task) => {
    if (q && !task.title.toLowerCase().includes(q)) return false
    if (f.priority && task.priority !== f.priority) return false
    if (f.assignee === UNASSIGNED) return task.assigneeIds.length === 0
    if (f.assignee && !task.assigneeIds.includes(f.assignee)) return false
    return true
  })
}

/** Someone working on a task, as a card shows them. */
export interface Assignee {
  id: string
  name: string
}

/**
 * The people on a task whose names are known, in alphabetical order. The result is empty while the
 * member list has not arrived, even when the task has assignees.
 */
export function assigneesOf(task: Task, nameOf: ReadonlyMap<string, string>): Assignee[] {
  return task.assigneeIds
    .flatMap((id) => {
      const name = nameOf.get(id)
      return name ? [{ id, name }] : []
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Splits tasks into the four columns, each in board order (by position). */
export function byColumn(tasks: Task[]): Columns {
  const columns: Columns = { todo: [], in_progress: [], review: [], on_hold: [], done: [] }
  for (const task of tasks) columns[task.status].push(task)
  for (const status of STATUSES) columns[status].sort((a, b) => a.position - b.position)
  return columns
}

export const COLUMN_PREFIX = 'column:'
export const columnId = (status: TaskStatus) => `${COLUMN_PREFIX}${status}`

export interface Move {
  taskId: string
  status: TaskStatus
  /** The task it goes in front of; null = the end of the column. */
  beforeTaskId: string | null
  /** Why it is going on hold. */
  holdReason?: string
}

const MAX_HOLD_REASON = 500

/** What is wrong with a reason for holding a task, as an error code, or null when it is fine. */
export function holdReasonError(
  reason: string,
): 'hold_reason_required' | 'hold_reason_too_long' | null {
  const trimmed = reason.trim()
  if (trimmed === '') return 'hold_reason_required'
  return Array.from(trimmed).length > MAX_HOLD_REASON ? 'hold_reason_too_long' : null
}

/**
 * Works out what a drop means. `columns` is what the person sees (after filters), `overId` is what
 * the card was dropped on (a task, or a whole column), and `after` says the card was dropped on the
 * lower half of the task it is over. Returns null when nothing would change.
 */
export function dropTarget(
  columns: Columns,
  activeId: string,
  overId: string,
  after = false,
): Move | null {
  const from = locate(columns, activeId)
  if (!from) return null

  // Dropped on empty space of a column: it goes to the end.
  if (overId.startsWith(COLUMN_PREFIX)) {
    const status = overId.slice(COLUMN_PREFIX.length)
    if (!isStatus(status)) return null
    const column = columns[status]
    if (from.status === status && column[column.length - 1]?.id === activeId) return null
    return { taskId: activeId, status, beforeTaskId: null }
  }

  if (overId === activeId) return null
  const over = locate(columns, overId)
  if (!over) return null

  const column = columns[over.status]
  if (from.status === over.status) {
    // Inside one column the direction decides: moving down puts it after the task it landed on.
    const beforeTaskId = from.index < over.index ? (column[over.index + 1]?.id ?? null) : overId
    return { taskId: activeId, status: over.status, beforeTaskId }
  }
  // Another column: in front of the task, or behind it when dropped on its lower half.
  const beforeTaskId = after ? (column[over.index + 1]?.id ?? null) : overId
  return { taskId: activeId, status: over.status, beforeTaskId }
}

export interface Box {
  top: number
  height: number
}

/**
 * Was the card dropped on the lower half of the card it landed on? The pointer decides when there is
 * one (mouse, finger); otherwise (keyboard) the middle of the moved card does.
 */
export function droppedOnLowerHalf(
  over: Box,
  pointerY: number | null,
  dragged: Box | null,
): boolean {
  const middle = over.top + over.height / 2
  if (pointerY !== null) return pointerY > middle
  return dragged !== null && dragged.top + dragged.height / 2 > middle
}

function locate(columns: Columns, id: string): { status: TaskStatus; index: number } | null {
  for (const status of STATUSES) {
    const index = columns[status].findIndex((task) => task.id === id)
    if (index !== -1) return { status, index }
  }
  return null
}

/**
 * Applies a move to a list of tasks right away (before the server answers), choosing a position
 * the same way the API does: halfway between the two neighbours.
 */
export function applyMove(tasks: Task[], move: Move): Task[] {
  const others = tasks
    .filter((task) => task.status === move.status && task.id !== move.taskId)
    .sort((a, b) => a.position - b.position)

  let position = POSITION_STEP
  if (move.beforeTaskId === null) {
    const last = others[others.length - 1]
    if (last) position = last.position + POSITION_STEP
  } else {
    const index = others.findIndex((task) => task.id === move.beforeTaskId)
    if (index === -1) return tasks // the target vanished; leave the board as it is
    const next = others[index]!.position
    const prev = others[index - 1]?.position ?? 0
    position = (prev + next) / 2
  }

  return tasks.map((task) =>
    task.id === move.taskId
      ? {
          ...task,
          status: move.status,
          position,
          holdReason: move.status === 'on_hold' ? (move.holdReason ?? task.holdReason) : null,
        }
      : task,
  )
}

/** A task is overdue when its day has passed and it is not done. Plain string compare works for ISO days. */
export function isOverdue(task: Pick<Task, 'dueDate' | 'status'>, now: Date = new Date()): boolean {
  return task.dueDate !== null && task.status !== 'done' && task.dueDate < today(now)
}
