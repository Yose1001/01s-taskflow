import { describe, expect, it } from 'vitest'
import type { CalendarEvent, CalendarTask } from '../../api/types'
import { daysUntil, itemsByDay, itemsOn, parseDay } from './calendarLogic'

const event = (id: string, day: string): CalendarEvent => ({
  id,
  title: id,
  note: '',
  day,
  projectId: null,
  projectName: null,
  createdBy: 'me',
  remindDays: [],
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
})

describe('itemsByDay', () => {
  it('puts important days on their day, and tasks on their start and end days only', () => {
    const byDay = itemsByDay({
      events: [event('demo', '2030-05-10'), event('party', '2030-05-10')],
      tasks: [
        task('span', '2030-05-01', '2030-05-10'),
        task('one day', '2030-05-03', '2030-05-03'),
        task('end only', null, '2030-05-20'),
        task('start only', '2030-05-21', null),
      ],
    })
    expect(itemsOn(byDay, '2030-05-10').events.map((e) => e.id)).toEqual(['demo', 'party'])
    expect(itemsOn(byDay, '2030-05-10').tasks).toEqual([
      { task: expect.objectContaining({ id: 'span' }), mark: 'due' },
    ])
    expect(itemsOn(byDay, '2030-05-01').tasks[0]!.mark).toBe('start')
    expect(itemsOn(byDay, '2030-05-05').tasks).toEqual([]) // not every day in between
    expect(itemsOn(byDay, '2030-05-03').tasks[0]!.mark).toBe('both')
    expect(itemsOn(byDay, '2030-05-20').tasks[0]!.mark).toBe('due')
    expect(itemsOn(byDay, '2030-05-21').tasks[0]!.mark).toBe('start')
  })

  it('copes with nothing loaded yet', () => {
    expect(itemsOn(itemsByDay(undefined), '2030-05-10')).toEqual({ events: [], tasks: [] })
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
