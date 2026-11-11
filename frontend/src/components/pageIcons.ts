import type { IconName } from './Icon'

/**
 * Each kind of page has its own picture and color: beside its heading, and on its way in from the top bar.
 * Only the pastel pairs the theme already has; each pair is checked for contrast in theme/palette.test.ts.
 */
export const PAGE_ICONS = {
  projects: { icon: 'grid', badge: 'bg-primary-bg text-primary-fg', ink: 'text-primary-fg' },
  board: { icon: 'columns', badge: 'bg-mint-bg text-mint-fg', ink: 'text-mint-fg' },
  calendar: { icon: 'calendar', badge: 'bg-sky-bg text-sky-fg', ink: 'text-sky-fg' },
  trash: { icon: 'trash', badge: 'bg-pink-bg text-pink-fg', ink: 'text-pink-fg' },
  notifications: { icon: 'bell', badge: 'bg-peach-bg text-peach-fg', ink: 'text-peach-fg' },
} satisfies Record<string, { icon: IconName; badge: string; ink: string }>

export type PageKind = keyof typeof PAGE_ICONS
