import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import type { Task } from '../../api/types'
import { Avatar, EmptyAvatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { PriorityBadge } from '../../components/StatusBadge'
import { formatDay, formatDayShort } from '../../lib/format'
import { isOverdue } from './boardLogic'

interface ViewProps {
  task: Task
  /** Display name of the assignee, when there is one. */
  assigneeName?: string | undefined
  onOpen?: () => void
  /** Props for the drag handle (from dnd-kit). Absent on the floating copy shown while dragging. */
  handle?: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    ref?: (node: HTMLElement | null) => void
  }
  /** This card has been picked up. */
  picked?: boolean
  /** This is the floating copy that follows the pointer. */
  lifted?: boolean
}

function DueChip({ task }: { task: Task }) {
  const { t, i18n } = useTranslation()
  if (!task.dueDate) return null
  const overdue = isOverdue(task)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
        overdue ? 'bg-danger-bg text-danger-fg' : 'bg-surface-2 text-muted'
      }`}
    >
      <Icon name={overdue ? 'warning' : 'calendar'} size={14} />
      {overdue ? (
        <span>{t('tasks.overdue')}</span>
      ) : (
        <span className="sr-only">{t('tasks.dueWord')}</span>
      )}
      <time
        dateTime={task.dueDate}
        title={t('tasks.due', { date: formatDay(task.dueDate, i18n.language) })}
      >
        {formatDayShort(task.dueDate, i18n.language)}
      </time>
    </span>
  )
}

function AssigneeRow({ task, name }: { task: Task; name?: string | undefined }) {
  const { t } = useTranslation()
  // Somebody is assigned but the member list has not arrived yet: say nothing rather than "nobody".
  if (task.assigneeId && !name) return <div className="h-[22px]" />
  return (
    <div className="flex min-h-[22px] items-center justify-between gap-2 text-sm text-muted">
      {task.assigneeId && name ? (
        <>
          <span className="min-w-0 truncate" title={t('tasks.assignedTo', { name })}>
            <span className="sr-only">{t('tasks.assignedWord')} </span>
            <span>{name}</span>
          </span>
          <Avatar id={task.assigneeId} name={name} size={22} />
        </>
      ) : (
        <>
          <span className="min-w-0 truncate">{t('tasks.unassigned')}</span>
          <EmptyAvatar label={t('tasks.unassigned')} size={22} />
        </>
      )}
    </div>
  )
}

/** What a task looks like on the board. Plain text only: titles are never treated as HTML. */
export function TaskCardView({ task, assigneeName, onOpen, handle, picked, lifted }: ViewProps) {
  const { t } = useTranslation()
  return (
    <div
      className={`grid grid-cols-[28px_minmax(0,1fr)] rounded-xl border bg-surface ${
        lifted
          ? '-rotate-[1.5deg] border-primary shadow-xl motion-reduce:rotate-0'
          : 'border-border shadow-card'
      }`}
    >
      {/* The whole left edge is the handle: easy to find with a mouse and big enough for a thumb. */}
      <button
        type="button"
        {...handle}
        aria-label={t('tasks.dragHandle', { title: task.title })}
        className={`grid min-h-11 cursor-grab touch-none place-items-center rounded-l-xl -outline-offset-2 active:cursor-grabbing ${
          picked
            ? 'bg-primary-bg text-primary-fg'
            : 'text-handle hover:text-muted focus-visible:text-muted'
        }`}
      >
        <Icon name="grip" />
      </button>
      <div className="min-w-0 space-y-2 py-3 pl-1 pr-3">
        <button
          type="button"
          onClick={onOpen}
          title={task.title}
          className="line-clamp-3 w-full break-words text-left font-medium leading-[1.45] hover:underline"
        >
          {task.title}
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={task.priority} />
          <DueChip task={task} />
        </div>
        <AssigneeRow task={task} name={assigneeName} />
      </div>
    </div>
  )
}

/** A card that can be dragged (by its handle, with the mouse, a finger or the keyboard). */
export function SortableTaskCard({
  task,
  assigneeName,
  onOpen,
}: {
  task: Task
  assigneeName?: string | undefined
  onOpen: () => void
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
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-40' : undefined}
    >
      <TaskCardView
        task={task}
        assigneeName={assigneeName}
        onOpen={onOpen}
        handle={{ ...attributes, ...listeners, ref: setActivatorNodeRef }}
        picked={isDragging}
      />
    </li>
  )
}
