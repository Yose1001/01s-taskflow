import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export interface MenuItem {
  key: string
  label: string
  icon?: IconName
  /** Starts a new group: a thin line above the item. */
  separated?: boolean
  /** Starts a new group of items, with this small heading above it. Give the items an ariaLabel too. */
  heading?: string
  /** Shown before the text instead of an icon, such as a person's avatar. Decorative. */
  leading?: ReactNode
  /** danger: red text, set apart from the items above it. danger-soft: on a soft red background. */
  tone?: 'danger' | 'danger-soft'
  /** The accessible name when the visible label alone is not enough, such as "Remove: Bob". */
  ariaLabel?: string
  /**
   * Makes this one of a set of choices: true shows a tick and tells screen readers it is chosen. In a
   * `multiple` menu each item is ticked on its own, and the menu stays open.
   */
  checked?: boolean
  onSelect: () => void
}

type FloatingBox = { right: number; top?: number; bottom?: number }

// How much room the menu wants below its button before it opens upwards instead.
const ROOM_BELOW = 280
// The menu's width (w-64) and the gap it keeps from the edge of the window.
const MENU_WIDTH = 256
const EDGE = 8

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
  floating = false,
  multiple = false,
  className = '',
}: {
  /** The button's accessible name. */
  label: string
  trigger: ReactNode
  triggerClassName: string
  items: MenuItem[]
  /** Shown above the items, not selectable. */
  header?: ReactNode
  /**
   * For a menu inside something that scrolls: it is placed against the window, so it is never cut off.
   * It closes when anything scrolls, because it would no longer sit next to its button.
   */
  floating?: boolean
  /** Several items can be ticked: choosing one leaves the menu open, for the next. */
  multiple?: boolean
  /** For the box around the button, such as its width. */
  className?: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [box, setBox] = useState<FloatingBox | null>(null)
  const menuId = useId()
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // The focused item follows the active one while the menu is open.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus({ preventScroll: true })
  }, [open, active])

  useEffect(() => {
    if (!open || !floating) return
    const dismiss = () => setOpen(false)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [open, floating])

  function openMenu() {
    if (floating && button.current) {
      const rect = button.current.getBoundingClientRect()
      const gap = 4
      // Lined up with the button's right side, unless that would push the menu off the left of the window.
      const right = Math.max(
        EDGE,
        Math.min(window.innerWidth - rect.right, window.innerWidth - MENU_WIDTH - EDGE),
      )
      setBox(
        window.innerHeight - rect.bottom < ROOM_BELOW
          ? { right, bottom: window.innerHeight - rect.top + gap }
          : { right, top: rect.bottom + gap },
      )
    }
    // Start on the chosen item when there is one, otherwise on the first.
    setActive(
      Math.max(
        0,
        items.findIndex((item) => item.checked),
      ),
    )
    setOpen(true)
  }

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
    <div ref={wrapper} className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          style={floating && box ? box : undefined}
          className={`w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-2 shadow-xl ${
            floating ? 'fixed z-40' : 'absolute right-0 top-full z-30 mt-1'
          }`}
        >
          {header && <div className="mb-1 border-b border-border px-3 pb-3 pt-2">{header}</div>}
          <div id={menuId} role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
            {items.map((item, index) => (
              <div
                key={item.key}
                role="none"
                className={
                  (item.tone === 'danger' || item.heading || item.separated) && index > 0
                    ? 'mt-1 border-t border-border pt-1'
                    : undefined
                }
              >
                {item.heading && (
                  <p aria-hidden="true" className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted">
                    {item.heading}
                  </p>
                )}
                <button
                  ref={(node) => {
                    itemRefs.current[index] = node
                  }}
                  type="button"
                  role={
                    item.checked === undefined
                      ? 'menuitem'
                      : multiple
                        ? 'menuitemcheckbox'
                        : 'menuitemradio'
                  }
                  aria-checked={item.checked}
                  tabIndex={index === active ? 0 : -1}
                  aria-label={item.ariaLabel}
                  onClick={() => {
                    if (multiple) setActive(index)
                    else close()
                    item.onSelect()
                  }}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-medium ${
                    MENU_TONES[item.tone ?? 'plain']
                  }`}
                >
                  {item.icon && <Icon name={item.icon} />}
                  {item.leading}
                  <span className="min-w-0 flex-1 break-words">{item.label}</span>
                  {item.checked && <Icon name="check" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
