import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  calendarText,
  inMonth,
  isOutside,
  monthCells,
  monthOf,
  startOfWeek,
  today,
  yearOf,
} from './calendar'

describe('calendar days', () => {
  it('gives today in the local time zone, as a plain day', () => {
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(today(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })

  it('reads the year and month', () => {
    expect(yearOf('2026-03-15')).toBe(2026)
    expect(monthOf('2026-03-15')).toBe(2)
  })

  it('adds days across months, years and a leap day', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('moves by months, landing on the last day when the month is shorter', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28')
    expect(inMonth('2026-03-31', 2027, 3)).toBe('2027-04-30')
  })

  it('finds the Sunday that starts a week', () => {
    expect(startOfWeek('2026-11-09')).toBe('2026-11-08') // a Monday
    expect(startOfWeek('2026-11-08')).toBe('2026-11-08') // a Sunday already
  })

  it('always shows six whole weeks that include the whole month', () => {
    for (const day of ['2026-02-15', '2026-11-30', '2024-02-29', '2026-08-01']) {
      const cells = monthCells(day)
      expect(cells).toHaveLength(42)
      expect(startOfWeek(cells[0]!)).toBe(cells[0])
      const inThisMonth = cells.filter((cell) => cell.slice(0, 7) === day.slice(0, 7))
      expect(inThisMonth[0]!.slice(8)).toBe('01')
      expect(inThisMonth).toHaveLength(
        new Date(Date.UTC(yearOf(day), monthOf(day) + 1, 0)).getUTCDate(),
      )
    }
  })

  it('knows what falls outside a limit, with the limits themselves allowed', () => {
    expect(isOutside('2026-03-01', '2026-03-02')).toBe(true)
    expect(isOutside('2026-03-02', '2026-03-02')).toBe(false)
    expect(isOutside('2026-03-03', undefined, '2026-03-02')).toBe(true)
    expect(isOutside('2026-03-02', undefined, '2026-03-02')).toBe(false)
    expect(isOutside('2026-03-02')).toBe(false)
  })
})

describe('calendarText()', () => {
  it('uses Buddhist-era years and Thai names in Thai', () => {
    const text = calendarText('th')
    expect(text.year(2026)).toContain('2569')
    expect(text.months[0]).toBe('มกราคม')
    expect(text.weekdays[0]!.long).toBe('วันอาทิตย์')
    expect(text.fullDay('2026-12-20')).toContain('20 ธันวาคม')
    expect(text.fullDay('2026-12-20')).toContain('2569')
  })

  it('uses Christian-era years and English names in English', () => {
    const text = calendarText('en')
    expect(text.year(2026)).toBe('2026')
    expect(text.months[11]).toBe('December')
    expect(text.weekdays[0]).toEqual({ short: 'Sun', long: 'Sunday' })
    expect(text.fullDay('2026-12-20')).toBe('Sunday, 20 December 2026')
  })
})
