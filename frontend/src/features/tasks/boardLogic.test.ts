import { describe, expect, it } from 'vitest'
import { task } from '../../test/fakeBackend'
import { formatDay } from '../../lib/format'
import {
  NO_FILTERS,
  applyMove,
  byColumn,
  columnId,
  dropTarget,
  filterTasks,
  hasFilters,
  isOverdue,
  today,
} from './boardLogic'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

// To do: t1 t2 t3 (in that order). In progress: p1. Review and Done: empty.
const tasks = [
  task('t3', 'Third', { position: 3072 }),
  task('t1', 'First', { position: 1024 }),
  task('t2', 'Second', { position: 2048 }),
  task('p1', 'Doing', { status: 'in_progress', position: 1024 }),
]

describe('byColumn()', () => {
  it('splits into the four columns and orders each by position', () => {
    const columns = byColumn(tasks)
    expect(columns.todo.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(columns.in_progress.map((t) => t.id)).toEqual(['p1'])
    expect(columns.review).toEqual([])
    expect(columns.done).toEqual([])
  })

  it('does not change the list it was given', () => {
    const before = tasks.map((t) => t.id)
    byColumn(tasks)
    expect(tasks.map((t) => t.id)).toEqual(before)
  })
})

describe('filterTasks()', () => {
  const list = [
    task('a', 'Fix Login bug', { priority: 'high', assigneeId: A }),
    task('b', 'Write docs', { priority: 'low', assigneeId: B }),
    task('c', 'Plan login page', { priority: 'high', assigneeId: null }),
  ]
  const ids = (f: Partial<typeof NO_FILTERS>) =>
    filterTasks(list, { ...NO_FILTERS, ...f }).map((t) => t.id)

  it('keeps everything when no filter is set', () => {
    expect(ids({})).toEqual(['a', 'b', 'c'])
    expect(hasFilters(NO_FILTERS)).toBe(false)
  })

  it('searches the title, ignoring case and surrounding spaces', () => {
    expect(ids({ q: ' LOGIN ' })).toEqual(['a', 'c'])
    expect(ids({ q: 'nothing like this' })).toEqual([])
  })

  it('treats % and _ in the search as ordinary letters', () => {
    expect(filterTasks([task('x', '100% done')], { ...NO_FILTERS, q: '%' })).toHaveLength(1)
    expect(ids({ q: '%' })).toEqual([])
    expect(ids({ q: '_' })).toEqual([])
  })

  it('filters by priority', () => {
    expect(ids({ priority: 'high' })).toEqual(['a', 'c'])
    expect(ids({ priority: 'low' })).toEqual(['b'])
  })

  it('filters by person, and "none" means unassigned', () => {
    expect(ids({ assignee: A })).toEqual(['a'])
    expect(ids({ assignee: 'none' })).toEqual(['c'])
  })

  it('combines filters (all must match)', () => {
    expect(ids({ q: 'login', priority: 'high', assignee: A })).toEqual(['a'])
    expect(ids({ q: 'docs', priority: 'high' })).toEqual([])
    expect(hasFilters({ ...NO_FILTERS, priority: 'low' })).toBe(true)
  })
})

describe('dropTarget()', () => {
  const columns = byColumn(tasks)

  it('moving down inside a column puts the card after the one it landed on', () => {
    // t1 dropped on t2 -> in front of t3
    expect(dropTarget(columns, 't1', 't2')).toEqual({
      taskId: 't1',
      status: 'todo',
      beforeTaskId: 't3',
    })
  })

  it('moving down onto the last card sends it to the end', () => {
    expect(dropTarget(columns, 't1', 't3')).toEqual({
      taskId: 't1',
      status: 'todo',
      beforeTaskId: null,
    })
  })

  it('moving up inside a column puts the card in front of the one it landed on', () => {
    expect(dropTarget(columns, 't3', 't1')).toEqual({
      taskId: 't3',
      status: 'todo',
      beforeTaskId: 't1',
    })
    expect(dropTarget(columns, 't3', 't2')).toEqual({
      taskId: 't3',
      status: 'todo',
      beforeTaskId: 't2',
    })
  })

  it('does nothing when a card is dropped on itself', () => {
    expect(dropTarget(columns, 't2', 't2')).toBeNull()
  })

  it('into another column: in front of the card it landed on', () => {
    expect(dropTarget(columns, 't2', 'p1')).toEqual({
      taskId: 't2',
      status: 'in_progress',
      beforeTaskId: 'p1',
    })
  })

  it('into another column, on its lower half: behind that card', () => {
    expect(dropTarget(columns, 't2', 'p1', true)).toEqual({
      taskId: 't2',
      status: 'in_progress',
      beforeTaskId: null,
    })
    const withTwo = byColumn([
      ...tasks,
      task('p2', 'Doing 2', { status: 'in_progress', position: 2048 }),
    ])
    expect(dropTarget(withTwo, 't1', 'p1', true)?.beforeTaskId).toBe('p2')
  })

  it('onto an empty column or its empty space: the end of that column', () => {
    expect(dropTarget(columns, 't1', columnId('done'))).toEqual({
      taskId: 't1',
      status: 'done',
      beforeTaskId: null,
    })
    expect(dropTarget(columns, 't1', columnId('in_progress'))?.beforeTaskId).toBeNull()
  })

  it('onto its own column when it is already last: nothing changes', () => {
    expect(dropTarget(columns, 't3', columnId('todo'))).toBeNull()
    expect(dropTarget(columns, 't1', columnId('todo'))).toEqual({
      taskId: 't1',
      status: 'todo',
      beforeTaskId: null,
    })
  })

  it('ignores ids it does not know (never invents a move)', () => {
    expect(dropTarget(columns, 'ghost', 't1')).toBeNull()
    expect(dropTarget(columns, 't1', 'ghost')).toBeNull()
    expect(dropTarget(columns, 't1', 'column:archive')).toBeNull()
  })
})

describe('applyMove()', () => {
  const positionOf = (list: ReturnType<typeof applyMove>, id: string) =>
    list.find((t) => t.id === id)!.position
  const order = (list: ReturnType<typeof applyMove>, status: 'todo' | 'in_progress' | 'done') =>
    byColumn(list)[status].map((t) => t.id)

  it('puts a card between its two neighbours, like the API does', () => {
    const moved = applyMove(tasks, { taskId: 't3', status: 'todo', beforeTaskId: 't2' })
    expect(positionOf(moved, 't3')).toBe((1024 + 2048) / 2)
    expect(order(moved, 'todo')).toEqual(['t1', 't3', 't2'])
  })

  it('puts a card first when nothing is before the target', () => {
    const moved = applyMove(tasks, { taskId: 't3', status: 'todo', beforeTaskId: 't1' })
    expect(positionOf(moved, 't3')).toBe(512)
    expect(order(moved, 'todo')).toEqual(['t3', 't1', 't2'])
  })

  it('moves to the end of another column, and into an empty one', () => {
    const toEnd = applyMove(tasks, { taskId: 't1', status: 'in_progress', beforeTaskId: null })
    expect(positionOf(toEnd, 't1')).toBe(1024 + 1024)
    expect(order(toEnd, 'in_progress')).toEqual(['p1', 't1'])
    expect(order(toEnd, 'todo')).toEqual(['t2', 't3'])

    const toEmpty = applyMove(tasks, { taskId: 't1', status: 'done', beforeTaskId: null })
    expect(positionOf(toEmpty, 't1')).toBe(1024)
    expect(order(toEmpty, 'done')).toEqual(['t1'])
  })

  it('leaves the board alone when the target no longer exists', () => {
    expect(applyMove(tasks, { taskId: 't1', status: 'todo', beforeTaskId: 'ghost' })).toBe(tasks)
  })

  it('does not change the list it was given', () => {
    const copy = JSON.stringify(tasks)
    applyMove(tasks, { taskId: 't1', status: 'done', beforeTaskId: null })
    expect(JSON.stringify(tasks)).toBe(copy)
  })
})

describe('due dates', () => {
  const noon = new Date(2026, 11, 5, 12, 0, 0) // 5 Dec 2026, local time

  it('today() is the local calendar day, zero padded', () => {
    expect(today(noon)).toBe('2026-12-05')
    expect(today(new Date(2026, 0, 3, 23, 59))).toBe('2026-01-03')
  })

  it('a task is overdue only when its day has passed and it is not done', () => {
    expect(isOverdue({ dueDate: '2026-12-04', status: 'todo' }, noon)).toBe(true)
    expect(isOverdue({ dueDate: '2026-12-05', status: 'todo' }, noon)).toBe(false) // due today
    expect(isOverdue({ dueDate: '2026-12-06', status: 'todo' }, noon)).toBe(false)
    expect(isOverdue({ dueDate: '2026-12-04', status: 'done' }, noon)).toBe(false)
    expect(isOverdue({ dueDate: null, status: 'todo' }, noon)).toBe(false)
  })

  it('formatDay() shows the same day in any time zone, in the UI language', () => {
    expect(formatDay('2026-12-01', 'en')).toBe('1 Dec 2026')
    expect(formatDay('2026-12-01', 'th')).toMatch(/1.*2569/)
    expect(formatDay('not a date', 'en')).toBe('')
    expect(formatDay('2026-13-45', 'en')).toBe('')
  })
})
