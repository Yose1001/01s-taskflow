import { describe, expect, it } from 'vitest'
import type { CalendarEvent, CalendarTask } from '../../api/types'
import { daysUntil, eventPeople, itemsByDay, itemsOn, parseDay, weekBars } from './calendarLogic'

const event = (id: string, day: string): CalendarEvent => ({
  id,
  title: id,
  note: '',
  day,
  projectId: null,
  projectName: null,
  ownerId: 'me',
  createdBy: 'me',
  remindDays: [],
  sharedWith: [],
  sharedBy: null,
  canEdit: true,
  createdAt: '',
  updatedAt: '',
})

const task = (id: string, startDate: string | null, dueDate: string | null): CalendarTask => ({
  id,
  projectId: 'p',
  projectName: 'P',
  title: id,
  status: 'todo',
  startDate,
  dueDate,
  assigneeIds: [],
})

// The week of Sunday 7 March 2099 to Saturday 13 March 2099.
const WEEK = ['07', '08', '09', '10', '11', '12', '13'].map((d) => `2099-03-${d}`)

describe('itemsByDay', () => {
  it('puts important days on their day, and a task on every day from its start to its end', () => {
    const byDay = itemsByDay(
      {
        events: [event('demo', '2099-03-10'), event('party', '2099-03-10')],
        tasks: [
          task('span', '2099-03-10', '2099-03-13'),
          task('one day', '2099-03-03', '2099-03-03'),
          task('end only', null, '2099-03-20'),
          task('start only', '2099-03-21', null),
        ],
      },
      '2099-03-01',
      '2099-04-11',
    )
    expect(itemsOn(byDay, '2099-03-10').events.map((e) => e.id)).toEqual(['demo', 'party'])
    expect(itemsOn(byDay, '2099-03-10').tasks[0]!.mark).toEqual({ kind: 'start' })
    expect(itemsOn(byDay, '2099-03-11').tasks[0]!.mark).toEqual({
      kind: 'during',
      day: 2,
      total: 4,
    })
    expect(itemsOn(byDay, '2099-03-12').tasks[0]!.mark).toEqual({
      kind: 'during',
      day: 3,
      total: 4,
    })
    expect(itemsOn(byDay, '2099-03-13').tasks[0]!.mark).toEqual({ kind: 'due' })
    expect(itemsOn(byDay, '2099-03-14').tasks).toEqual([])
    expect(itemsOn(byDay, '2099-03-03').tasks[0]!.mark).toEqual({ kind: 'both' })
    expect(itemsOn(byDay, '2099-03-20').tasks[0]!.mark).toEqual({ kind: 'due' })
    expect(itemsOn(byDay, '2099-03-21').tasks[0]!.mark).toEqual({ kind: 'start' })
  })

  it('only fills the days on screen, however long a task is', () => {
    const byDay = itemsByDay(
      { events: [], tasks: [task('long', '2000-01-01', '2999-12-31')] },
      '2099-03-01',
      '2099-03-03',
    )
    expect([...byDay.keys()]).toEqual(['2099-03-01', '2099-03-02', '2099-03-03'])
  })

  it('copes with nothing loaded yet', () => {
    expect(itemsOn(itemsByDay(undefined, '2099-03-01', '2099-03-31'), '2099-03-10')).toEqual({
      events: [],
      tasks: [],
    })
  })
})

describe('weekBars', () => {
  it('draws a task as one bar across its days', () => {
    const { bars } = weekBars(
      WEEK,
      { events: [], tasks: [task('Design', '2099-03-10', '2099-03-13')] },
      2,
    )
    expect(bars).toEqual([
      expect.objectContaining({
        title: 'Design',
        column: 3,
        length: 4,
        lane: 0,
        startsHere: true,
        endsHere: true,
      }),
    ])
  })

  it('cuts a bar at the edges of the week, and says it carries on', () => {
    const { bars } = weekBars(
      WEEK,
      { events: [], tasks: [task('Long', '2099-03-01', '2099-03-20')] },
      2,
    )
    expect(bars[0]).toMatchObject({ column: 0, length: 7, startsHere: false, endsHere: false })
  })

  it('puts overlapping bars on different lines, important days first, and counts what does not fit', () => {
    const { bars, hidden } = weekBars(
      WEEK,
      {
        events: [event('Demo', '2099-03-11')],
        tasks: [task('A', '2099-03-10', '2099-03-12'), task('B', '2099-03-08', '2099-03-11')],
      },
      2,
    )
    expect(bars.map((b) => [b.title, b.lane])).toEqual([
      ['Demo', 0],
      ['B', 1],
    ])
    // A did not fit: its three days each say "+1".
    expect(hidden).toEqual([0, 0, 0, 1, 1, 1, 0])
  })

  it('lets bars that do not touch share a line', () => {
    const { bars } = weekBars(
      WEEK,
      {
        events: [],
        tasks: [
          task('Early', '2099-03-07', '2099-03-08'),
          task('Late', '2099-03-10', '2099-03-11'),
        ],
      },
      1,
    )
    expect(bars.map((b) => b.lane)).toEqual([0, 0])
  })
})

describe('daysUntil', () => {
  it('counts whole days, also across months, and below zero once passed', () => {
    expect(daysUntil('2030-05-10', '2030-05-10')).toBe(0)
    expect(daysUntil('2030-05-11', '2030-05-10')).toBe(1)
    expect(daysUntil('2030-06-01', '2030-05-31')).toBe(1)
    expect(daysUntil('2030-05-09', '2030-05-10')).toBe(-1)
  })
})

describe('parseDay', () => {
  it('accepts only real days', () => {
    expect(parseDay('2030-05-10')).toBe('2030-05-10')
    expect(parseDay('2030-02-30')).toBeUndefined()
    expect(parseDay('tomorrow')).toBeUndefined()
    expect(parseDay(null)).toBeUndefined()
  })
})

describe('eventPeople', () => {
  const me = { id: 'me', name: 'Me' }
  const names = new Map([['c', 'Creator']])
  const bob = { userId: 'b', displayName: 'Bob', email: 'bob@example.com' }

  it('gives the owner themselves and everyone the day is shared with', () => {
    expect(eventPeople({ ...event('e', '2030-01-01'), sharedWith: [bob] }, me, names)).toEqual([
      me,
      { id: 'b', name: 'Bob' },
    ])
  })

  it('gives someone it was shared with the owner and themselves only', () => {
    const shared = { ...event('e', '2030-01-01'), ownerId: 'o', sharedBy: 'Olive' }
    expect(eventPeople(shared, me, names)).toEqual([{ id: 'o', name: 'Olive' }, me])
  })

  it("gives a project's day the person who added it, when their name is known", () => {
    const day = { ...event('e', '2030-01-01'), projectId: 'p', ownerId: null, createdBy: 'c' }
    expect(eventPeople(day, me, names)).toEqual([{ id: 'c', name: 'Creator' }])
    expect(eventPeople({ ...day, createdBy: 'x' }, me, names)).toEqual([])
  })
})
