import type { ReactNode } from 'react'

/* Every icon is drawn on a 24 x 24 grid in the current text color. */
const PATHS = {
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-1a7 7 0 0 1 14 0v1" />
      <path d="M16 4.3a4 4 0 0 1 0 7.4" />
      <path d="M19 15a7 7 0 0 1 3 5v1" />
    </>
  ),
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

/**
 * A decorative icon: hidden from screen readers, so the text beside it (or an aria-label on its button)
 * must carry the meaning.
 */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {PATHS[name]}
    </svg>
  )
}
