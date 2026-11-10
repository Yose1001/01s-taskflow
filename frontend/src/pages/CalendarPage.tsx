import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import type { CalendarEvent } from '../api/types'
import { errorMessage } from '../auth/errors'
import { Button } from '../components/forms'
import { Icon } from '../components/Icon'
import { ErrorState, LoadingState } from '../components/states'
import { StatusBadge } from '../components/StatusBadge'
import { EventDialog } from '../features/calendar/EventDialog'
import {
  itemsByDay,
  itemsOn,
  parseDay,
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
/** How many items a day shows inside the month on wider screens; the rest are counted. */
const ITEMS_IN_CELL = 2

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

const MARK_ICON = { start: 'calendar', due: 'flag', both: 'flag' } as const

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

  const byDay = useMemo(
    () =>
      itemsByDay(
        calendar.data && (showTasks ? calendar.data : { events: calendar.data.events, tasks: [] }),
      ),
    [calendar.data, showTasks],
  )

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
            {Array.from({ length: 6 }, (_, week) => (
              <div key={week} role="row" className="grid grid-cols-7">
                {cells.slice(week * 7, week * 7 + 7).map((day) => (
                  <DayCell
                    key={day}
                    day={day}
                    items={itemsOn(byDay, day)}
                    inMonth={monthOf(day) === month}
                    isToday={day === now}
                    isChosen={day === selected}
                    label={text.fullDay(day)}
                    onChoose={() => choose(day)}
                  />
                ))}
              </div>
            ))}
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
}: {
  day: string
  items: DayItems
  inMonth: boolean
  isToday: boolean
  isChosen: boolean
  label: string
  onChoose: () => void
}) {
  const { t } = useTranslation()
  const entries = [
    ...items.events.map((event) => ({
      key: event.id,
      icon: 'bookmark' as const,
      text: event.title,
      important: true,
    })),
    ...items.tasks.map(({ task, mark }) => ({
      key: `${task.id}-${mark}`,
      icon: MARK_ICON[mark],
      text: task.title,
      important: false,
    })),
  ]
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
        {/* Phones: a dot for each kind of item. Wider: the first items, then how many more. */}
        {entries.length > 0 && (
          <span aria-hidden="true" className="flex justify-center gap-1 sm:hidden">
            {items.events.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            {items.tasks.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-muted" />}
          </span>
        )}
        <span aria-hidden="true" className="hidden min-w-0 flex-col gap-0.5 sm:flex">
          {entries.slice(0, ITEMS_IN_CELL).map((entry) => (
            <span
              key={entry.key}
              className={`flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-xs ${
                entry.important ? 'bg-primary-bg font-medium text-primary-fg' : 'text-muted'
              }`}
            >
              <span className="shrink-0">
                <Icon name={entry.icon} size={12} />
              </span>
              <span className="min-w-0 truncate">{entry.text}</span>
            </span>
          ))}
          {entries.length > ITEMS_IN_CELL && (
            <span className="px-1 text-xs font-medium text-muted">
              {t('calendar.more', { count: entries.length - ITEMS_IN_CELL })}
            </span>
          )}
        </span>
      </button>
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
  const markText: Record<TaskMark, string> = {
    start: t('calendar.taskStarts'),
    due: t('calendar.taskDue'),
    both: t('calendar.taskStartsAndDue'),
  }
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
                  <p className="text-sm text-muted">
                    {event.projectName ?? t('calendar.personal')}
                  </p>
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
            <li key={`${task.id}-${mark}`}>
              <Link
                to={`/projects/${encodeURIComponent(task.projectId)}`}
                className="block rounded-xl border border-border bg-surface p-3 hover:border-primary"
              >
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <Icon name={MARK_ICON[mark]} size={14} />
                  {markText[mark]} · {task.projectName}
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
