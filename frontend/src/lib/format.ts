/** A readable date in the UI language (Thai years are Buddhist-era, as Thai readers expect). */
export function formatDate(iso: string, language: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const locale = language.startsWith('th') ? 'th-TH' : 'en-GB'
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/** A calendar day ("YYYY-MM-DD", no time zone) in the UI language. Read as UTC so the day never shifts. */
export function formatDay(day: string, language: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return ''
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  const locale = language.startsWith('th') ? 'th-TH' : 'en-GB'
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** A calendar day in few characters: "20 Nov" in the current year, "20 Nov 2027" in any other. */
export function formatDayShort(day: string, language: string, now: Date = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return ''
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  const locale = language.startsWith('th') ? 'th-TH' : 'en-GB'
  const sameYear = date.getUTCFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' as const }),
    timeZone: 'UTC',
  }).format(date)
}

/**
 * One or two letters for a small avatar: "Alice Smith" -> "AS", "สมชาย" -> "ส".
 * Thai vowels written before the consonant (เ แ โ ใ ไ) are skipped, so "เอก" gives "อ".
 */
/**
 * A start and an end day, written as short as is still clear: "9–10 Nov" in one month, "28 Oct – 3 Nov"
 * across months, and with both years when the range crosses a year. The two parts come back separately,
 * so each can sit in its own <time> element.
 */
export function formatDayRange(
  start: string,
  end: string,
  language: string,
  now: Date = new Date(),
): { start: string; end: string; joiner: string } {
  const [startYear, startMonth] = start.split('-')
  const [endYear, endMonth] = end.split('-')
  if (startYear !== endYear)
    return { start: formatDay(start, language), end: formatDay(end, language), joiner: ' – ' }
  if (startMonth === endMonth) {
    const locale = language.startsWith('th') ? 'th-TH' : 'en-GB'
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${start}T00:00:00Z`),
    )
    return { start: day, end: formatDayShort(end, language, now), joiner: '–' }
  }
  return {
    start: formatDayShort(start, language, new Date(`${start}T00:00:00Z`)), // the year goes on the end only
    end: formatDayShort(end, language, now),
    joiner: ' – ',
  }
}

/** What to call a person on screen: the name they chose, or their email if the name is empty. */
export function personName(person: { displayName?: string | undefined; email: string }): string {
  return person.displayName?.trim() || person.email
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const picked = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words
  const letter = (word: string) =>
    Array.from(word.replace(/^[เ-ไ]+/, ''))[0] ?? Array.from(word)[0] ?? ''
  return picked.map(letter).join('').toUpperCase() || '?'
}

/** Whole days from now until `iso` (never below 0). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const ms = new Date(iso).getTime() - now.getTime()
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / 86_400_000))
}
