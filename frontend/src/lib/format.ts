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

/** Whole days from now until `iso` (never below 0). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const ms = new Date(iso).getTime() - now.getTime()
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / 86_400_000))
}
