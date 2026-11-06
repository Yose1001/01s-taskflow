import { useTranslation } from 'react-i18next'

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

// Status is never shown by color alone: every badge also has an icon shape and a text label.
const STATUS_STYLE: Record<TaskStatus, { icon: string; classes: string }> = {
  todo: { icon: '○', classes: 'bg-primary-bg text-primary-fg' },
  in_progress: { icon: '◐', classes: 'bg-sky-bg text-sky-fg' },
  review: { icon: '◎', classes: 'bg-peach-bg text-peach-fg' },
  done: { icon: '✓', classes: 'bg-mint-bg text-mint-fg' },
}

const PRIORITY_STYLE: Record<TaskPriority, { icon: string; classes: string }> = {
  low: { icon: '▽', classes: 'bg-mint-bg text-mint-fg' },
  medium: { icon: '◇', classes: 'bg-lemon-bg text-lemon-fg' },
  high: { icon: '△', classes: 'bg-pink-bg text-pink-fg' },
}

const BASE = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium'

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation()
  const style = STATUS_STYLE[status]
  return (
    <span className={`${BASE} ${style.classes}`}>
      <span aria-hidden="true">{style.icon}</span>
      {t(`status.${status}`)}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useTranslation()
  const style = PRIORITY_STYLE[priority]
  return (
    <span className={`${BASE} ${style.classes}`}>
      <span aria-hidden="true">{style.icon}</span>
      {t(`priority.${priority}`)}
    </span>
  )
}
