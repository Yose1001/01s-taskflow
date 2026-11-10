import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Task } from '../../api/types'
import { Avatar, EmptyAvatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { PriorityBadge } from '../../components/StatusBadge'
import { formatDay, formatDayRange, formatDayShort } from '../../lib/format'
import { isOverdue, type Assignee } from './boardLogic'
import { SubtaskProgress } from './SubtaskList'

interface ViewProps {
  task: Task
  /** The people on this task whose names are known. */
  assignees?: Assignee[]
  onOpen?: () => void
  /** Props for the drag handle (from dnd-kit). Absent on the floating copy shown while dragging. */
  handle?: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    ref?: (node: HTMLElement | null) => void
    /** Lets the board give the focus back to this card after it has moved. */
    'data-task-handle'?: string
  }
  /** Start a drag with a mouse, pen or finger, from anywhere on the card. */
  dragListeners?: {
    onPointerDown?: React.PointerEventHandler<HTMLDivElement>
    onTouchStart?: React.TouchEventHandler<HTMLDivElement>
  }
  /** This card has been picked up. */
  picked?: boolean
  /** This is the floating copy that follows the pointer. */
  lifted?: boolean
  /** The column is sorted automatically, so moving a card inside it changes nothing. */
  inSortedColumn?: boolean
}

function DatesChip({ task }: { task: Task }) {
  const { t, i18n } = useTranslation()
  const { startDate, dueDate } = task
  if (!startDate && !dueDate) return null
  const overdue = isOverdue(task)
  const language = i18n.language
  const day = (iso: string, text: string, kind: 'starts' | 'due') => (
    <time dateTime={iso} title={t(`tasks.${kind}`, { date: formatDay(iso, language) })}>
      {text}
    </time>
  )
  let dates: ReactNode
  if (startDate && startDate === dueDate) {
    // Starts and ends on the same day: one date, not "8–8 Nov".
    dates = (
      <span>
        <span className="sr-only">
          {t('tasks.startWord')}, {t('tasks.dueWord')}{' '}
        </span>
        {day(dueDate, formatDayShort(dueDate, language), 'due')}
      </span>
    )
  } else if (startDate && dueDate) {
    // "9–10 Nov". The words are there for screen readers, which read "Starts 9, Ends 10 Nov".
    const range = formatDayRange(startDate, dueDate, language)
    dates = (
      <span>
        <span className="sr-only">{t('tasks.startWord')} </span>
        {day(startDate, range.start, 'starts')}
        <span aria-hidden="true">{range.joiner}</span>
        <span className="sr-only">, {t('tasks.dueWord')} </span>
        {day(dueDate, range.end, 'due')}
      </span>
    )
  } else if (startDate) {
    // With only a start date the word must show: a lone date would read as the end.
    dates = (
      <span>
        {t('tasks.startWord')} {day(startDate, formatDayShort(startDate, language), 'starts')}
      </span>
    )
  } else if (dueDate) {
    dates = (
      <span>
        {t('tasks.dueBy')} {day(dueDate, formatDayShort(dueDate, language), 'due')}
      </span>
    )
  }
  return (
    <span
      // On a narrow card it wraps between whole pieces, never in the middle of a word or a date.
      className={`inline-flex flex-wrap items-center gap-x-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium ${
        overdue ? 'bg-danger-bg text-danger-fg' : 'bg-surface-2 text-muted'
      }`}
    >
      <Icon name={overdue ? 'warning' : startDate ? 'calendar' : 'flag'} size={14} />
      {overdue && <span>{t('tasks.overdue')}</span>}
      {dates}
    </span>
  )
}

// How many faces fit beside a name on a narrow card. The "+N" and the title still count everyone.
const MAX_FACES = 3

function AssigneeRow({ task, people }: { task: Task; people: Assignee[] }) {
  const { t } = useTranslation()
  const row = 'flex min-h-[22px] items-center justify-between gap-2 text-sm text-muted'
  const [first, ...others] = people
  const everyone = people.map((person) => person.name).join(', ')
  // "Nok, Tester" when it fits on the line, otherwise "Nok +1". An unseen copy of the whole list is
  // measured against the room there is, again whenever the card changes width.
  const box = useRef<HTMLSpanElement>(null)
  const whole = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const outer = box.current
    const inner = whole.current
    if (!outer || !inner) return
    const check = () => setFits(inner.offsetWidth <= outer.clientWidth)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(outer)
    return () => observer.disconnect()
  }, [everyone])
  if (!first) {
    // Somebody is assigned but the member list has not arrived yet: say nothing rather than "nobody".
    if (task.assigneeIds.length > 0) return <div className="h-[22px]" />
    return (
      <div className={row}>
        <span className="min-w-0 truncate">{t('tasks.unassigned')}</span>
        <EmptyAvatar label={t('tasks.unassigned')} size={22} />
      </div>
    )
  }
  const short = !fits && others.length > 0
  return (
    <div className={row}>
      <span
        ref={box}
        className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
        title={t('tasks.assignedTo', { name: everyone })}
      >
        {/* The text comes from CSS, so it is never read out or found twice on the page. */}
        <span
          ref={whole}
          aria-hidden="true"
          data-text={everyone}
          className="invisible absolute whitespace-nowrap before:content-[attr(data-text)]"
        />
        {/* Screen readers always hear every name; the shortening is only for the eye. */}
        <span className="sr-only">
          {t('tasks.assignedWord')} {everyone}
        </span>
        <span aria-hidden="true" className="min-w-0 truncate">
          {short ? first.name : everyone}
        </span>
        {short && (
          <span aria-hidden="true" className="shrink-0 font-medium">
            +{others.length}
          </span>
        )}
      </span>
      <span className="flex shrink-0 -space-x-1.5">
        {people.slice(0, MAX_FACES).map((person) => (
          <span key={person.id} className="rounded-full ring-2 ring-surface">
            <Avatar id={person.id} name={person.name} size={22} />
          </span>
        ))}
      </span>
    </div>
  )
}

/** What a task looks like on the board. Plain text only: titles are never treated as HTML. */
export function TaskCardView({
  task,
  assignees = [],
  onOpen,
  handle,
  dragListeners,
  picked,
  lifted,
  inSortedColumn,
}: ViewProps) {
  const { t } = useTranslation()
  return (
    // A click anywhere on the card opens it. A mouse or pen press that moves drags it, and so does a long
    // press with a finger; a finger that moves straight away still scrolls the board (see the sensors in
    // TaskBoard). Keyboard and screen-reader users reach the same two things through the title button and
    // the handle below. dnd-kit swallows the click that ends a drag.
    <div
      onClick={onOpen}
      {...dragListeners}
      className={`group grid touch-manipulation select-none grid-cols-[28px_minmax(0,1fr)] rounded-xl border bg-surface [-webkit-touch-callout:none] ${
        lifted
          ? 'cursor-grabbing border-primary shadow-xl'
          : 'cursor-pointer border-border shadow-card hover:border-primary active:cursor-grabbing'
      }`}
    >
      {/* The way to pick the card up with the keyboard. It also shows that the card can be moved, and a finger
          here drags without ever scrolling the board. */}
      <button
        type="button"
        {...handle}
        // Space and Enter on the handle pick the card up. If they also produce a click, it must not open the card.
        onClick={(event) => {
          if (event.detail === 0) event.stopPropagation()
        }}
        aria-label={t('tasks.dragHandle', { title: task.title })}
        title={inSortedColumn ? t('tasks.sortedHandle') : undefined}
        className={`grid min-h-11 cursor-grab touch-none place-items-center rounded-l-xl -outline-offset-2 active:cursor-grabbing ${
          picked
            ? 'bg-primary-bg text-primary-fg'
            : 'text-handle hover:text-muted focus-visible:text-muted'
        } ${inSortedColumn && !picked ? 'opacity-50' : ''}`}
      >
        <Icon name="grip" />
      </button>
      <div className="min-w-0 space-y-2 py-3 pl-1 pr-3">
        <button
          type="button"
          title={task.title}
          className="line-clamp-3 w-full cursor-[inherit] break-words text-left font-medium leading-[1.45] group-hover:underline"
        >
          {task.title}
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={task.priority} />
          <DatesChip task={task} />
          {task.subtasks.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-sm font-medium text-muted">
              <Icon
                name={task.subtasks.every((subtask) => subtask.done) ? 'check-circle' : 'checklist'}
                size={14}
              />
              <SubtaskProgress subtasks={task.subtasks} />
            </span>
          )}
        </div>
        {task.holdReason && (
          <p
            title={task.holdReason}
            className="flex min-w-0 items-center gap-1.5 text-sm text-muted"
          >
            <span className="shrink-0">
              <Icon name="pause" size={14} />
            </span>
            <span className="min-w-0 truncate">
              <span className="sr-only">{t('tasks.holdWord')}: </span>
              {task.holdReason}
            </span>
          </p>
        )}
        <AssigneeRow task={task} people={assignees} />
      </div>
    </div>
  )
}

/** A card that can be dragged: anywhere with a mouse, pen or finger, by its handle with the keyboard. */
export function SortableTaskCard({
  task,
  assignees,
  onOpen,
  inSortedColumn = false,
}: {
  task: Task
  assignees: Assignee[]
  onOpen: () => void
  inSortedColumn?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })
  // These go on the whole card; a press on the handle reaches them by bubbling. Only keys stay on the handle.
  const { onPointerDown, onTouchStart, ...handleListeners } = listeners ?? {}
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : undefined}
    >
      <TaskCardView
        task={task}
        assignees={assignees}
        onOpen={onOpen}
        handle={{
          ...attributes,
          ...handleListeners,
          ref: setActivatorNodeRef,
          'data-task-handle': task.id,
        }}
        dragListeners={{ onPointerDown, onTouchStart } as ViewProps['dragListeners']}
        picked={isDragging}
        inSortedColumn={inSortedColumn}
      />
    </li>
  )
}
