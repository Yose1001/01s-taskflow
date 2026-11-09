import { ICON_PATHS, type IconName } from './iconPaths'

export type { IconName }

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
      {ICON_PATHS[name]}
    </svg>
  )
}
