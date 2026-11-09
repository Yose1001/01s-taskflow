import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export interface MenuItem {
  key: string
  label: string
  icon?: IconName
  /** danger: red text, set apart from the items above it. danger-soft: on a soft red background. */
  tone?: 'danger' | 'danger-soft'
  /** The accessible name when the visible label alone is not enough, such as "Remove: Bob". */
  ariaLabel?: string
  onSelect: () => void
}

const MENU_TONES = {
  plain: 'text-text hover:bg-primary-bg',
  danger: 'text-danger hover:bg-danger-bg hover:text-danger-fg',
  'danger-soft': 'bg-danger-bg text-danger-fg hover:opacity-90',
}

/**
 * A dropdown menu, following the WAI-ARIA menu pattern: arrow keys, Home and End move between the items
 * (roving tabindex), Escape closes it and focus goes back to the button. Tab or a click outside also closes it.
 */
export function Menu({
  label,
  trigger,
  triggerClassName,
  items,
  header,
}: {
  /** The button's accessible name. */
  label: string
  trigger: ReactNode
  triggerClassName: string
  items: MenuItem[]
  /** Shown above the items, not selectable. */
  header?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const menuId = useId()
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // The focused item follows the active one while the menu is open.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus()
  }, [open, active])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  function close() {
    setOpen(false)
    button.current?.focus()
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    const last = items.length - 1
    const moves: Record<string, number> = {
      ArrowDown: active === last ? 0 : active + 1,
      ArrowUp: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    }
    const next = moves[event.key]
    if (next !== undefined) {
      event.preventDefault()
      setActive(next)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation() // inside a dialog, Escape closes only this menu
      close()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setActive(0)
          setOpen((v) => !v)
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-2 shadow-xl">
          {header && <div className="border-b border-border px-3 pb-2 pt-1">{header}</div>}
          <div id={menuId} role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
            {items.map((item, index) => (
              <div
                key={item.key}
                role="none"
                className={
                  item.tone === 'danger' && index > 0
                    ? 'mt-1 border-t border-border pt-1'
                    : undefined
                }
              >
                <button
                  ref={(node) => {
                    itemRefs.current[index] = node
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={index === active ? 0 : -1}
                  aria-label={item.ariaLabel}
                  onClick={() => {
                    close()
                    item.onSelect()
                  }}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-medium ${
                    MENU_TONES[item.tone ?? 'plain']
                  }`}
                >
                  {item.icon && <Icon name={item.icon} />}
                  {item.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
