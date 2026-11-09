import { describe, expect, it } from 'vitest'
import type { Task } from '../../api/types'
import { task } from '../../test/fakeBackend'
import { byColumn } from './boardLogic'
import {
  dropWithSorts,
  loadColumnSorts,
  saveColumnSorts,
  sortColumn,
  type ColumnSorts,
} from './columnSort'

const titles = (tasks: Task[]) => tasks.map((t) => t.title)

const sample = () => [
  task('a', 'Banana', {
    position: 1024,
    priority: 'low',
    dueDate: '2026-12-01',
    createdAt: '2026-01-02T00:00:00Z',
  }),
  task('b', 'apple', {
    position: 2048,
    priority: 'high',
    dueDate: null,
    createdAt: '2026-01-03T00:00:00Z',
  }),
  task('c', 'Cherry', {
    position: 3072,
    priority: 'medium',
    dueDate: '2026-11-01',
    createdAt: '2026-01-01T00:00:00Z',
  }),
]

describe('sortColumn', () => {
  it('leaves the arranged order alone for "manual"', () => {
    expect(titles(sortColumn(sample(), 'manual'))).toEqual(['Banana', 'apple', 'Cherry'])
  })

  it('sorts by priority, highest first', () => {
    expect(titles(sortColumn(sample(), 'priority'))).toEqual(['apple', 'Cherry', 'Banana'])
  })

  it('sorts by due date, soonest first, with no date last', () => {
    expect(titles(sortColumn(sample(), 'due'))).toEqual(['Cherry', 'Banana', 'apple'])
  })

  it('sorts by newest first', () => {
    expect(titles(sortColumn(sample(), 'newest'))).toEqual(['apple', 'Banana', 'Cherry'])
  })

  it('keeps the arranged order for ties, and does not change the list it was given', () => {
    const same = [
      task('a', 'First', { position: 1024, priority: 'high' }),
      task('b', 'Second', { position: 2048, priority: 'high' }),
    ]
    const before = titles(same)
    expect(titles(sortColumn(same, 'priority'))).toEqual(['First', 'Second'])
    expect(titles(same)).toEqual(before)
  })
})

describe('dropWithSorts', () => {
  const columns = () =>
    byColumn([
      task('a', 'A', { position: 1024 }),
      task('b', 'B', { position: 2048 }),
      task('c', 'C', { status: 'review', position: 1024 }),
    ])
  const sorts = (extra: Partial<ColumnSorts> = {}): ColumnSorts => ({
    todo: 'manual',
    in_progress: 'manual',
    on_hold: 'manual',
    review: 'manual',
    done: 'manual',
    ...extra,
  })

  it('works as usual in a column in its arranged order', () => {
    expect(dropWithSorts(columns(), sorts(), 'c', 'a')).toEqual({
      taskId: 'c',
      status: 'todo',
      beforeTaskId: 'a',
    })
  })

  it('lets a card join a sorted column without choosing a place in it', () => {
    expect(dropWithSorts(columns(), sorts({ todo: 'priority' }), 'c', 'a')).toEqual({
      taskId: 'c',
      status: 'todo',
      beforeTaskId: null,
    })
  })

  it('refuses to arrange by hand inside a sorted column', () => {
    expect(dropWithSorts(columns(), sorts({ todo: 'priority' }), 'a', 'b')).toBe('sorted')
    expect(dropWithSorts(columns(), sorts({ todo: 'priority' }), 'a', 'column:todo')).toBe('sorted')
  })

  it('a sorted column can still give a card away', () => {
    expect(dropWithSorts(columns(), sorts({ todo: 'priority' }), 'a', 'c')).toEqual({
      taskId: 'a',
      status: 'review',
      beforeTaskId: 'c',
    })
  })

  it('does nothing for a drop on itself or on something unknown', () => {
    expect(dropWithSorts(columns(), sorts({ todo: 'priority' }), 'a', 'a')).toBeNull()
    expect(dropWithSorts(columns(), sorts(), 'a', 'ghost')).toBeNull()
  })
})

describe('remembering the sorts', () => {
  it('starts in the arranged order', () => {
    expect(loadColumnSorts('p1').todo).toBe('manual')
  })

  it('remembers each project on its own', () => {
    const all = loadColumnSorts('p1')
    saveColumnSorts('p1', { ...all, review: 'due' })
    expect(loadColumnSorts('p1').review).toBe('due')
    expect(loadColumnSorts('p2').review).toBe('manual')
  })

  // "title" was offered once, so a browser may still have it saved.
  it.each(['not json', '[1,2]', '{"todo":"sideways"}', '{"todo":"title"}', 'null'])(
    'ignores what it cannot use in storage: %s',
    (saved) => {
      localStorage.setItem('tf-column-sorts:p1', saved)
      expect(loadColumnSorts('p1').todo).toBe('manual')
    },
  )
})
