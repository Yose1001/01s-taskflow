import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/** The way back to the page above, the same on every page. Tall enough for a thumb on phones. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted hover:bg-primary-bg hover:text-text sm:h-9"
    >
      <Icon name="arrow-left" />
      {children}
    </Link>
  )
}
