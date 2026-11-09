// Plain calendar days as "YYYY-MM-DD", with no time zone, so a day can never shift by one. Dates are built in
// UTC only to do the arithmetic. Plain string comparison orders these days correctly.

const toDate = (day: string) => new Date(`${day}T00:00:00Z`)
const toDay = (date: Date) => date.toISOString().slice(0, 10)

/** Today in the person's own time zone. */
export function today(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const date = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${date}`
}

export const yearOf = (day: string) => toDate(day).getUTCFullYear()
/** 0 = January. */
export const monthOf = (day: string) => toDate(day).getUTCMonth()

export function addDays(day: string, days: number): string {
  const date = toDate(day)
  date.setUTCDate(date.getUTCDate() + days)
  return toDay(date)
}

/** The same day in another month, or that month's last day if it is shorter (31 Jan + 1 month = 28 Feb). */
export function inMonth(day: string, year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return toDay(new Date(Date.UTC(year, month, Math.min(toDate(day).getUTCDate(), lastDay))))
}

export function addMonths(day: string, months: number): string {
  return inMonth(day, yearOf(day), monthOf(day) + months)
}

/** The Sunday that starts the day's week. */
export const startOfWeek = (day: string) => addDays(day, -toDate(day).getUTCDay())

/** The six weeks (42 days) that show the day's month, always the same height so the calendar does not jump. */
export function monthCells(day: string): string[] {
  const first = startOfWeek(inMonth(day, yearOf(day), monthOf(day)).slice(0, 8) + '01')
  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}

export function isOutside(day: string, min?: string, max?: string): boolean {
  return (min !== undefined && day < min) || (max !== undefined && day > max)
}

/** The words a calendar shows, in the UI language. Thai years are Buddhist-era. */
export function calendarText(language: string) {
  const locale = language.startsWith('th') ? 'th-TH' : 'en-GB'
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
  const monthName = format({ month: 'long' })
  const yearName = format({ year: 'numeric' })
  const weekdayShort = format({ weekday: 'short' })
  const weekdayLong = format({ weekday: 'long' })
  const fullDay = format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  // 7 January 2024 was a Sunday.
  const week = Array.from({ length: 7 }, (_, index) => toDate(addDays('2024-01-07', index)))
  return {
    months: Array.from({ length: 12 }, (_, month) => monthName.format(Date.UTC(2024, month, 1))),
    year: (year: number) => yearName.format(Date.UTC(year, 0, 1)),
    weekdays: week.map((date) => ({
      short: weekdayShort.format(date),
      long: weekdayLong.format(date),
    })),
    fullDay: (day: string) => fullDay.format(toDate(day)),
  }
}
