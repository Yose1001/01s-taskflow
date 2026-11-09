import { useTranslation } from 'react-i18next'
import type { Role } from '../api/types'
import { Icon, type IconName } from './Icon'

// Like the status badges: an icon shape AND a text label, never color alone.
const STYLE: Record<Role, { icon: IconName; classes: string }> = {
  owner: { icon: 'star', classes: 'bg-pink-bg text-pink-fg' },
  member: { icon: 'users', classes: 'bg-sky-bg text-sky-fg' },
}

export function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation()
  const style = STYLE[role]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${style.classes}`}
    >
      <Icon name={style.icon} size={14} />
      {t(`projects.role_${role}`)}
    </span>
  )
}
