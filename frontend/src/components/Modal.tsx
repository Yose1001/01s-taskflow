import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// A dialog can open on top of another one (a confirmation over the members panel), so the page stays
// inert until the last of them has closed.
let openDialogs = 0

const LAYOUT = {
  dialog: {
    backdrop: 'grid place-items-center bg-black/50 p-4',
    panel: 'max-h-[90vh] w-full max-w-lg rounded-2xl border border-border p-6',
  },
  // Phones: a sheet from the bottom. Wider: a panel from the right, with the page still in view.
  drawer: {
    backdrop: 'flex items-end bg-black/30 sm:items-stretch sm:justify-end',
    panel:
      'drawer-panel max-h-[85vh] w-full rounded-t-2xl border-t border-border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-h-none sm:w-[380px] sm:rounded-l-2xl sm:rounded-tr-none sm:border-l sm:border-t-0',
  },
}

/**
 * An accessible dialog:
 * - announced as a dialog with a title (role, aria-modal, aria-labelledby)
 * - focus moves inside when it opens, is kept inside (Tab cycles), and returns to the opener when it closes
 * - Escape or a click on the dark background closes it
 * - the page behind is made inert while it is open
 */
export function Modal({
  title,
  icon,
  variant = 'dialog',
  closeLabel,
  onClose,
  children,
}: {
  title: string
  /** Shown beside the title, for dialogs that warn about something. */
  icon?: ReactNode
  variant?: keyof typeof LAYOUT
  /** Adds a close button to the title row, with this as its accessible name. */
  closeLabel?: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    openDialogs++
    root?.setAttribute('inert', '')
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()
    return () => {
      openDialogs--
      if (openDialogs === 0) root?.removeAttribute('inert')
      opener?.focus?.()
    }
  }, [])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]!
    const last = items[items.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const layout = LAYOUT[variant]
  return createPortal(
    <div
      className={`fixed inset-0 z-50 ${layout.backdrop}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose() // only a click on the background itself, not inside the panel
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`overflow-auto bg-surface text-text shadow-xl ${layout.panel}`}
      >
        {variant === 'drawer' && (
          <span
            aria-hidden="true"
            className="mx-auto mb-3 block h-1 w-10 rounded-full bg-border sm:hidden"
          />
        )}
        <div className="mb-4 flex items-start gap-3">
          {icon}
          <h2 id={titleId} className="min-w-0 flex-1 break-words text-xl font-bold">
            {title}
          </h2>
          {closeLabel && (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-primary-bg hover:text-text"
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
