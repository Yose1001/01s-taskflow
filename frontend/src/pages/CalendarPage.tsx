import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import type { CalendarEvent, CalendarRange } from '../api/types'
import { errorMessage } from '../auth/errors'
import { Button } from '../components/forms'
import { Icon } from '../components/Icon'
import { ErrorState, LoadingState } from '../components/states'
import { StatusBadge } from '../components/StatusBadge'
import { EventDialog } from '../features/calendar/EventDialog'
import {
  belongsText,
  itemsByDay,
  itemsOn,
  parseDay,
  weekBars,
  type Bar,
  type DayItems,
  type TaskMark,
} from '../features/calendar/calendarLogic'
import { useCalendar } from '../features/calendar/hooks'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  addDays,
  addMonths,
  calendarText,
  monthCells,
  monthOf,
  startOfWeek,
  today,
} from '../lib/calendar'

const SHOW_TASKS_KEY = 'tf-calendar-show-tasks'
/** How many lines of bars a week shows on wider screens; what does not fit is counted per day. */
const LANES = 2

function loadShowTasks(): boolean {
  try {
    return localStorage.getItem(SHOW_TASKS_KEY) !== 'false'
  } catch {
    return true
  }
}

function saveShowTasks(show: boolean) {
  try {
    localStorage.setItem(SHOW_TASKS_KEY, String(show))
  } catch {
    // Storage blocked: the choice still applies until the page is reloaded.
  }
}

const markIcon = (mark: TaskMark) =>
  mark.kind === 'due' || mark.kind === 'both' ? ('flag' as const) : ('calendar' as const)

/**
 * A month of important days and dated tasks from every project the person is in. The chosen day is in
 * the address (?day=YYYY-MM-DD), so a reminder can link to it and a reload keeps it.
 */
export function CalendarPage() {
  const { t, i18n } = useTranslation()
  useDocumentTitle(t('calendar.pageTitle'))
  const [params, setParams] = useSearchParams()
  const now = today()
  const selected = parseDay(params.get('day')) ?? now
  const cells = monthCells(selected)
  const calendar = useCalendar(cells[0]!, cells[41]!)
  const [showTasks, setShowTasks] = useState(loadShowTasks)
  const [dialog, setDialog] = useState<{ event?: CalendarEvent; day: string } | null>(null)
  const text = calendarText(i18n.language)
  const month = monthOf(selected)
  const monthTitle = `${text.months[month]} ${text.year(Number(selected.slice(0, 4)))}`

  const visible = useMemo<CalendarRange | undefined>(
    () =>
      calendar.data && (showTasks ? calendar.data : { events: calendar.data.events, tasks: [] }),
    [calendar.data, showTasks],
  )
  // Cheap (six weeks of days), and the React Compiler keeps it between renders.
  const byDay = itemsByDay(visible, cells[0]!, cells[41]!)

  // The keyboard moves the focus with the chosen day; a click does not need it.
  const grid = useRef<HTMLDivElement>(null)
  const focusChosen = useRef(false)
  useEffect(() => {
    if (!focusChosen.current) return
    focusChosen.current = false
    grid.current?.querySelector<HTMLElement>(`[data-day="${selected}"]`)?.focus()
  }, [selected])

  function choose(day: string, withFocus = false) {
    focusChosen.current = withFocus
    setParams({ day }, { replace: true })
  }

  function onGridKeyDown(event: KeyboardEvent) {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(selected, -1),
      ArrowRight: () => addDays(selected, 1),
      ArrowUp: () => addDays(selected, -7),
      ArrowDown: () => addDays(selected, 7),
      Home: () => startOfWeek(selected),
      End: () => addDays(startOfWeek(selected), 6),
      PageUp: () => addMonths(selected, -1),
      PageDown: () => addMonths(selected, 1),
    }
    const next = moves[event.key]
    if (!next) return
    event.preventDefault()
    choose(next(), true)
  }

  const chosen = itemsOn(byDay, selected)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('calendar.pageTitle')}</h1>
        <Button type="button" onClick={() => setDialog({ day: selected })}>
          <Icon name="plus" />
          {t('calendar.addButton')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => choose(addMonths(selected, -1))}
            aria-label={t('calendar.previousMonth')}
            className="grid h-10 w-10 place-items-center rounded-xl text-text hover:bg-primary-bg"
          >
            <Icon name="chevron-left" />
          </button>
          <h2 className="min-w-40 text-center text-lg font-semibold" aria-live="polite">
            {monthTitle}
          </h2>
          <button
            type="button"
            onClick={() => choose(addMonths(selected, 1))}
            aria-label={t('calendar.nextMonth')}
            className="grid h-10 w-10 place-items-center rounded-xl text-text hover:bg-primary-bg"
          >
            <Icon name="chevron-right" />
          </button>
          <Button
            type="button"
            variant="soft"
            className="ml-1"
            onClick={() => choose(now)}
            disabled={selected === now}
          >
            {t('calendar.today')}
          </Button>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={showTasks}
            onChange={(e) => {
              setShowTasks(e.target.checked)
              saveShowTasks(e.target.checked)
            }}
            className="h-4 w-4 accent-primary"
          />
          {t('calendar.showTasks')}
        </label>
      </div>

      {calendar.isPending ? (
        <LoadingState label={t('calendar.loading')} />
      ) : calendar.isError ? (
        <ErrorState
          message={errorMessage(t, calendar.error)}
          onRetry={() => void calendar.refetch()}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* The month: a grid that the arrow keys move through, one day at a time. */}
          <div
            ref={grid}
            role="grid"
            aria-label={monthTitle}
            onKeyDown={onGridKeyDown}
            className="overflow-hidden rounded-2xl border border-border bg-surface"
          >
            <div role="row" className="grid grid-cols-7 border-b border-border bg-surface-2">
              {text.weekdays.map((weekday) => (
                <div
                  key={weekday.long}
                  role="columnheader"
                  aria-label={weekday.long}
                  className="py-2 text-center text-xs font-medium text-muted"
                >
                  {weekday.short}
                </div>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, week) => {
              const days = cells.slice(week * 7, week * 7 + 7)
              const { bars, hidden } = weekBars(days, visible, LANES)
              return (
                <div key={week} role="row" className="relative grid grid-cols-7">
                  {days.map((day, index) => (
                    <DayCell
                      key={day}
                      day={day}
                      items={itemsOn(byDay, day)}
                      hidden={hidden[index] ?? 0}
                      inMonth={monthOf(day) === month}
                      isToday={day === now}
                      isChosen={day === selected}
                      label={text.fullDay(day)}
                      onChoose={() => choose(day)}
                    />
                  ))}
                  <WeekBars bars={bars} />
                </div>
              )
            })}
          </div>

          <DayPanel
            title={text.fullDay(selected)}
            items={chosen}
            onEdit={(event) => setDialog({ event, day: event.day })}
          />
        </div>
      )}

      {dialog && (
        <EventDialog event={dialog.event} day={dialog.day} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

function DayCell({
  day,
  items,
  inMonth,
  isToday,
  isChosen,
  label,
  onChoose,
  hidden,
}: {
  day: string
  items: DayItems
  /** Bars on this day that did not fit in the week's lines. */
  hidden: number
  inMonth: boolean
  isToday: boolean
  isChosen: boolean
  label: string
  onChoose: () => void
}) {
  const { t } = useTranslation()
  const counts = [
    items.events.length > 0 && t('calendar.countEvents', { count: items.events.length }),
    items.tasks.length > 0 && t('calendar.countTasks', { count: items.tasks.length }),
  ].filter(Boolean)
  return (
    <div
      role="gridcell"
      aria-selected={isChosen}
      className="min-w-0 border-b border-r border-border"
    >
      <button
        type="button"
        data-day={day}
        tabIndex={isChosen ? 0 : -1}
        onClick={onChoose}
        aria-label={[label, isToday && t('calendar.todayMark'), ...counts]
          .filter(Boolean)
          .join(', ')}
        className={`flex h-full min-h-14 w-full flex-col items-stretch gap-1 p-1 text-left -outline-offset-2 sm:min-h-24 sm:p-1.5 ${
          isChosen ? 'bg-primary-bg' : 'hover:bg-surface-2'
        }`}
      >
        <span
          aria-hidden="true"
          className={`grid h-7 w-7 place-items-center self-center rounded-full text-sm sm:self-start ${
            isToday
              ? 'bg-primary font-bold text-on-primary'
              : inMonth
                ? 'font-medium text-text'
                : 'text-muted'
          }`}
        >
          {Number(day.slice(8))}
        </span>
        {/* Phones: a dot for each kind of item. Wider: the week's bars, drawn over the cells. */}
        {items.events.length + items.tasks.length > 0 && (
          <span aria-hidden="true" className="flex justify-center gap-1 sm:hidden">
            {items.events.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            {items.tasks.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-muted" />}
          </span>
        )}
        {hidden > 0 && (
          <span
            aria-hidden="true"
            className="mt-auto hidden px-1 text-xs font-medium text-muted sm:block"
          >
            {t('calendar.more', { count: hidden })}
          </span>
        )}
      </button>
    </div>
  )
}

/**
 * The week's important days and tasks as bars across the days they cover, drawn over the day cells
 * (wider screens only). Only a picture: each day's button already says what is on it, so the bars are
 * hidden from screen readers and let clicks through to the days.
 */
function WeekBars({ bars }: { bars: Bar[] }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-9 hidden auto-rows-[20px] grid-cols-7 gap-y-0.5 sm:grid"
    >
      {bars.map((bar) => (
        <span
          key={bar.key}
          style={{ gridColumn: `${bar.column + 1} / span ${bar.length}`, gridRow: bar.lane + 1 }}
          className={`flex min-w-0 items-center gap-1 overflow-hidden px-1.5 text-xs leading-5 ${
            bar.kind === 'event'
              ? 'bg-primary-bg font-medium text-primary-fg'
              : 'border border-border bg-surface-2 text-text'
          } ${bar.startsHere ? 'ml-1 rounded-l-md' : ''} ${bar.endsHere ? 'mr-1 rounded-r-md' : ''}`}
        >
          {bar.kind === 'event' && (
            <span className="shrink-0">
              <Icon name="bookmark" size={12} />
            </span>
          )}
          <span className="min-w-0 truncate">{bar.title}</span>
        </span>
      ))}
    </div>
  )
}

/** Everything on the chosen day, in full. */
function DayPanel({
  title,
  items,
  onEdit,
}: {
  title: string
  items: DayItems
  onEdit: (event: CalendarEvent) => void
}) {
  const { t } = useTranslation()
  const markText = (mark: TaskMark) =>
    mark.kind === 'during'
      ? t('calendar.taskDuring', { day: mark.day, total: mark.total })
      : {
          start: t('calendar.taskStarts'),
          due: t('calendar.taskDue'),
          both: t('calendar.taskStartsAndDue'),
        }[mark.kind]
  const empty = items.events.length === 0 && items.tasks.length === 0
  return (
    <section aria-labelledby="day-title" className="space-y-3">
      <h2 id="day-title" className="text-lg font-semibold">
        {title}
      </h2>
      {empty && <p className="text-muted">{t('calendar.nothingThisDay')}</p>}
      {items.events.length > 0 && (
        <ul className="space-y-2" aria-label={t('calendar.eventsHeading')}>
          {items.events.map((event) => (
            <li
              key={event.id}
              className="rounded-xl border border-border bg-surface p-3 shadow-card"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-primary">
                  <Icon name="bookmark" size={18} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="break-words font-semibold">{event.title}</p>
                  <p className="text-sm text-muted">{belongsText(t, event)}</p>
                  {event.remindDays.length > 0 && (
                    <p className="flex items-center gap-1 text-sm text-muted">
                      <Icon name="bell" size={14} />
                      {event.remindDays.map((d) => t(`calendar.remind_${d}`)).join(', ')}
                    </p>
                  )}
                  {event.note && (
                    <p className="whitespace-pre-wrap break-words text-sm">{event.note}</p>
                  )}
                </div>
                {event.canEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(event)}
                    aria-label={t('calendar.editEvent', { title: event.title })}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-primary-bg hover:text-text"
                  >
                    <Icon name="pencil" size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.tasks.length > 0 && (
        <ul className="space-y-2" aria-label={t('calendar.tasksHeading')}>
          {items.tasks.map(({ task, mark }) => (
            <li key={task.id}>
              <Link
                to={`/projects/${encodeURIComponent(task.projectId)}`}
                className="block rounded-xl border border-border bg-surface p-3 hover:border-primary"
              >
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <Icon name={markIcon(mark)} size={14} />
                  {markText(mark)} · {task.projectName}
                </p>
                <p className="mt-1 break-words font-medium">{task.title}</p>
                <div className="mt-2">
                  <StatusBadge status={task.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
