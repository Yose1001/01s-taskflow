import { Icon } from './Icon'
import { PAGE_ICONS, type PageKind } from './pageIcons'

/** The small colored picture beside a page's heading. Decorative: the heading itself says what the page is. */
export function PageIcon({ page, size = 'md' }: { page: PageKind; size?: 'sm' | 'md' }) {
  const { icon, badge } = PAGE_ICONS[page]
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-xl ${
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9 sm:h-10 sm:w-10'
      } ${badge}`}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 20} />
    </span>
  )
}
