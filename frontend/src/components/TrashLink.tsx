import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/** The way to a trash page, the same for projects and for tasks. */
export function TrashLink({
  to,
  label,
  iconOnlyOnPhone = false,
}: {
  to: string
  label: string
  /** For a crowded row: on phones only the icon shows, and the label stays for screen readers. */
  iconOnlyOnPhone?: boolean
}) {
  return (
    <Link
      to={to}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 font-medium text-text hover:bg-primary-bg ${
        iconOnlyOnPhone ? 'max-sm:w-10 max-sm:px-0' : ''
      }`}
    >
      <Icon name="trash" />
      <span className={iconOnlyOnPhone ? 'max-sm:sr-only' : undefined}>{label}</span>
    </Link>
  )
}
