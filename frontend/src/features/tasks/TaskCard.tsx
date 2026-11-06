import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import type { Task } from '../../api/types'
import { PriorityBadge } from '../../components/StatusBadge'
import { formatDay } from '../../lib/format'
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
}

/** What a task looks like on the board. Plain text only: titles are never treated as HTML. */
export function TaskCardView({ task, assigneeName, onOpen, handle }: ViewProps) {
  const { t, i18n } = useTranslation()
  const overdue = isOverdue(task)
  return (
    <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...handle}
          aria-label={t('tasks.dragHandle', { title: task.title })}
          className="mt-0.5 cursor-grab touch-none rounded-lg px-1.5 py-0.5 text-muted hover:bg-primary-bg active:cursor-grabbing"
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 break-words text-left font-semibold hover:underline"
        >
          {task.title}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PriorityBadge priority={task.priority} />
        {task.dueDate && (
          <span className={`text-sm ${overdue ? 'font-semibold text-danger-fg' : 'text-muted'}`}>
            {overdue && <span aria-hidden="true">⚠ </span>}
            {overdue && `${t('tasks.overdue')} · `}
            {t('tasks.due', { date: formatDay(task.dueDate, i18n.language) })}
          </span>
        )}
      </div>
      {assigneeName && (
        <p className="mt-2 break-words text-sm text-muted">
          <span aria-hidden="true">● </span>
          {t('tasks.assignedTo', { name: assigneeName })}
        </p>
      )}
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
      />
    </li>
  )
}
