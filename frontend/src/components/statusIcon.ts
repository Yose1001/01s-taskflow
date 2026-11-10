import type { TaskStatus } from '../api/types'
import type { IconName } from './Icon'

/** The icon that stands for each status. Status is never shown by color alone: an icon and a word go with it. */
const STATUS_ICON: Record<TaskStatus, IconName> = {
  todo: 'circle',
  in_progress: 'half-circle',
  review: 'eye',
  on_hold: 'pause',
  done: 'check-circle',
}

export const statusIcon = (status: TaskStatus): IconName => STATUS_ICON[status]
