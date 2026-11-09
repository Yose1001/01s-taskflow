import { useTranslation } from 'react-i18next'
import type { TaskPriority, TaskStatus } from '../api/types'
import { Icon, type IconName } from './Icon'

export type { TaskPriority, TaskStatus }

// Status is never shown by color alone: every badge also has an icon shape and a text label.
const STATUS_STYLE: Record<TaskStatus, { icon: IconName; classes: string }> = {
  todo: { icon: 'circle', classes: 'bg-primary-bg text-primary-fg' },
  in_progress: { icon: 'half-circle', classes: 'bg-sky-bg text-sky-fg' },
  review: { icon: 'eye', classes: 'bg-peach-bg text-peach-fg' },
  on_hold: { icon: 'pause', classes: 'bg-lemon-bg text-lemon-fg' },
  done: { icon: 'check-circle', classes: 'bg-mint-bg text-mint-fg' },
}

const PRIORITY_STYLE: Record<TaskPriority, { icon: IconName; classes: string }> = {
  low: { icon: 'arrow-down', classes: 'bg-mint-bg text-mint-fg' },
  medium: { icon: 'equal', classes: 'bg-lemon-bg text-lemon-fg' },
  high: { icon: 'arrow-up', classes: 'bg-pink-bg text-pink-fg' },
}

const BASE = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium'

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation()
  const style = STATUS_STYLE[status]
  return (
    <span className={`${BASE} ${style.classes}`}>
      <Icon name={style.icon} size={14} />
      {t(`status.${status}`)}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useTranslation()
  const style = PRIORITY_STYLE[priority]
  return (
    <span className={`${BASE} ${style.classes}`}>
      <Icon name={style.icon} size={14} />
      {t(`priority.${priority}`)}
    </span>
  )
}
