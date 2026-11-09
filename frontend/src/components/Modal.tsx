import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  onClose,
  children,
}: {
  title: string
  /** Shown beside the title, for dialogs that warn about something. */
  icon?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()
    return () => {
      root?.removeAttribute('inert')
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
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
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-border bg-surface p-6 text-text shadow-xl"
      >
        <div className="mb-4 flex items-start gap-3">
          {icon}
          <h2 id={titleId} className="min-w-0 break-words text-xl font-bold">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
