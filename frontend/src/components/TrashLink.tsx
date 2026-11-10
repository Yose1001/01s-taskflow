import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/** The way to a trash page, the same for projects and for tasks. */
export function TrashLink({
  to,
  label,
  iconOnlyOnPhone = false,
  ghostOnPhone = false,
  fullLabel,
}: {
  to: string
  label: string
  /** For a crowded row: on phones only the icon shows, and the label stays for screen readers. */
  iconOnlyOnPhone?: boolean
  /** On phones: no frame, so the row's one primary button stands out. */
  ghostOnPhone?: boolean
  /** What screen readers hear instead of the short label, such as "Task trash". */
  fullLabel?: string | undefined
}) {
  return (
    <Link
      to={to}
      aria-label={fullLabel}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 font-medium text-text hover:bg-primary-bg ${
        iconOnlyOnPhone ? 'max-sm:w-10 max-sm:px-0' : ''
      } ${ghostOnPhone ? 'max-sm:border-transparent max-sm:bg-transparent max-sm:px-2' : ''}`}
    >
      <Icon name="trash" />
      <span className={iconOnlyOnPhone ? 'max-sm:sr-only' : undefined}>{label}</span>
    </Link>
  )
}
