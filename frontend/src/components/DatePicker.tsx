import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
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
} from '../lib/calendar'
import { formatDay } from '../lib/format'
import { Icon } from './Icon'

// How far the year list reaches from this year (and it always includes the year on show).
const YEARS_AROUND = 10
const CALENDAR_WIDTH = 312
const CALENDAR_HEIGHT = 412
const EDGE = 8

function Calendar({
  label,
  value,
  min,
  max,
  panel,
  style,
  onPick,
  onClose,
}: {
  label: string
  value: string
  min?: string | undefined
  max?: string | undefined
  panel: RefObject<HTMLDivElement | null>
  style: CSSProperties
  onPick: (day: string) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const text = useMemo(() => calendarText(i18n.language), [i18n.language])
  const now = today()
  // The day the keyboard is on. The month on show is always the month of this day.
  const [cursor, setCursor] = useState(() => {
    if (value) return value
    if (min && now < min) return min
    if (max && now > max) return max
    return now
  })
  const moveFocus = useRef(true) // into the grid when it opens, and after moving with the keyboard
  const grid = useRef<HTMLTableElement>(null)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    grid.current
      ?.querySelector<HTMLElement>(`[data-day="${cursor}"]`)
      ?.focus({ preventScroll: true })
  }, [cursor])

  const year = yearOf(cursor)
  const month = monthOf(cursor)
  const thisYear = yearOf(now)
  const years = useMemo(() => {
    const around = Array.from(
      { length: YEARS_AROUND * 2 + 1 },
      (_, i) => thisYear - YEARS_AROUND + i,
    )
    return around.includes(year) ? around : [...around, year].sort((a, b) => a - b)
  }, [thisYear, year])

  function onGridKeyDown(event: KeyboardEvent) {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      Home: () => startOfWeek(cursor),
      End: () => addDays(startOfWeek(cursor), 6),
      PageUp: () => addMonths(cursor, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(cursor, event.shiftKey ? 12 : 1),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    moveFocus.current = true
    setCursor(move())
  }

  const switchMonth =
    'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-text hover:bg-primary-bg'
  const choose =
    'min-w-0 flex-1 rounded-lg border border-border bg-surface px-1 py-1.5 text-sm text-text'

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      style={style}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation() // inside a dialog, Escape closes only the calendar
        onClose()
      }}
      className="fixed z-10 max-h-[calc(100vh-1rem)] overflow-auto rounded-2xl border border-border bg-surface p-2 shadow-xl"
    >
      <div className="mb-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, -1))}
          aria-label={t('datePicker.previousMonth')}
          className={switchMonth}
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <select
          value={month}
          onChange={(event) => setCursor(inMonth(cursor, year, Number(event.target.value)))}
          aria-label={t('datePicker.month')}
          className={choose}
        >
          {text.months.map((name, index) => (
            <option key={name} value={index}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={year}
          onChange={(event) => setCursor(inMonth(cursor, Number(event.target.value), month))}
          aria-label={t('datePicker.year')}
          className={choose}
        >
          {years.map((option) => (
            <option key={option} value={option}>
              {text.year(option)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setCursor(addMonths(cursor, 1))}
          aria-label={t('datePicker.nextMonth')}
          className={switchMonth}
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>

      <table
        ref={grid}
        role="grid"
        aria-label={`${text.months[month]} ${text.year(year)}`}
        onKeyDown={onGridKeyDown}
        className="w-full table-fixed border-collapse"
      >
        <thead>
          <tr>
            {text.weekdays.map((weekday) => (
              <th
                key={weekday.long}
                scope="col"
                abbr={weekday.long}
                className="pb-1 text-xs font-medium text-muted"
              >
                {weekday.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, week) => (
            <tr key={week}>
              {monthCells(cursor)
                .slice(week * 7, week * 7 + 7)
                .map((day) => {
                  const picked = day === value
                  const isToday = day === now
                  const outside = isOutside(day, min, max)
                  const otherMonth = monthOf(day) !== month
                  return (
                    <td key={day} role="gridcell" aria-selected={picked} className="p-0.5">
                      <button
                        type="button"
                        data-day={day}
                        tabIndex={day === cursor ? 0 : -1}
                        aria-label={text.fullDay(day)}
                        aria-current={isToday ? 'date' : undefined}
                        // Not the disabled attribute: the arrow keys must still be able to pass through this day.
                        aria-disabled={outside || undefined}
                        onClick={() => {
                          if (!outside) onPick(day)
                        }}
                        className={`h-10 w-full rounded-lg text-sm ${
                          picked
                            ? 'bg-primary font-semibold text-on-primary'
                            : outside
                              ? 'cursor-not-allowed text-muted line-through opacity-50'
                              : `hover:bg-primary-bg ${otherMonth ? 'text-muted' : 'text-text'}`
                        } ${isToday && !picked ? 'font-semibold ring-1 ring-inset ring-primary' : ''}`}
                      >
                        {Number(day.slice(8))}
                      </button>
                    </td>
                  )
                })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1 flex justify-center">
        <button
          type="button"
          disabled={isOutside(now, min, max)}
          onClick={() => onPick(now)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary-fg hover:bg-primary-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('datePicker.today')}
        </button>
      </div>
    </div>
  )
}

/**
 * Chooses a calendar day ("YYYY-MM-DD", or '' for none) with the app's own calendar. The browser's own one
 * cannot show Buddhist-era years or follow the app's language and theme.
 *
 * The calendar follows the WAI-ARIA date picker pattern: arrow keys move by day and week, Home and End to the
 * ends of the week, Page Up and Page Down by month (with Shift, by year), Enter or Space picks the day, and
 * Escape closes it with the focus back on the field.
 */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  min,
  max,
  error,
}: {
  id: string
  label: string
  value: string
  onChange: (day: string) => void
  /** The earliest and latest days that can be chosen. */
  min?: string | undefined
  max?: string | undefined
  error?: string | undefined
}) {
  const { t, i18n } = useTranslation()
  const generatedId = useId()
  const labelId = `${generatedId}-label`
  const valueId = `${generatedId}-value`
  const errorId = `${generatedId}-error`
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const open = style !== null
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  function openCalendar() {
    const box = trigger.current?.getBoundingClientRect()
    if (!box) return
    const width = Math.min(CALENDAR_WIDTH, window.innerWidth - EDGE * 2)
    const fitsBelow = window.innerHeight - box.bottom - EDGE >= CALENDAR_HEIGHT
    const above = box.top - CALENDAR_HEIGHT - EDGE
    setStyle({
      width,
      left: Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE)),
      top: fitsBelow ? box.bottom + 4 : Math.max(EDGE, above),
    })
  }

  function close() {
    setStyle(null)
    trigger.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setStyle(null)
    }
    // It is placed against the window, so it would no longer sit next to its field.
    const onMoved = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('scroll', onMoved, true)
    window.addEventListener('resize', onMoved)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('scroll', onMoved, true)
      window.removeEventListener('resize', onMoved)
    }
  }, [open])

  return (
    <div
      ref={wrapper}
      onBlur={(event) => {
        // Tab has left the calendar. (No related target: a click on a blank part of it, which should stay open.)
        const next = event.relatedTarget as Node | null
        if (open && next && !wrapper.current?.contains(next)) setStyle(null)
      }}
    >
      <label id={labelId} htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <button
          ref={trigger}
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-labelledby={`${labelId} ${valueId}`}
          aria-describedby={error ? errorId : undefined}
          onClick={() => (open ? close() : openCalendar())}
          className={`flex w-full items-center gap-2 rounded-xl border bg-surface py-2 pl-3 pr-10 text-left focus:border-primary ${
            error ? 'border-danger-fg' : 'border-border'
          }`}
        >
          <span className="shrink-0 text-muted">
            <Icon name="calendar" size={16} />
          </span>
          <span id={valueId} className={`truncate ${value ? 'text-text' : 'text-muted'}`}>
            {value ? formatDay(value, i18n.language) : t('datePicker.placeholder')}
          </span>
        </button>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('')
              close()
            }}
            aria-label={t('datePicker.clear', { label })}
            className="absolute inset-y-0 right-1 my-1 grid w-8 place-items-center rounded-lg text-muted hover:bg-primary-bg hover:text-text"
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger-fg">
          {error}
        </p>
      )}
      {style && (
        <Calendar
          label={label}
          value={value}
          min={min}
          max={max}
          panel={panel}
          style={style}
          onPick={(day) => {
            onChange(day)
            close()
          }}
          onClose={close}
        />
      )}
    </div>
  )
}
